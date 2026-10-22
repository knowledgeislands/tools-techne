import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import packageMetadata from '../../package.json' with { type: 'json' }
import { type CliIo, runCli } from '../cli.ts'
import { TechneError } from '../errors.ts'
import type { CommandCall, CommandResult, CommandRunner, RunOptions } from '../process.ts'
import { PROVIDERS } from '../providers/index.ts'
import type {
  ControllerAdapter,
  ControllerStatus,
  HostAdapter,
  HostInstance,
  HostReport,
  Provider
} from '../providers/provider.ts'
import { processRuntime, type TechneRuntime } from '../runtime.ts'
import { TECHNE_VERSION } from '../version.ts'

const ACCOUNT = '655383751458'
const INSTANCE = 'i-0123456789abcdef0'
const LOCAL_RUNTIME: TechneRuntime = {
  version: TECHNE_VERSION,
  installation: 'local',
  executable: '/checkout/src/main.ts',
  workingDirectory: '/checkout',
  bunVersion: '1.4.2',
  platform: 'darwin',
  architecture: 'arm64'
}

class FakeRunner implements CommandRunner {
  readonly calls: CommandCall[] = []
  private readonly responses: CommandResult[]

  constructor(responses: CommandResult[]) {
    this.responses = responses
  }

  async run(command: string, args: readonly string[], options: RunOptions = {}): Promise<CommandResult> {
    this.calls.push({
      command,
      args: [...args],
      mode: options.mode ?? 'capture',
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd })
    })
    return this.responses.shift() ?? { exitCode: 0, stdout: '', stderr: '' }
  }
}

class ThrowingRunner implements CommandRunner {
  private readonly value: unknown

  constructor(value: unknown) {
    this.value = value
  }

  async run(): Promise<CommandResult> {
    throw this.value
  }
}

function response(stdout = '', stderr = '', exitCode = 0): CommandResult {
  return { exitCode, stdout, stderr }
}

function identity(account = ACCOUNT): CommandResult {
  return response(JSON.stringify({ Account: account }))
}

function stack(instanceId: string | null = INSTANCE, status: string | null = 'CREATE_COMPLETE'): CommandResult {
  const Outputs = instanceId === null ? [] : [{ OutputKey: 'ControllerInstanceId', OutputValue: instanceId }]
  return response(JSON.stringify({ Stacks: [{ ...(status === null ? {} : { StackStatus: status }), Outputs }] }))
}

function operator(role = 'ki-techne-agent-host-operator', account = ACCOUNT): CommandResult {
  return response(JSON.stringify({ Account: account, Arn: `arn:aws:sts::${account}:assumed-role/${role}/kris` }))
}

function hosts(...rows: [string, string][]): CommandResult {
  return response(JSON.stringify(rows))
}

function ec2Operations(runner: FakeRunner): string[] {
  return runner.calls.filter((call) => call.args[0] === 'ec2').map((call) => call.args[1] as string)
}

const WORKSPACE_REPORT = 'Repositories under /home/techne/workspaces/kit\nsummary: REPOSITORIES=21 AT_RISK=0\n'
const FIXTURES = join(import.meta.dirname, 'fixtures')
const AGENT_HOST = readFileSync(join(FIXTURES, 'agent-host.recipe.toml'), 'utf8')
const MULTI = readFileSync(join(FIXTURES, 'multi.recipe.toml'), 'utf8')
const SCRIPTS = [
  'operations/aws/agent-host/setup.sh',
  'operations/aws/agent-host/status.sh',
  'operations/aws/agent-host/stop.sh',
  'operations/aws/agent-host/destroy.sh',
  'multi/setup.sh',
  'multi/status.sh'
]

const AWS_TABLE = `[aws]
account = "${ACCOUNT}"
region = "eu-west-1"
admin_profile = "knowledge-islands-techne"
operator_profile = "knowledge-islands-techne-agent-host"
`
const CONTROLLER = `[controller.aws]
account = "${ACCOUNT}"
region = "eu-west-1"
profile = "knowledge-islands-techne"
stack = "ki-techne-ops-007-controller"
`

function binding(name: string, body = AWS_TABLE, recipe = 'agent-host'): string {
  return `schema = "techne/host-binding/v1"\nname = "${name}"\nrecipe = "${recipe}"\n\n${body}`
}

interface Fixture {
  home: string
  harness: string
  configuration: string
  environment: Record<string, string>
}

interface FixtureOptions {
  bindings?: Record<string, string>
  config?: string | null
  recipes?: Record<string, string> | null
  scripts?: readonly string[]
}

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

// A home directory with techne configuration and a harness checkout with recipes, all local.
function fixture(options: FixtureOptions = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'techne-cli-'))
  roots.push(root)
  const home = join(root, 'home')
  const harnessDir = join(root, 'harness')
  const configuration = join(home, '.config/techne')
  mkdirSync(configuration, { recursive: true })
  mkdirSync(harnessDir)
  const recipes = options.recipes === undefined ? { 'agent-host': AGENT_HOST, multi: MULTI } : options.recipes
  if (recipes !== null) {
    mkdirSync(join(harnessDir, 'recipes'))
    for (const [name, text] of Object.entries(recipes)) {
      mkdirSync(join(harnessDir, 'recipes', name))
      writeFileSync(join(harnessDir, 'recipes', name, 'recipe.toml'), text)
    }
  }
  for (const script of options.scripts ?? SCRIPTS) {
    mkdirSync(dirname(join(harnessDir, script)), { recursive: true })
    writeFileSync(join(harnessDir, script), '#!/usr/bin/env bash\n')
  }
  const bindings = options.bindings ?? { 'agent-host': binding('agent-host') }
  if (Object.keys(bindings).length > 0) mkdirSync(join(configuration, 'hosts'))
  for (const [name, text] of Object.entries(bindings)) writeFileSync(join(configuration, 'hosts', `${name}.toml`), text)
  const config = options.config === undefined ? CONTROLLER : options.config
  if (config !== null) writeFileSync(join(configuration, 'config.toml'), config)
  return { home, harness: harnessDir, configuration, environment: { HOME: home, TECHNE_HARNESS_DIR: harnessDir } }
}

// A provider that records what the commands ask of it, for dispatch through the contract.
class StubHost implements HostAdapter {
  readonly environment = { STUB_TOKEN_FREE: 'yes' }
  readonly values: Readonly<Record<string, string>>
  private readonly log: string[]
  private readonly state: string

  constructor(values: Readonly<Record<string, string>>, log: string[], state: string) {
    this.values = values
    this.log = log
    this.state = state
  }

  async status(): Promise<HostReport> {
    this.log.push('status')
    const host = await this.find()
    return {
      exists: host !== null,
      instanceId: host?.instanceId ?? null,
      state: host?.state ?? 'absent',
      details: { zone: this.values['stub.zone'] as string }
    }
  }

  async find(): Promise<HostInstance | null> {
    if (this.state === 'error') throw new Error('stub exploded')
    if (this.state === 'refused') throw new TechneError('stub refused')
    return this.state === 'absent' ? null : { instanceId: 'stub-1', state: this.state }
  }

  async start(instanceId: string): Promise<void> {
    this.log.push(`start ${instanceId}`)
  }

  async stop(instanceId: string): Promise<void> {
    this.log.push(`stop ${instanceId}`)
  }

  async terminate(instanceId: string): Promise<void> {
    this.log.push(`terminate ${instanceId}`)
  }
}

class StubController implements ControllerAdapter {
  private readonly endpoint: string
  private readonly log: string[]

  constructor(endpoint: string, log: string[]) {
    this.endpoint = endpoint
    this.log = log
  }

  facts(): Readonly<Record<string, string>> {
    return { endpoint: this.endpoint }
  }

  async doctorChecks() {
    return [{ name: 'stub', ok: true, detail: 'stub reachable' }]
  }

  authSurface() {
    return { name: 'stub', login: async () => ({ status: 'authenticated' as const, detail: 'stub session' }) }
  }

  async status(): Promise<ControllerStatus> {
    return { exists: true, stackName: this.endpoint, stackStatus: null, instanceId: null }
  }

  async bootstrap(announce: (line: string) => void): Promise<void> {
    this.log.push('bootstrap')
    announce('stub bootstrap')
  }
}

function stubProvider(log: string[], state = 'running'): Provider {
  return {
    name: 'stub',
    options: [
      { name: 'zone', value: '<zone>', description: 'stub zone', targets: ['host'] },
      { name: 'endpoint', value: '<url>', description: 'stub controller endpoint', targets: ['controller'] }
    ],
    bindingFields: ['zone'],
    controllerFields: ['endpoint'],
    identities: (target) => [`stub zone ${target.values['stub.zone']}`],
    host: (target, context) => {
      log.push(`host ${target.name} ${JSON.stringify(context.options)}`)
      const zone = context.options['zone']
      return new StubHost({ ...target.values, ...(zone === undefined ? {} : { 'stub.zone': zone }) }, log, state)
    },
    controller: (target, context) =>
      new StubController(context.options['endpoint'] ?? String(target.table['endpoint']), log)
  }
}

function harness(
  runner: CommandRunner,
  environment: Record<string, string | undefined> = {},
  runtime: TechneRuntime = LOCAL_RUNTIME,
  interactive = true,
  answers: (string | null)[] = [],
  providers?: readonly Provider[]
) {
  let stdout = ''
  let stderr = ''
  const prompts: string[] = []
  const io: CliIo = {
    readLine: async (prompt) => {
      prompts.push(prompt)
      return answers.shift() ?? null
    },
    stdout: (value) => {
      stdout += value
    },
    stderr: (value) => {
      stderr += value
    }
  }
  return {
    run: (argv: readonly string[]) =>
      runCli(argv, {
        runner,
        environment,
        runtime,
        io,
        interactive,
        ...(providers === undefined ? {} : { providers })
      }),
    output: () => ({ stdout, stderr }),
    prompts
  }
}

describe('techne CLI', () => {
  test('proves checkout, linked-source, and worktree provenance without guessing from copied source', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'techne-provenance-'))
    const fixture = (name: string): string => {
      const root = join(directory, name)
      mkdirSync(join(root, 'src'), { recursive: true })
      mkdirSync(join(root, 'bin'), { recursive: true })
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@knowledgeislands/techne' }))
      writeFileSync(join(root, 'src/main.ts'), '// source entrypoint')
      writeFileSync(join(root, 'bin/techne'), '#!/usr/bin/env bun')
      return join(root, 'src/main.ts')
    }
    const classify = async (entrypoint: string): Promise<string> => {
      const runner = new FakeRunner([])
      const cli = harness(runner, {}, processRuntime(pathToFileURL(entrypoint).href))
      expect(await cli.run(['diag', '--json'])).toBe(0)
      expect(runner.calls).toHaveLength(0)
      return JSON.parse(cli.output().stdout).installation
    }
    try {
      const source = fixture('checkout')
      mkdirSync(join(directory, 'checkout/.git'))
      expect(await classify(source)).toBe('local')
      symlinkSync(source, join(directory, 'linked-entrypoint.ts'))
      expect(await classify(join(directory, 'linked-entrypoint.ts'))).toBe('local')
      const worktree = fixture('worktree')
      mkdirSync(join(directory, 'git-admin'))
      writeFileSync(join(directory, 'worktree/.git'), 'gitdir: ../git-admin\n')
      expect(await classify(worktree)).toBe('local')
      writeFileSync(join(directory, 'worktree/.git'), 'gitdir: ../git-admin\r\n')
      expect(await classify(worktree)).toBe('local')
      expect(await classify(fixture('copied'))).toBe('unknown')
      expect(await classify(join(directory, 'unavailable/src/main.ts'))).toBe('unknown')
      for (const name of [
        'wrong-entrypoint',
        'directory-entrypoint',
        'directory-manifest',
        'directory-launcher',
        'wrong-package',
        'malformed-package',
        'git-link',
        'bad-worktree',
        'file-gitdir'
      ]) {
        const entrypoint = fixture(name)
        const root = join(directory, name)
        mkdirSync(join(root, '.git'))
        let observed = entrypoint
        if (name === 'wrong-entrypoint') {
          writeFileSync(join(root, 'copied-main.ts'), '// copied source')
          observed = join(root, 'copied-main.ts')
        } else if (name === 'directory-entrypoint') {
          rmSync(entrypoint)
          mkdirSync(entrypoint)
        } else if (name === 'directory-manifest') {
          rmSync(join(root, 'package.json'))
          mkdirSync(join(root, 'package.json'))
        } else if (name === 'directory-launcher') {
          rmSync(join(root, 'bin/techne'))
          mkdirSync(join(root, 'bin/techne'))
        } else if (name === 'wrong-package')
          writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'copied-tool' }))
        else if (name === 'malformed-package') writeFileSync(join(root, 'package.json'), '{')
        else {
          rmSync(join(root, '.git'), { recursive: true })
          if (name === 'git-link') symlinkSync(join(directory, 'git-admin'), join(root, '.git'))
          else if (name === 'bad-worktree') writeFileSync(join(root, '.git'), 'not a gitdir marker\n')
          else {
            writeFileSync(join(directory, 'git-admin-file'), 'not a directory')
            writeFileSync(join(root, '.git'), 'gitdir: ../git-admin-file\n')
          }
        }
        expect(await classify(observed), name).toBe('unknown')
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('normalizes host names and preserves every doctor check in the summary', async () => {
    for (const [platform, architecture, expected] of [
      ['win32', 'AMD64', 'windows'],
      ['linux', 'x64', 'linux']
    ]) {
      const cli = harness(new FakeRunner([]), fixture().environment, {
        ...LOCAL_RUNTIME,
        platform: platform as string,
        architecture: architecture as string
      })
      expect(await cli.run(['diag', '--json'])).toBe(0)
      expect(JSON.parse(cli.output().stdout)).toMatchObject({
        platform: expected,
        architecture: 'x86_64',
        configuration: '1 host binding; controller aws'
      })
    }
    const cli = harness(new FakeRunner([response('aws-cli/2'), response('1.2'), identity()]), fixture().environment)
    expect(await cli.run(['doctor', '--json'])).toBe(0)
    const report = JSON.parse(cli.output().stdout)
    expect(report).toMatchObject({
      tool: 'techne',
      installation: 'local',
      platform: 'macos',
      architecture: 'arm64',
      verdict: 'healthy',
      counts: { pass: 6, warn: 0, fail: 0, skipped: 0 }
    })
    expect(Object.values(report.counts).reduce((sum: number, value) => sum + Number(value), 0)).toBe(
      report.checks.length
    )
    expect(cli.output().stdout).not.toContain(ACCOUNT)
    expect(cli.output().stdout).not.toContain('/checkout')
  })

  test('reports unknown provenance honestly and unavailable identity as skipped', async () => {
    const cli = harness(new FakeRunner([response('aws-cli/2'), response('1.2'), identity()]), fixture().environment, {
      ...LOCAL_RUNTIME,
      installation: 'unknown'
    })
    expect(await cli.run(['doctor', '--json'])).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toMatchObject({
      installation: 'unknown',
      verdict: 'healthy',
      counts: { pass: 5, warn: 1, fail: 0, skipped: 0 }
    })
    const stale = harness(new FakeRunner([response('', 'aws-cli/2'), identity()]), fixture().environment, {
      ...LOCAL_RUNTIME,
      bunVersion: '1.3.0'
    })
    expect(await stale.run(['doctor'])).toBe(1)
    expect(stale.output().stdout).toContain('fail bun: running Bun 1.3.0; expected 1.4.2\n')
    const missing = harness(new FakeRunner([response('', '', 127), response('', '', 127)]), fixture().environment, {
      ...LOCAL_RUNTIME,
      installation: 'release',
      bunVersion: 'unavailable'
    })
    expect(await missing.run(['doctor', '--json'])).toBe(1)
    expect(JSON.parse(missing.output().stdout)).toMatchObject({
      verdict: 'unhealthy',
      counts: { pass: 2, warn: 0, fail: 3, skipped: 1 }
    })
  })

  test('shows help without running a subprocess', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner)

    expect(await cli.run(['--help'])).toBe(0)
    const help = cli.output().stdout
    expect(help).toContain('auth login')
    expect(help).toContain('controller bootstrap')
    expect(help).toContain('recipe show [recipe]')
    expect(help).toContain('host add <name> --recipe <recipe> [--provider <provider>]')
    expect(help).toContain('host status [--host <name> | --all]')
    expect(help).toContain('host setup --host <name> [--pull] [--dry-run]')
    expect(help).toContain('host connect [--host <name>] [--dry-run] [path]')
    const [global, provider] = help.split('AWS provider options:\n') as [string, string]
    expect(global).toContain('Global options:\n')
    expect(global).not.toMatch(/--aws-|--profile|--region|--account|--controller-stack|--host-profile/)
    for (const flag of [
      '--aws-profile <name>',
      '--aws-region <region>',
      '--aws-account <id>',
      '--aws-controller-stack <name>',
      '--aws-operator-profile <name>'
    ]) {
      expect(provider).toContain(flag)
    }
    expect(provider).toContain('(controller)')
    expect(provider).toContain('(host)')
    expect(provider).toContain('(host, controller)')
    expect(runner.calls).toHaveLength(0)
  })

  test('shows help when no command is supplied', async () => {
    const cli = harness(new FakeRunner([]))

    expect(await cli.run([])).toBe(0)
    expect(cli.output().stdout).toContain('Usage:')
  })

  test('explains a named command without running providers', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner)
    expect(await cli.run(['help'])).toBe(0)
    expect(await cli.run(['help', 'diag'])).toBe(0)
    expect(cli.output().stdout).toContain('diag [--full]')
    expect(await cli.run(['help', 'controller', 'bootstrap'])).toBe(0)
    expect(cli.output().stdout).toContain('controller bootstrap')
    expect(runner.calls).toHaveLength(0)

    const unknown = harness(runner)
    expect(await unknown.run(['help', 'missing'])).toBe(2)
    expect(unknown.output().stderr).toContain('unknown help topic')
    expect(unknown.output().stderr).toContain("Run 'techne help <command>'")
    expect(unknown.output().stdout).toBe('')
  })

  test('shows the same help through --help, -h and help at every level', async () => {
    for (const command of [
      ['diag'],
      ['doctor'],
      ['auth'],
      ['auth', 'login'],
      ['controller'],
      ['controller', 'status'],
      ['controller', 'bootstrap'],
      ['recipe'],
      ['recipe', 'list'],
      ['recipe', 'show'],
      ['host'],
      ['host', 'list'],
      ['host', 'add'],
      ['host', 'status'],
      ['host', 'setup'],
      ['host', 'start'],
      ['host', 'stop'],
      ['host', 'rebuild'],
      ['host', 'withdraw'],
      ['host', 'teardown'],
      ['host', 'connect'],
      ['completion'],
      ['help']
    ]) {
      const named = harness(new FakeRunner([]))
      expect(await named.run(['help', ...command])).toBe(0)
      const expected = named.output().stdout
      expect(expected).toMatch(/^Usage: techne /)
      expect(expected).toContain(command.join(' '))
      for (const flag of ['--help', '-h']) {
        const runner = new FakeRunner([])
        const cli = harness(runner)
        expect(await cli.run([...command, flag]), `${command.join(' ')} ${flag}`).toBe(0)
        expect(cli.output().stdout).toBe(expected)
        expect(cli.output().stderr).toBe('')
        expect(runner.calls).toHaveLength(0)
      }
    }
    const connect = harness(new FakeRunner([]))
    expect(await connect.run(['host', 'connect', 'projects', '--help'])).toBe(0)
    expect(connect.output().stdout).toContain('host connect [--host <name>] [--dry-run] [path]')
    const add = harness(new FakeRunner([]))
    expect(await add.run(['host', 'add', 'spare', '--help'])).toBe(0)
    expect(add.output().stdout).toContain('refuses to overwrite and provisions nothing')
    const show = harness(new FakeRunner([]))
    expect(await show.run(['recipe', 'show', 'agent-host', '--help'])).toBe(0)
    expect(show.output().stdout).toContain("the selected host's recipe")
    const completion = harness(new FakeRunner([]))
    expect(await completion.run(['completion', 'zsh', '--help'])).toBe(0)
    expect(completion.output().stdout).toContain('Usage: techne completion <bash|zsh>')
  })

  test('names the provider options each command target accepts', async () => {
    const cli = harness(new FakeRunner([]))
    for (const command of ['diag', 'doctor', 'auth login', 'controller status', 'controller bootstrap']) {
      expect(await cli.run(['help', ...command.split(' ')])).toBe(0)
    }
    expect(cli.output().stdout).toContain(
      'Provider options: --aws-profile, --aws-region, --aws-account, --aws-controller-stack, for the target'
    )
    const host = harness(new FakeRunner([]))
    for (const command of ['status', 'setup', 'start', 'stop', 'teardown', 'connect']) {
      expect(await host.run(['help', 'host', command])).toBe(0)
    }
    expect(host.output().stdout).toContain(
      'Provider options: --aws-profile, --aws-region, --aws-account, --aws-operator-profile, for the target'
    )
    const local = harness(new FakeRunner([]))
    for (const command of [['recipe', 'list'], ['recipe', 'show'], ['host', 'list'], ['host', 'add'], ['completion']]) {
      expect(await local.run(['help', ...command])).toBe(0)
    }
    expect(local.output().stdout).not.toContain('Provider options')
  })

  test('lists group subcommands and rejects a bare group with its usage', async () => {
    for (const [group, commands, message] of [
      ['auth', ['login'], 'login'],
      ['controller', ['status', 'bootstrap'], 'status or bootstrap'],
      ['recipe', ['list', 'show'], 'list or show'],
      [
        'host',
        ['list', 'add', 'status', 'setup', 'start', 'stop', 'rebuild', 'withdraw', 'connect'],
        'list, add, status, setup, start, stop, rebuild, withdraw or connect'
      ]
    ] as const) {
      const help = harness(new FakeRunner([]))
      expect(await help.run([group, '--help'])).toBe(0)
      expect(help.output().stdout).toContain(`Usage: techne [global options] ${group} <command>`)
      for (const command of commands) expect(help.output().stdout).toMatch(new RegExp(`^  ${command} `, 'm'))

      const runner = new FakeRunner([])
      const bare = harness(runner)
      expect(await bare.run([group])).toBe(2)
      expect(bare.output().stdout).toBe('')
      expect(bare.output().stderr).toBe(
        `techne: error: ${group} requires a command: ${message}\n${help.output().stdout}`
      )
      expect(runner.calls).toHaveLength(0)
    }
  })

  test('reports its version without running a subprocess', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner)

    expect(await cli.run(['--version'])).toBe(0)
    expect(cli.output().stdout).toBe(`${packageMetadata.version}\n`)
    expect(runner.calls).toHaveLength(0)
  })

  test('prints Bash and Zsh completion definitions without provider calls', async () => {
    for (const shell of ['bash', 'zsh']) {
      const runner = new FakeRunner([])
      const cli = harness(runner)

      expect(await cli.run(['completion', shell])).toBe(0)
      expect(cli.output().stderr).toBe('')
      expect(cli.output().stdout).toContain(shell === 'bash' ? 'complete -F _techne techne' : '#compdef techne')
      expect(cli.output().stdout).toContain(shell === 'bash' ? 'controller' : 'compdef _techne techne')
      expect(cli.output().stdout).toContain('--aws-operator-profile')
      expect(cli.output().stdout).not.toMatch(/ --(profile|region|account|controller-stack|host-profile)\b/)
      expect(runner.calls).toHaveLength(0)
    }
  })

  test('Bash completion registers and resolves command context', async () => {
    const dollar = '$'
    const cli = harness(new FakeRunner([]))
    expect(await cli.run(['completion', 'bash'])).toBe(0)
    const directory = mkdtempSync(join(tmpdir(), 'techne-bash-'))
    const complete = (words: string, expected: string): string =>
      `COMP_WORDS=(${words}); COMP_CWORD=$((${dollar}{#COMP_WORDS[@]}-1)); _techne; [[ "${dollar}{COMPREPLY[*]}" == "${expected}" ]] || { echo "${words}: ${dollar}{COMPREPLY[*]}"; exit 1; };`
    try {
      const definition = join(directory, 'techne.bash')
      writeFileSync(definition, cli.output().stdout)
      const script = [
        'source "$1"; complete -p techne;',
        complete('techne --aws-region local auth lo', 'login'),
        complete('techne help controller bo', 'bootstrap'),
        complete('techne --aws-operator-profile p host re', 'rebuild'),
        complete('techne host stop --dr', '--dry-run'),
        complete('techne --harness-dir d host setup --pu', '--pull'),
        complete('techne recipe s', 'show'),
        complete('techne host a', 'add'),
        complete('techne host status --al', '--all'),
        complete('techne host add x --rec', '--recipe'),
        complete('techne host start --aws-op', '--aws-operator-profile'),
        complete('techne controller status --aws-con', '--aws-controller-stack'),
        complete('techne recipe list --aws-p', '')
      ].join(' ')
      const result = spawnSync('bash', ['-c', script, '_', definition], { encoding: 'utf8' })
      expect(result.status, result.stdout + result.stderr).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('Zsh completion registers from an autoload file under compinit', async () => {
    const dollar = '$'
    if (spawnSync('zsh', ['--version']).error) return
    const cli = harness(new FakeRunner([]))
    expect(await cli.run(['completion', 'zsh'])).toBe(0)
    const directory = mkdtempSync(join(tmpdir(), 'techne-zsh-'))
    try {
      writeFileSync(join(directory, '_techne'), cli.output().stdout)
      const result = spawnSync(
        'zsh',
        [
          '-f',
          '-c',
          `fpath=("$1" $fpath); autoload -Uz compinit; compinit -D; [[ "${dollar}{_comps[techne]}" == _techne ]]`,
          '_',
          directory
        ],
        { encoding: 'utf8' }
      )
      expect(result.status, result.stderr).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test('rejects unsupported or incomplete completion syntax before help', async () => {
    for (const args of [
      ['completion'],
      ['completion', 'fish'],
      ['completion', 'bash', 'extra'],
      ['completion', 'fish', '--help']
    ]) {
      const cli = harness(new FakeRunner([]))

      expect(await cli.run(args)).toBe(2)
      expect(cli.output().stderr).toContain('techne: error: completion requires exactly one supported shell')
      expect(cli.output().stderr).toContain('Usage:')
      expect(cli.output().stdout).toBe('')
    }
  })

  test('reports offline installation and non-secret configuration diagnostics', async () => {
    const runner = new FakeRunner([])
    const setup = fixture()
    const cli = harness(runner, {
      ...setup.environment,
      AWS_PROFILE: 'local-profile',
      TELEGRAM_BOT_TOKEN: 'must-not-leak'
    })

    expect(await cli.run(['diag', '--json'])).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toMatchObject({
      schema: 'techne/diag/v1',
      version: TECHNE_VERSION,
      installation: 'local',
      configuration: '1 host binding; controller aws'
    })
    for (const secret of ['/checkout', 'local-profile', 'must-not-leak', setup.home, ACCOUNT]) {
      expect(cli.output().stdout).not.toContain(secret)
    }
    expect(runner.calls).toHaveLength(0)
  })

  test('summarises absent, plural and invalid configuration without failing diag', async () => {
    const cases: [FixtureOptions, string][] = [
      [{ bindings: {}, config: null }, '0 host bindings; controller not configured'],
      [
        { bindings: { a: binding('a'), b: binding('b') }, config: 'default_host = "a"\n' },
        '2 host bindings; controller not configured'
      ],
      [{ config: 'unknown = 1\n' }, 'invalid; run techne doctor']
    ]
    for (const [options, summary] of cases) {
      const cli = harness(new FakeRunner([]), fixture(options).environment)
      expect(await cli.run(['diag', '--json'])).toBe(0)
      expect(JSON.parse(cli.output().stdout).configuration).toBe(summary)
    }
    const homeless = harness(new FakeRunner([]))
    expect(await homeless.run(['diag', '--json'])).toBe(0)
    expect(JSON.parse(homeless.output().stdout).configuration).toBe('invalid; run techne doctor')
  })

  test('renders human-readable diagnostics', async () => {
    const cli = harness(new FakeRunner([]), fixture().environment)

    expect(await cli.run(['diag'])).toBe(0)
    expect(cli.output().stdout).toContain(`Version: ${TECHNE_VERSION}`)
    for (const field of [
      'Tool: techne',
      'Platform: macos',
      'Architecture: arm64',
      'Runtime: Bun 1.4.2',
      'Configuration: 1 host binding; controller aws'
    ])
      expect(cli.output().stdout).toContain(field)
    expect(cli.output().stdout).toContain('identifiers omitted')
    expect(cli.output().stdout).not.toContain(ACCOUNT)
  })

  test('includes private diagnostic details and the controller target only on explicit request', async () => {
    const setup = fixture()
    const cli = harness(new FakeRunner([]), setup.environment)
    expect(await cli.run(['diag', '--full', '--json'])).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toMatchObject({
      details: {
        executable: '/checkout/src/main.ts',
        configurationDirectory: setup.configuration,
        harnessDirectory: setup.harness,
        controller: {
          provider: 'aws',
          profile: 'knowledge-islands-techne',
          region: 'eu-west-1',
          account: ACCOUNT,
          stack: 'ki-techne-ops-007-controller'
        }
      }
    })

    const human = harness(new FakeRunner([]), { ...setup.environment })
    expect(await human.run(['diag', '--full', '--aws-profile', 'flag-profile'])).toBe(0)
    expect(human.output().stdout).toContain('controller profile: flag-profile\n')
    expect(human.output().stdout).toContain(`configuration directory: ${setup.configuration}\n`)

    const cases: [FixtureOptions, Record<string, string>][] = [
      [{ config: null }, { provider: 'not configured' }],
      [{ config: 'default_host = 1\n' }, { error: expect.stringContaining('default_host must be a non-empty string') }],
      [
        { config: '[controller.aws]\naccount = "1"\n' },
        { provider: 'aws', error: expect.stringContaining('no AWS profile for the controller is configured') }
      ]
    ]
    for (const [options, controller] of cases) {
      const target = harness(new FakeRunner([]), fixture(options).environment)
      expect(await target.run(['diag', '--full', '--json'])).toBe(0)
      expect(JSON.parse(target.output().stdout).details.controller).toEqual(controller)
    }

    const refused = harness(new FakeRunner([]), setup.environment)
    expect(await refused.run(['diag', '--full', '--aws-operator-profile', 'p'])).toBe(2)
    expect(refused.output().stderr).toContain('--aws-operator-profile does not apply to the controller')

    const invalid = harness(new FakeRunner([]))
    expect(await invalid.run(['doctor', '--full'])).toBe(2)
    expect(invalid.output().stderr).toContain('--full is only supported for diag')
  })

  test('rejects unknown commands', async () => {
    const cli = harness(new FakeRunner([]))

    expect(await cli.run(['controller', 'explode'])).toBe(2)
    expect(cli.output().stderr).toContain('techne: error: unknown command: controller explode\n')
    expect(cli.output().stderr).toContain('Usage: techne [global options] controller <command>')
    expect(await cli.run(['controller', 'explode', '--help'])).toBe(2)
    expect(await cli.run(['controller', 'explode', '--version'])).toBe(2)
    expect(cli.output().stdout).toBe('')

    const root = harness(new FakeRunner([]))
    expect(await root.run(['explode'])).toBe(2)
    expect(root.output().stderr).toContain('techne: error: unknown command: explode\n')
    expect(root.output().stderr).toContain("Run 'techne help <command>'")
  })

  test('removes the unprefixed provider options and their environment variables outright', async () => {
    for (const option of ['--profile', '--region', '--account', '--controller-stack', '--host-profile']) {
      const runner = new FakeRunner([])
      const cli = harness(runner, fixture().environment)
      expect(await cli.run(['controller', 'status', option, 'value'])).toBe(2)
      expect(cli.output().stderr).toContain(`techne: error: unknown option: ${option}\n`)
      expect(runner.calls).toHaveLength(0)
    }
    const runner = new FakeRunner([identity(), stack()])
    const cli = harness(runner, {
      ...fixture().environment,
      EXPECTED_AWS_ACCOUNT: '999999999999',
      CONTROLLER_STACK_NAME: 'environment-stack',
      TECHNE_HOST_PROFILE: 'environment-host'
    })
    expect(await cli.run(['controller', 'status'])).toBe(0)
    expect(runner.calls[1]?.args).toContain('ki-techne-ops-007-controller')
    expect(JSON.stringify(runner.calls)).not.toMatch(/environment-|999999999999/)
  })
})

describe('controller target', () => {
  test('logs in through the controller target authentication surface', async () => {
    const runner = new FakeRunner([response('', 'aws-cli/2.36.49'), identity()])
    const cli = harness(runner, fixture().environment)

    expect(await cli.run(['auth', 'login'])).toBe(0)
    expect(cli.output().stdout).toBe(`ok auth aws: account ${ACCOUNT}\n`)
    expect(runner.calls.map((call) => call.command)).toEqual(['aws', 'aws'])
    expect(runner.calls[1]?.env).toEqual({ AWS_PROFILE: 'knowledge-islands-techne', AWS_REGION: 'eu-west-1' })
  })

  test('recovers an expired session and reports authentication failures', async () => {
    const expired = response('', 'The SSO session associated with this profile has expired.', 1)
    const runner = new FakeRunner([response('', 'aws-cli/2'), expired, response('session\n'), response(), identity()])
    const cli = harness(runner, fixture().environment)
    expect(await cli.run(['auth', 'login'])).toBe(0)
    expect(cli.output().stdout).toBe(`ok auth aws: account ${ACCOUNT}\n`)
    expect(runner.calls[3]).toMatchObject({
      args: ['sso', 'login', '--profile', 'knowledge-islands-techne'],
      mode: 'interactive'
    })

    const missing = harness(new FakeRunner([response('', '', 127)]), fixture().environment)
    expect(await missing.run(['auth', 'login'])).toBe(1)
    expect(missing.output().stdout).toBe('fail auth aws: AWS CLI is unavailable\n')

    const denied = harness(new FakeRunner([response('', 'aws-cli/2'), response('', 'AccessDenied', 1)]), {
      ...fixture().environment
    })
    expect(await denied.run(['auth', 'login'])).toBe(1)
    expect(denied.output().stdout).toBe('fail auth aws: AWS identity check failed: AccessDenied\n')

    for (const [responses, message] of [
      [[response('')], 'AWS profile knowledge-islands-techne is not configured for IAM Identity Center'],
      [[response('', '', 1)], 'AWS profile knowledge-islands-techne is not configured for IAM Identity Center'],
      [[response('session\n'), response('', '', 1)], 'AWS login failed for profile knowledge-islands-techne']
    ] as const) {
      const failing = harness(new FakeRunner([response('', 'aws-cli/2'), expired, ...responses]), fixture().environment)
      expect(await failing.run(['auth', 'login'])).toBe(1)
      expect(failing.output().stdout).toBe(`fail auth aws: ${message}\n`)
    }
  })

  test('rejects JSON and non-interactive authentication without running subprocesses', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner, fixture().environment)
    expect(await cli.run(['auth', 'login', '--json'])).toBe(2)
    expect(cli.output().stderr).toContain('--json is not supported for interactive authentication')

    const batch = harness(runner, fixture().environment, LOCAL_RUNTIME, false)
    expect(await batch.run(['auth', 'login'])).toBe(2)
    expect(batch.output().stderr).toContain('auth login requires an interactive terminal')
    expect(runner.calls).toHaveLength(0)
  })

  test('guides expired doctor sessions to explicit authentication', async () => {
    const runner = new FakeRunner([
      response('', 'aws-cli/2.36.49'),
      response('1.2.835.0\n'),
      response('', 'The SSO session associated with this profile has expired.', 1)
    ])
    const cli = harness(runner, fixture().environment)

    expect(await cli.run(['doctor'])).toBe(1)
    expect(cli.output().stdout).toContain('run techne auth login')
    expect(runner.calls).toHaveLength(3)
  })

  test('reports local tools and the controller identity in human output', async () => {
    const runner = new FakeRunner([response('', 'aws-cli/2.36.49'), response('1.2.835.0\n'), identity()])
    const cli = harness(runner, fixture().environment)
    expect(await cli.run(['doctor'])).toBe(0)
    expect(cli.output().stdout).toContain('ok controller: aws target configured\n')
    expect(cli.output().stdout).toContain('ok aws: aws-cli/2.36.49\n')
    expect(cli.output().stdout).toContain('ok aws-account: expected AWS identity verified\n')
    expect(cli.output().stdout).toContain('Verdict: healthy\n')
    expect(runner.calls.map((call) => call.command)).toEqual(['aws', 'session-manager-plugin', 'aws'])

    const unavailable = harness(new FakeRunner([response('', '', 127), response('', '', 127)]), fixture().environment)
    expect(await unavailable.run(['doctor'])).toBe(1)
    expect(unavailable.output().stdout).toContain('fail aws: AWS CLI is unavailable; install awscli and retry')
    expect(unavailable.output().stdout).toContain('skipped aws-account: AWS CLI is unavailable')
  })

  test('skips controller checks without a controller table and fails on invalid configuration', async () => {
    const runner = new FakeRunner([])
    const skipped = harness(runner, fixture({ config: null }).environment)
    expect(await skipped.run(['doctor', '--json'])).toBe(0)
    expect(JSON.parse(skipped.output().stdout)).toMatchObject({
      verdict: 'healthy',
      counts: { pass: 2, warn: 0, fail: 0, skipped: 1 }
    })
    expect(runner.calls).toHaveLength(0)

    const cases: [string, string][] = [
      ['[controller.aws]\naccount = "1"\n', 'no AWS profile for the controller is configured'],
      ['[controller.aws]\nprofile = "p"\nregion = "r"\n', 'no AWS account for the controller is configured'],
      ['[controller.aws]\nprofile = "p"\nregion = "r"\naccount = "1"\n', 'no controller stack is configured'],
      ['[controller.aws]\nprofile = ""\n', 'profile must be a non-empty value'],
      ['[controller.aws]\nprofile = ["a"]\nregion = { x = 1 }\n', 'region must be a non-empty value'],
      ['[controller.aws]\nbucket = "b"\n', 'unknown field bucket'],
      ['[controller.aws]\n[controller.gcp]\n', 'at most one [controller.<provider>] table'],
      ['[controller.gcp]\n', 'unknown field controller.gcp'],
      ['controller = 1\n', 'controller must hold one [controller.<provider>] table'],
      ['controller = ', 'is not valid TOML'],
      ['default_host = "a"\nprovider = "aws"\n', 'unknown field provider']
    ]
    for (const [config, message] of cases) {
      const cli = harness(new FakeRunner([]), fixture({ config }).environment)
      expect(await cli.run(['doctor', '--json']), config).toBe(1)
      const report = JSON.parse(cli.output().stdout)
      expect(
        report.checks.find((check: { name: string }) => check.name === 'controller'),
        config
      ).toMatchObject({
        ok: false,
        detail: expect.stringContaining(message)
      })
    }

    const unreadable = fixture({ config: null })
    mkdirSync(join(unreadable.configuration, 'config.toml'))
    const directory = harness(new FakeRunner([]), unreadable.environment)
    expect(await directory.run(['doctor', '--json'])).toBe(1)
    expect(directory.output().stdout).toContain('cannot read')

    const misplaced = harness(new FakeRunner([]), fixture().environment)
    expect(await misplaced.run(['doctor', '--aws-operator-profile', 'p'])).toBe(2)
    expect(misplaced.output().stderr).toContain('--aws-operator-profile does not apply to the controller')
  })

  test('refuses controller commands without a controller target, naming config.toml', async () => {
    const setup = fixture({ config: null })
    for (const command of [
      ['controller', 'status'],
      ['controller', 'bootstrap'],
      ['auth', 'login']
    ]) {
      const runner = new FakeRunner([])
      const cli = harness(runner, setup.environment)
      expect(await cli.run(command)).toBe(1)
      expect(cli.output().stderr).toBe(
        `techne: error: no controller target is configured; add a [controller.<provider>] table to ${setup.configuration}/config.toml\n`
      )
      expect(runner.calls).toHaveLength(0)
    }
  })

  test('resolves each controller field by flag, then table, then AWS environment', async () => {
    const flagged = new FakeRunner([identity('222222222222'), stack()])
    const cli = harness(flagged, {
      ...fixture().environment,
      AWS_PROFILE: 'environment-profile',
      AWS_REGION: 'environment-region'
    })
    expect(
      await cli.run([
        'controller',
        'status',
        '--aws-profile',
        'flag-profile',
        '--aws-region',
        'flag-region',
        '--aws-account',
        '222222222222',
        '--aws-controller-stack',
        'flag-stack',
        '--json'
      ])
    ).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toEqual({
      exists: true,
      stackName: 'flag-stack',
      stackStatus: 'CREATE_COMPLETE',
      instanceId: INSTANCE
    })
    expect(flagged.calls[0]?.args).toEqual([
      'sts',
      'get-caller-identity',
      '--profile',
      'flag-profile',
      '--output',
      'json'
    ])
    expect(flagged.calls[1]?.args).toEqual([
      'cloudformation',
      'describe-stacks',
      '--profile',
      'flag-profile',
      '--region',
      'flag-region',
      '--stack-name',
      'flag-stack',
      '--output',
      'json'
    ])
    for (const call of flagged.calls)
      expect(call.env).toEqual({ AWS_PROFILE: 'flag-profile', AWS_REGION: 'flag-region' })

    const table = new FakeRunner([identity(), stack()])
    const tableCli = harness(table, { ...fixture().environment, AWS_PROFILE: 'environment-profile' })
    expect(await tableCli.run(['controller', 'status'])).toBe(0)
    expect(table.calls[1]?.env).toEqual({ AWS_PROFILE: 'knowledge-islands-techne', AWS_REGION: 'eu-west-1' })

    const ambient = new FakeRunner([identity(), stack()])
    const ambientCli = harness(ambient, {
      ...fixture({ config: `[controller.aws]\naccount = "${ACCOUNT}"\nstack = "s"\n` }).environment,
      AWS_PROFILE: 'environment-profile',
      AWS_REGION: 'environment-region'
    })
    expect(await ambientCli.run(['controller', 'status'])).toBe(0)
    expect(ambient.calls[1]?.args).toEqual(expect.arrayContaining(['environment-profile', 'environment-region', 's']))

    const nothing = harness(new FakeRunner([]), {
      ...fixture({ config: `[controller.aws]\naccount = "${ACCOUNT}"\nstack = "s"\n` }).environment,
      AWS_PROFILE: ''
    })
    expect(await nothing.run(['controller', 'status'])).toBe(1)
    expect(nothing.output().stderr).toContain(
      'no AWS profile for the controller is configured; set --aws-profile, controller.aws.profile in config.toml or AWS_PROFILE'
    )
    const regionless = harness(new FakeRunner([]), {
      ...fixture({ config: `[controller.aws]\naccount = "${ACCOUNT}"\nprofile = "p"\n` }).environment
    })
    expect(await regionless.run(['controller', 'status'])).toBe(1)
    expect(regionless.output().stderr).toContain(
      'no AWS region for the controller is configured; set --aws-region, controller.aws.region in config.toml or AWS_REGION'
    )
  })

  test('reports absent, unknown and instance-bearing controller stacks', async () => {
    const absent = new FakeRunner([identity(), response('', 'Stack with id x does not exist', 255)])
    const absentCli = harness(absent, fixture().environment)
    expect(await absentCli.run(['controller', 'status'])).toBe(0)
    expect(absentCli.output().stdout).toBe('controller stack: ki-techne-ops-007-controller\nstate: absent\n')

    const present = harness(new FakeRunner([identity(), stack()]), fixture().environment)
    expect(await present.run(['controller', 'status'])).toBe(0)
    expect(present.output().stdout).toContain(`instance: ${INSTANCE}\n`)

    const unknown = harness(new FakeRunner([identity(), stack(null, null)]), fixture().environment)
    expect(await unknown.run(['controller', 'status'])).toBe(0)
    expect(unknown.output().stdout).toBe('controller stack: ki-techne-ops-007-controller\nstate: unknown\n')
  })

  test('refuses an unexpected AWS account before inspecting the stack', async () => {
    const runner = new FakeRunner([identity('999999999999')])
    const cli = harness(runner, fixture().environment)
    expect(await cli.run(['controller', 'status'])).toBe(1)
    expect(cli.output().stderr).toContain(`refusing AWS account 999999999999; expected ${ACCOUNT}`)
    expect(runner.calls).toHaveLength(1)
  })

  test('opens bootstrap through an interactive SSM session', async () => {
    const runner = new FakeRunner([response('1.2'), identity(), stack(), response()])
    const cli = harness(runner, fixture().environment)
    expect(await cli.run(['controller', 'bootstrap'])).toBe(0)
    expect(cli.output().stdout).toContain(`Opening a private interactive bootstrap session on ${INSTANCE}.`)
    expect(runner.calls[3]).toMatchObject({ command: 'aws', mode: 'interactive' })
    expect(runner.calls[3]?.args.slice(0, 6)).toEqual([
      'ssm',
      'start-session',
      '--profile',
      'knowledge-islands-techne',
      '--region',
      'eu-west-1'
    ])
  })

  test('refuses bootstrap without its prerequisites', async () => {
    const cases: [CommandResult[], string][] = [
      [[response('', '', 127)], 'AWS Session Manager plugin is unavailable'],
      [[response('1.2'), identity(), response('', 'does not exist', 255)], 'controller stack does not exist'],
      [[response('1.2'), identity(), stack(null)], 'controller instance output is missing'],
      [[response('1.2'), identity(), stack('x-1')], 'controller instance output is missing'],
      [[response('1.2'), identity(), stack(), response('', '', 1)], 'interactive controller bootstrap session failed']
    ]
    for (const [responses, message] of cases) {
      const cli = harness(new FakeRunner(responses), fixture().environment)
      expect(await cli.run(['controller', 'bootstrap'])).toBe(1)
      expect(cli.output().stderr).toContain(message)
    }
    const json = harness(new FakeRunner([]), fixture().environment)
    expect(await json.run(['controller', 'bootstrap', '--json'])).toBe(2)
    expect(json.output().stderr).toContain('--json is not supported for an interactive bootstrap')
  })
})

const OPERATOR = 'knowledge-islands-techne-agent-host'
const AWS_ENV = { AWS_PROFILE: 'knowledge-islands-techne', AWS_REGION: 'eu-west-1' }
const DESCRIBE = [
  'ec2',
  'describe-instances',
  '--filters',
  'Name=tag:ki-agent-host-id,Values=agent-host',
  'Name=tag:Name,Values=ki-techne-agent-host',
  'Name=instance-state-name,Values=pending,running,stopping,stopped',
  '--query',
  'Reservations[].Instances[].[InstanceId,State.Name]',
  '--output',
  'json',
  '--profile',
  OPERATOR,
  '--region',
  'eu-west-1'
]

describe('host bindings and selection', () => {
  const two = { 'agent-host': binding('agent-host'), spare: binding('spare') }

  function selected(cli: ReturnType<typeof harness>): string {
    return JSON.parse(cli.output().stdout).hosts.find((host: { selected: boolean }) => host.selected)?.name ?? null
  }

  test('selects by --host, then TECHNE_HOST, then default_host, then the sole binding', async () => {
    const setup = fixture({ bindings: two, config: 'default_host = "spare"\n' })
    const cases: [string[], Record<string, string>, string, string][] = [
      [['--host', 'agent-host'], { TECHNE_HOST: 'spare' }, 'agent-host', '--host'],
      [[], { TECHNE_HOST: 'agent-host' }, 'agent-host', 'TECHNE_HOST'],
      [[], { TECHNE_HOST: '' }, 'spare', 'default_host']
    ]
    for (const [args, environment, name, source] of cases) {
      const cli = harness(new FakeRunner([]), { ...setup.environment, ...environment })
      expect(await cli.run(['host', 'list', '--json', ...args])).toBe(0)
      expect(selected(cli)).toBe(name)
      expect(JSON.parse(cli.output().stdout).selection).toEqual({ name, source })
    }
    const sole = harness(new FakeRunner([]), fixture({ config: null }).environment)
    expect(await sole.run(['host', 'list'])).toBe(0)
    expect(sole.output().stdout).toBe('* agent-host: recipe agent-host, provider aws (selected by sole binding)\n')
  })

  test('refuses an unknown name at every named step without falling through', async () => {
    const setup = fixture({ bindings: two, config: 'default_host = "ghost"\n' })
    const cases: [string[], Record<string, string>, string][] = [
      [['--host', 'ghost'], { TECHNE_HOST: 'agent-host' }, '--host names ghost'],
      [[], { TECHNE_HOST: 'ghost' }, 'TECHNE_HOST names ghost'],
      [[], {}, 'default_host names ghost']
    ]
    for (const [args, environment, message] of cases) {
      const cli = harness(new FakeRunner([]), { ...setup.environment, ...environment })
      expect(await cli.run(['host', 'status', ...args])).toBe(1)
      expect(cli.output().stderr).toBe(
        `techne: error: ${message}, which is not a host binding; available: agent-host, spare\n`
      )
    }
  })

  test('lists several bindings with no selection, and refuses to guess for a host command', async () => {
    const setup = fixture({ bindings: two, config: null })
    const list = harness(new FakeRunner([]), setup.environment)
    expect(await list.run(['host', 'list'])).toBe(0)
    expect(list.output().stdout).toBe(
      '  agent-host: recipe agent-host, provider aws\n  spare: recipe agent-host, provider aws\n' +
        'no host selected; choose one with --host <name>, TECHNE_HOST or default_host in config.toml\n'
    )
    const json = harness(new FakeRunner([]), setup.environment)
    expect(await json.run(['host', 'list', '--json'])).toBe(0)
    expect(JSON.parse(json.output().stdout)).toEqual({
      schema: 'techne/host-list/v1',
      selection: null,
      hosts: [
        { name: 'agent-host', recipe: 'agent-host', provider: 'aws', selected: false },
        { name: 'spare', recipe: 'agent-host', provider: 'aws', selected: false }
      ]
    })
    const runner = new FakeRunner([])
    const status = harness(runner, setup.environment)
    expect(await status.run(['host', 'status'])).toBe(2)
    expect(status.output().stderr).toContain(
      'several host bindings and none selected; available: agent-host, spare; choose one with --host <name>'
    )
    expect(runner.calls).toHaveLength(0)
  })

  test('requires --host for every command that changes a host, even when selection would succeed', async () => {
    const environments: [string, FixtureOptions, Record<string, string>][] = [
      ['sole binding', { config: null }, {}],
      ['TECHNE_HOST', { bindings: two, config: null }, { TECHNE_HOST: 'agent-host' }],
      ['default_host', { bindings: two, config: 'default_host = "agent-host"\n' }, {}]
    ]
    for (const [label, options, environment] of environments) {
      const setup = fixture(options)
      const names = Object.keys(options.bindings ?? { 'agent-host': '' }).join(', ')
      for (const command of ['setup', 'start', 'stop', 'rebuild', 'withdraw']) {
        for (const dry of [[], ['--dry-run']]) {
          const runner = new FakeRunner([])
          const cli = harness(runner, { ...setup.environment, ...environment })
          expect(await cli.run(['host', command, ...dry]), `${label} ${command} ${dry}`).toBe(2)
          expect(cli.output().stderr).toContain(
            `techne: error: host ${command} changes a host and requires --host <name>; available: ${names}\n`
          )
          expect(cli.output().stderr).toContain(`Usage: techne [global options] host ${command} --host <name>`)
          expect(runner.calls).toHaveLength(0)
        }
      }
    }
    const none = harness(new FakeRunner([]), fixture({ bindings: {} }).environment)
    expect(await none.run(['host', 'stop'])).toBe(2)
    expect(none.output().stderr).toContain(
      'host stop changes a host and requires --host <name>; no host binding exists; add one with techne host add'
    )
  })

  test('refuses host commands with no binding file, naming techne host add', async () => {
    const setup = fixture({ bindings: {} })
    for (const command of [
      ['host', 'status'],
      ['host', 'connect'],
      ['host', 'list'],
      ['host', 'stop', '--host', 'x']
    ]) {
      const runner = new FakeRunner([])
      const cli = harness(runner, setup.environment)
      expect(await cli.run(command)).toBe(1)
      expect(cli.output().stderr).toBe(
        'techne: error: no host binding is configured; add one with techne host add <name> --recipe <recipe>\n'
      )
      expect(runner.calls).toHaveLength(0)
    }
    const all = harness(new FakeRunner([]), setup.environment)
    expect(await all.run(['host', 'status', '--all'])).toBe(1)
    expect(all.output().stderr).toContain('no host binding is configured')
  })

  test('refuses invalid bindings before any provider call', async () => {
    const cases: [string, string][] = [
      ['schema = "techne/host-binding/v0"\nname = "bad"\nrecipe = "agent-host"\n', 'schema must be'],
      [binding('other'), 'name other does not match the file name bad'],
      [binding('bad', ''), 'needs exactly one provider table, such as [aws]; found 0'],
      [binding('bad', `${AWS_TABLE}[stub]\n`), 'unknown field stub'],
      [binding('bad', '[gcp]\n'), 'unknown field gcp'],
      [binding('bad', `provider = "aws"\n${AWS_TABLE}`), 'unknown field provider'],
      [binding('bad', `colour = "blue"\n${AWS_TABLE}`), 'unknown field colour'],
      [binding('bad', `${AWS_TABLE}bucket = "b"\n`), '[aws]: unknown field bucket'],
      [binding('bad', `${AWS_TABLE}tag = ""\n`), 'aws.tag must be a non-empty value'],
      [binding('bad', `workspace = []\n${AWS_TABLE}`), 'workspace must be a non-empty value'],
      [binding('bad', AWS_TABLE, 'missing'), 'unknown recipe missing; available: agent-host, multi'],
      [binding('bad', AWS_TABLE, 'multi'), 'workspace is required by recipe multi'],
      ['name = ', 'is not valid TOML']
    ]
    for (const [text, message] of cases) {
      const runner = new FakeRunner([])
      const cli = harness(runner, fixture({ bindings: { bad: text } }).environment)
      expect(await cli.run(['host', 'status']), message).toBe(1)
      expect(cli.output().stderr, message).toContain(message)
      expect(runner.calls).toHaveLength(0)
    }
    const unsupported = harness(
      new FakeRunner([]),
      fixture({ bindings: { bad: binding('bad', '[stub]\n') } }).environment,
      LOCAL_RUNTIME,
      true,
      [],
      [...PROVIDERS, stubProvider([])]
    )
    expect(await unsupported.run(['host', 'status'])).toBe(1)
    expect(unsupported.output().stderr).toContain('recipe agent-host does not support provider stub; it supports aws')
  })

  test('refuses two bindings that share a host, tailnet or provider identity', async () => {
    const cases: [string, string, string][] = [
      ['host_name = "shared"\n', 'host_name = "shared"\n', 'share host name shared'],
      ['tailscale_name = "t"\n', 'tailscale_name = "t"\n', 'share tailscale name t'],
      ['', `[aws]\ntag = "agent-host"\naccount = "${ACCOUNT}"\nregion = "eu-west-1"\n`, 'share AWS tag agent-host'],
      [
        '',
        `${AWS_TABLE}stack_name = "ki-techne-agent-host"\n`,
        `share AWS stack name ki-techne-agent-host in ${ACCOUNT}/eu-west-1`
      ]
    ]
    for (const [first, second, message] of cases) {
      const firstBody = first.startsWith('[') ? first : `${first}${AWS_TABLE}`
      const secondBody = second.includes('[aws]') ? second : `${second}${AWS_TABLE}`
      const setup = fixture({
        bindings: { 'agent-host': binding('agent-host', firstBody), other: binding('other', secondBody) }
      })
      const cli = harness(new FakeRunner([]), setup.environment)
      expect(await cli.run(['host', 'list']), message).toBe(1)
      expect(cli.output().stderr).toContain(`bindings agent-host and other ${message}`)
    }
  })

  test('refuses manifests that do not meet the recipe schema', async () => {
    const cases: [Record<string, string> | null, string][] = [
      [null, 'has no recipes/; update the ki-techne-harness checkout'],
      [{ x: 'schema = "techne/recipe/v0"\n' }, 'recipe recipes/x/recipe.toml: schema must be "techne/recipe/v1"'],
      [{ x: 'schema = "techne/recipe/v1"\nname = "y"\n' }, 'name y does not match its directory'],
      [{ x: 'schema = "techne/recipe/v1"\nname = "x"\n' }, 'no [providers.<provider>] table'],
      [{ x: 'schema = "techne/recipe/v1"\nname = "x"\nproviders = { aws = 1 }\n' }, 'providers.aws must be a table'],
      [{ x: 'schema = "techne/recipe/v1"\nname = "x"\n[providers.aws]\n' }, 'summary is required'],
      [
        {
          x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\nparameters = 1\n[providers.aws]\n'
        },
        'parameters must be a table'
      ],
      [
        {
          x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\n[paths]\nsetup = 1\n[providers.aws]\n'
        },
        'paths.setup must be a string'
      ],
      [
        {
          x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\nparameters.a = 1\n[providers.aws]\n'
        },
        'parameters.a must be a table'
      ],
      [
        {
          x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\nparameters.a.required = "yes"\n[providers.aws]\n'
        },
        'required must be true or false'
      ],
      [
        {
          x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\nparameters.a.default = {}\n[providers.aws]\n'
        },
        'default must be a string, number, boolean or string list'
      ],
      [
        {
          x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\nparameters.a.scripts = "setup"\n[providers.aws]\n'
        },
        'scripts must be a list of script names'
      ],
      [
        {
          x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\nfootprint = "all"\n[providers.aws]\n'
        },
        'footprint must be a list'
      ],
      [
        {
          x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\nfootprint = [1]\n[providers.aws]\n'
        },
        'each footprint entry must be a string or a table with a name or description'
      ],
      [
        {
          x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\nfootprint = [{}]\n[providers.aws]\n'
        },
        'each footprint entry must be a string or a table with a name or description'
      ]
    ]
    for (const [recipes, message] of cases) {
      const runner = new FakeRunner([])
      const cli = harness(runner, fixture({ recipes, bindings: {} }).environment)
      expect(await cli.run(['recipe', 'list']), message).toBe(1)
      expect(cli.output().stderr, message).toContain(message)
    }
    const cyclic = fixture({
      recipes: {
        x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\nparameters.host_name.default = "{tailscale_name}"\nparameters.tailscale_name.default = "{host_name}"\n[providers.aws]\n'
      },
      bindings: { a: binding('a', AWS_TABLE, 'x') }
    })
    const cli = harness(new FakeRunner([]), cyclic.environment)
    expect(await cli.run(['host', 'list'])).toBe(1)
    expect(cli.output().stderr).toContain('recipe x defaults refer to each other at')
  })

  test('leaves a value absent when its default names an absent value', async () => {
    const recipe = AGENT_HOST.replace('default = "~/workspaces/kit"', 'default = "{aws.missing}"')
    const setup = fixture({ recipes: { 'agent-host': recipe } })
    const runner = new FakeRunner([
      operator(),
      hosts([INSTANCE, 'running']),
      response(workspaceDocument()),
      response(WORKSPACE_REPORT)
    ])
    expect(await harness(runner, setup.environment).run(['host', 'status'])).toBe(0)
    expect(runner.calls[2]?.env).not.toHaveProperty('KI_AGENT_HOST_WORKSPACE')
  })

  test('refuses a missing or unset harness checkout', async () => {
    const homeless = harness(new FakeRunner([]), {})
    expect(await homeless.run(['recipe', 'list'])).toBe(1)
    expect(homeless.output().stderr).toContain(
      'no ki-techne-harness checkout is configured; set --harness-dir or TECHNE_HARNESS_DIR'
    )
    const nowhere = harness(new FakeRunner([]), { TECHNE_HARNESS_DIR: fixture().harness })
    expect(await nowhere.run(['host', 'list'])).toBe(1)
    expect(nowhere.output().stderr).toContain('cannot locate the techne configuration: set XDG_CONFIG_HOME or HOME')
    const absent = harness(new FakeRunner([]), { HOME: '/nowhere', XDG_CONFIG_HOME: '/nowhere/config' })
    expect(await absent.run(['recipe', 'list'])).toBe(1)
    expect(absent.output().stderr).toContain(
      'ki-techne-harness checkout not found at /nowhere/workspaces/knowledge-islands/ki-techne-harness'
    )
  })
})

describe('host commands', () => {
  test('reports the one selected host under the operator role through the recipe selectors', async () => {
    const setup = fixture()
    const runner = new FakeRunner([operator(), hosts([INSTANCE, 'running']), response(workspaceDocument())])
    const cli = harness(runner, setup.environment)
    expect(await cli.run(['host', 'status', '--json'])).toBe(0)
    const report = JSON.parse(cli.output().stdout)
    expect(report).toMatchObject({
      schema: 'techne/host-status/v3',
      host: 'agent-host',
      state: 'running',
      workspace: {
        state: 'reported',
        outcome: 'clean',
        safety: JSON.parse(workspaceDocument()),
        report: null,
        detail: null,
        updates: UPDATES
      }
    })
    expect(runner.calls[0]?.args).toContain(OPERATOR)
    expect(runner.calls[1]?.args).toEqual(DESCRIBE)
    expect(runner.calls[2]).toEqual({
      command: 'bash',
      args: [join(setup.harness, 'operations/aws/agent-host/status.sh'), '--json'],
      mode: 'capture',
      cwd: setup.harness,
      env: STATUS_ENV
    })
    expect(runner.calls).toHaveLength(3)
    expect(cli.output().stdout).not.toContain(ACCOUNT)
  })
  test('renders human host status for absent, running and failed workspaces', async () => {
    const setup = fixture()
    const absent = harness(new FakeRunner([operator(), hosts()]), setup.environment)
    expect(await absent.run(['host', 'status'])).toBe(4)
    expect(absent.output().stdout).toContain('state: absent')
    expect(absent.output().stdout).toContain('safety: unknown')
    for (const report of ['', WORKSPACE_REPORT]) {
      const runner = new FakeRunner([
        operator(),
        hosts([INSTANCE, 'running']),
        response(workspaceDocument()),
        response(report)
      ])
      const cli = harness(runner, setup.environment)
      expect(await cli.run(['host', 'status'])).toBe(0)
      expect(cli.output().stdout).toContain(`workspace: reported by the recipe's status script\n${report}`)
    }
    const failing = harness(
      new FakeRunner([operator(), hosts([INSTANCE, 'running']), response('', 'raw-secret', 1)]),
      setup.environment
    )
    expect(await failing.run(['host', 'status'])).toBe(1)
    expect(failing.output().stdout).toContain('workspace: failed')
    expect(failing.output().stderr).not.toContain('raw-secret')
    const scriptless = fixture({ scripts: [] })
    const missing = harness(new FakeRunner([operator(), hosts([INSTANCE, 'running'])]), scriptless.environment)
    expect(await missing.run(['host', 'status', '--json'])).toBe(1)
    expect(JSON.parse(missing.output().stdout).workspace.safety).toBeNull()
  })
  test('reports every binding with --all and exits 1 when any fails', async () => {
    const log: string[] = []
    const setup = fixture({
      bindings: {
        'agent-host': binding('agent-host'),
        broken: binding('broken', '[aws]\n'),
        zoned: binding('zoned', '[stub]\nzone = "z1"\n', 'multi').replace('recipe =', 'workspace = "w"\nrecipe =')
      }
    })
    const runner = new FakeRunner([operator(), hosts([INSTANCE, 'stopped']), response('stub report')])
    const cli = harness(runner, setup.environment, LOCAL_RUNTIME, true, [], [...PROVIDERS, stubProvider(log)])
    expect(await cli.run(['host', 'status', '--all', '--json'])).toBe(1)
    const report = JSON.parse(cli.output().stdout)
    expect(report.schema).toBe('techne/host-status-list/v2')
    expect(report.hosts).toEqual([
      expect.objectContaining({ host: 'agent-host', state: 'stopped', provider: 'aws' }),
      {
        host: 'broken',
        error:
          'no AWS profile for host broken is configured; set --aws-profile, aws.admin_profile in ' +
          `${join(setup.configuration, 'hosts/broken.toml')} or AWS_PROFILE`
      },
      expect.objectContaining({
        host: 'zoned',
        provider: 'stub',
        zone: 'z1',
        workspace: {
          state: 'reported',
          report: 'stub report',
          safety: null,
          outcome: 'unknown',
          detail: 'recipe declares no structured safety contract'
        }
      })
    ])
    expect(runner.calls[2]?.env).toEqual({ MULTI_HOST: 'multi-zoned', STUB_ZONE: 'z1', STUB_TOKEN_FREE: 'yes' })

    const human = harness(
      new FakeRunner([operator(), hosts(), response('stub report')]),
      { ...setup.environment, AWS_PROFILE: 'p', AWS_REGION: 'r' },
      LOCAL_RUNTIME,
      true,
      [],
      [...PROVIDERS, stubProvider([])]
    )
    expect(await human.run(['host', 'status', '--all'])).toBe(1)
    expect(human.output().stdout).toContain('host: agent-host (recipe agent-host, provider aws)\n')
    expect(human.output().stdout).toContain('\n\nhost: broken\nerror: no AWS account for host broken')
    expect(human.output().stdout).toContain('\n\nhost: zoned (recipe multi, provider stub)\n')

    const healthy = harness(new FakeRunner([operator(), hosts()]), fixture().environment)
    expect(await healthy.run(['host', 'status', '--all'])).toBe(4)

    const failing = harness(
      new FakeRunner([operator(), hosts([INSTANCE, 'running']), response('', 'down', 1)]),
      fixture().environment
    )
    expect(await failing.run(['host', 'status', '--all'])).toBe(1)

    const unexpected = harness(
      new FakeRunner([]),
      fixture({
        bindings: { zoned: binding('zoned', '[stub]\n', 'multi').replace('recipe =', 'workspace = "w"\nrecipe =') }
      }).environment,
      LOCAL_RUNTIME,
      true,
      [],
      [...PROVIDERS, stubProvider([], 'error')]
    )
    expect(await unexpected.run(['host', 'status', '--all'])).toBe(1)
    expect(unexpected.output().stdout).toContain('error: host report unavailable')
    expect(unexpected.output().stdout + unexpected.output().stderr).not.toContain('stub exploded')
  })

  test('refuses --all with --host or any provider option', async () => {
    const setup = fixture()
    for (const [args, message] of [
      [['--host', 'agent-host'], '--all and --host cannot be combined'],
      [['--aws-profile', 'p'], '--aws-profile would apply to every host; provider options are not supported with --all']
    ] as const) {
      const runner = new FakeRunner([])
      const cli = harness(runner, setup.environment)
      expect(await cli.run(['host', 'status', '--all', ...args])).toBe(2)
      expect(cli.output().stderr).toContain(message)
      expect(runner.calls).toHaveLength(0)
    }
  })

  test('resolves each host field by flag, then binding, then AWS environment, and refuses with none', async () => {
    const flagged = new FakeRunner([operator('ki-techne-agent-host-operator', '222222222222'), hosts()])
    const cli = harness(flagged, { ...fixture().environment, AWS_PROFILE: 'environment', AWS_REGION: 'environment' })
    expect(
      await cli.run([
        'host',
        'status',
        '--aws-profile',
        'flag-admin',
        '--aws-region',
        'flag-region',
        '--aws-account',
        '222222222222',
        '--aws-operator-profile',
        'flag-operator'
      ])
    ).toBe(4)
    for (const call of flagged.calls) {
      expect(call.env).toEqual({ AWS_PROFILE: 'flag-admin', AWS_REGION: 'flag-region' })
      expect(call.args).toContain('flag-operator')
    }
    expect(flagged.calls[1]?.args.slice(-2)).toEqual(['--region', 'flag-region'])

    const bare = `[aws]\naccount = "${ACCOUNT}"\noperator_profile = "op"\n`
    const ambient = new FakeRunner([operator(), hosts()])
    const ambientCli = harness(ambient, {
      ...fixture({ bindings: { 'agent-host': binding('agent-host', bare) } }).environment,
      AWS_PROFILE: 'environment-admin',
      AWS_REGION: 'environment-region'
    })
    expect(await ambientCli.run(['host', 'status'])).toBe(4)
    expect(ambient.calls[1]?.env).toEqual({ AWS_PROFILE: 'environment-admin', AWS_REGION: 'environment-region' })

    const setup = fixture({ bindings: { 'agent-host': binding('agent-host', '[aws]\n') } })
    const file = join(setup.configuration, 'hosts/agent-host.toml')
    const refusals: [Record<string, string>, string][] = [
      [
        {},
        `no AWS profile for host agent-host is configured; set --aws-profile, aws.admin_profile in ${file} or AWS_PROFILE`
      ],
      [
        { AWS_PROFILE: 'p' },
        `no AWS region for host agent-host is configured; set --aws-region, aws.region in ${file} or AWS_REGION`
      ],
      [
        { AWS_PROFILE: 'p', AWS_REGION: 'r' },
        `no AWS account for host agent-host is configured; set --aws-account or aws.account in ${file}`
      ]
    ]
    for (const [environment, message] of refusals) {
      const runner = new FakeRunner([])
      const refused = harness(runner, { ...setup.environment, ...environment })
      expect(await refused.run(['host', 'status'])).toBe(1)
      expect(refused.output().stderr).toBe(`techne: error: ${message}\n`)
      expect(runner.calls).toHaveLength(0)
    }
    const operatorless = harness(new FakeRunner([]), { ...setup.environment, AWS_PROFILE: 'p', AWS_REGION: 'r' })
    expect(await operatorless.run(['host', 'status', '--aws-account', ACCOUNT])).toBe(1)
    expect(operatorless.output().stderr).toContain(
      `no AWS operator profile for host agent-host is configured; set --aws-operator-profile or aws.operator_profile in ${file}`
    )
  })

  test('refuses a provider option that does not fit the selected target', async () => {
    const setup = fixture()
    const cases: [string[], string][] = [
      [['host', 'status', '--aws-controller-stack', 's'], '--aws-controller-stack does not apply to a host'],
      [['host', 'connect', '--aws-controller-stack', 's'], '--aws-controller-stack does not apply to a host'],
      [
        ['controller', 'status', '--aws-operator-profile', 'p'],
        '--aws-operator-profile does not apply to the controller'
      ],
      [
        ['recipe', 'list', '--aws-profile', 'p'],
        '--aws-profile is not supported for recipe list; it has no host or controller target'
      ],
      [['host', 'list', '--aws-region', 'r'], '--aws-region is not supported for host list'],
      [
        ['host', 'add', 'x', '--recipe', 'agent-host', '--aws-region', 'r'],
        '--aws-region is not supported for host add'
      ],
      [['completion', 'bash', '--aws-region', 'r'], '--aws-region is not supported for completion bash']
    ]
    for (const [args, message] of cases) {
      const runner = new FakeRunner([])
      const cli = harness(runner, setup.environment)
      expect(await cli.run(args), args.join(' ')).toBe(2)
      expect(cli.output().stderr).toContain(message)
      expect(runner.calls).toHaveLength(0)
    }
    const stubbed = fixture({
      bindings: { zoned: binding('zoned', '[stub]\n', 'multi').replace('recipe =', 'workspace = "w"\nrecipe =') },
      config: '[controller.stub]\nendpoint = "e"\n'
    })
    for (const args of [
      ['host', 'status', '--aws-profile', 'p'],
      ['controller', 'status', '--aws-region', 'r']
    ]) {
      const runner = new FakeRunner([])
      const cli = harness(runner, stubbed.environment, LOCAL_RUNTIME, true, [], [...PROVIDERS, stubProvider([])])
      expect(await cli.run(args)).toBe(2)
      expect(cli.output().stderr).toMatch(
        /--aws-(profile|region) does not apply to (host zoned|the controller), whose provider is stub/
      )
      expect(runner.calls).toHaveLength(0)
    }
  })

  test('runs the recipe setup script from the harness checkout with only its declared variables', async () => {
    const setup = fixture()
    const script = join(setup.harness, 'operations/aws/agent-host/setup.sh')
    const runner = new FakeRunner([response(), response(), response()])
    const cli = harness(runner, setup.environment)

    expect(await cli.run(['host', 'setup', '--host', 'agent-host', '--pull'])).toBe(0)
    expect(runner.calls).toEqual([
      { command: 'tailscale', args: ['status'], mode: 'capture' },
      {
        command: 'tailscale',
        args: ['ping', '-c', '1', '--timeout=10s', '--until-direct=false', 'ki-techne-agent-host'],
        mode: 'capture'
      },
      {
        command: 'bash',
        args: [script, '--pull'],
        mode: 'interactive',
        cwd: setup.harness,
        env: {
          AGENT_HOST_NAME: 'ki-techne-agent-host',
          AGENT_HOST_TAILSCALE_NAME: 'ki-techne-agent-host',
          AGENT_HOST_REPOSITORIES: 'operations/aws/agent-host/host/repositories.txt',
          KI_AGENT_HOST_WORKSPACE: '~/workspaces/kit',
          ...AWS_ENV
        }
      }
    ])
    expect(cli.output().stdout).toBe(`running bash ${script} --pull for host agent-host\n`)

    const plain = new FakeRunner([response(), response(), response()])
    expect(await harness(plain, setup.environment).run(['host', 'setup', '--host', 'agent-host'])).toBe(0)
    expect(plain.calls[2]?.args).toEqual([script])

    const dry = new FakeRunner([response(), response()])
    const dryCli = harness(dry, setup.environment)
    expect(await dryCli.run(['host', 'setup', '--host', 'agent-host', '--dry-run', '--pull'])).toBe(0)
    expect(dryCli.output().stdout).toBe(`dry run: would run bash ${script} --pull for host agent-host\n`)
    expect(dry.calls.map((call) => call.command)).toEqual(['tailscale', 'tailscale'])

    const failed = harness(new FakeRunner([response(), response(), response('', '', 3)]), setup.environment)
    expect(await failed.run(['host', 'setup', '--host', 'agent-host'])).toBe(1)
    expect(failed.output().stderr).toContain('harness setup failed with exit status 3')

    const unreachable = new FakeRunner([response('', 'stopped', 1)])
    const unreachableCli = harness(unreachable, setup.environment)
    expect(await unreachableCli.run(['host', 'setup', '--host', 'agent-host'])).toBe(1)
    expect(unreachableCli.output().stderr).toContain('Tailscale is not up')
    expect(unreachable.calls).toHaveLength(1)

    const overridden = fixture({
      bindings: {
        'agent-host': binding('agent-host', `tailscale_name = "elsewhere"\nworkspace = ["~/a", "~/b"]\n${AWS_TABLE}`)
      }
    })
    const custom = new FakeRunner([response(), response(), response()])
    expect(await harness(custom, overridden.environment).run(['host', 'setup', '--host', 'agent-host'])).toBe(0)
    expect(custom.calls[1]?.args.at(-1)).toBe('elsewhere')
    expect(custom.calls[2]?.env).toMatchObject({
      AGENT_HOST_TAILSCALE_NAME: 'elsewhere',
      KI_AGENT_HOST_WORKSPACE: '~/a\n~/b'
    })
  })

  test('refuses host setup without the recipe script or a Tailscale name before running anything', async () => {
    const scriptless = fixture({ scripts: [] })
    const runner = new FakeRunner([])
    const cli = harness(runner, scriptless.environment)
    expect(await cli.run(['host', 'setup', '--host', 'agent-host'])).toBe(1)
    expect(cli.output().stderr).toContain(
      `${scriptless.harness} has no operations/aws/agent-host/setup.sh; update the ki-techne-harness checkout`
    )
    expect(runner.calls).toHaveLength(0)

    const pathless = fixture({
      recipes: {
        x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\n[providers.aws.selectors]\ntag_key = "k"\ntag_value = "{name}"\noperator_role = "r"\n'
      },
      bindings: { a: binding('a', AWS_TABLE, 'x') }
    })
    for (const command of [
      ['host', 'setup', '--host', 'a'],
      ['host', 'connect']
    ]) {
      const refused = harness(new FakeRunner([]), pathless.environment)
      expect(await refused.run(command)).toBe(1)
      expect(refused.output().stderr).toMatch(
        /recipe x declares no setup script under \[paths\]|host a has no tailscale_name/
      )
    }
  })

  test('refuses credentials that are not the operator role before any EC2 call', async () => {
    for (const identityResponse of [
      operator('AWSAdministratorAccess'),
      operator('ki-techne-agent-host-operator-other'),
      operator(undefined, '999999999999'),
      response(JSON.stringify({ Account: ACCOUNT }))
    ]) {
      const runner = new FakeRunner([identityResponse])
      const cli = harness(runner, fixture().environment)

      for (const command of ['status', 'start', 'stop']) {
        expect(await cli.run(['host', command, '--host', 'agent-host'])).toBe(1)
      }
      expect(cli.output().stderr).toMatch(/refusing (credentials|AWS account)/)
      expect(ec2Operations(runner)).toEqual([])
    }
  })

  test('refuses an incomplete recipe selector before any AWS call', async () => {
    const recipe = AGENT_HOST.replace('tag_value = "{aws.tag}"', 'tag_value = "{aws.missing}"')
    const setup = fixture({ recipes: { 'agent-host': recipe } })
    const runner = new FakeRunner([])
    const cli = harness(runner, setup.environment)
    expect(await cli.run(['host', 'status'])).toBe(1)
    expect(cli.output().stderr).toContain(
      'no AWS selector tag_value for host agent-host is configured; set providers.aws.selectors.tag_value in recipe agent-host'
    )
    expect(runner.calls).toHaveLength(0)

    const nameless = fixture({ recipes: { 'agent-host': AGENT_HOST.replace('name_tag = "{host_name}"\n', '') } })
    const unnamed = new FakeRunner([operator(), hosts()])
    expect(await harness(unnamed, nameless.environment).run(['host', 'status'])).toBe(4)
    expect(unnamed.calls[1]?.args).not.toContain('Name=tag:Name,Values=ki-techne-agent-host')
  })

  test('derives the selectors and footprint of a second binding from its own name', async () => {
    const setup = fixture({ bindings: { lab: binding('lab') } })
    const runner = new FakeRunner([
      operator('ki-techne-lab-operator'),
      hosts([INSTANCE, 'running']),
      response(workspaceDocument()),
      response(WORKSPACE_REPORT)
    ])
    const cli = harness(runner, setup.environment)
    expect(await cli.run(['host', 'status', '--host', 'lab'])).toBe(0)
    expect(runner.calls[1]?.args).toContain('Name=tag:ki-agent-host-id,Values=lab')
    const dryRunner = new FakeRunner([])
    const dry = harness(dryRunner, setup.environment)
    expect(await dry.run(['host', 'rebuild', '--host', 'lab', '--dry-run'])).toBe(0)
    expect(dry.output().stdout).toContain('tailnet device ki-techne-lab')
    expect(dryRunner.calls).toHaveLength(0)
  })
  test('refuses several matching instances and a missing host', async () => {
    const several = new FakeRunner([operator(), hosts([INSTANCE, 'running'], ['i-0fedcba9876543210', 'stopped'])])
    const cli = harness(several, fixture().environment)
    expect(await cli.run(['host', 'stop', '--host', 'agent-host'])).toBe(1)
    expect(cli.output().stderr).toContain(
      `more than one instance tagged ki-agent-host-id=agent-host, Name=ki-techne-agent-host: ${INSTANCE}, i-`
    )
    expect(ec2Operations(several)).toEqual(['describe-instances'])

    const missing = harness(new FakeRunner([operator(), hosts()]), fixture().environment)
    expect(await missing.run(['host', 'start', '--host', 'agent-host'])).toBe(1)
    expect(missing.output().stderr).toContain('host agent-host has no instance')
  })

  test('starts only a stopped host and waits until it runs', async () => {
    const setup = fixture()
    const runner = new FakeRunner([operator(), hosts([INSTANCE, 'stopped'])])
    const cli = harness(runner, setup.environment)
    expect(await cli.run(['host', 'start', '--host', 'agent-host'])).toBe(0)
    expect(ec2Operations(runner)).toEqual(['describe-instances', 'start-instances', 'wait'])
    expect(runner.calls.at(-1)?.args.slice(0, 5)).toEqual([
      'ec2',
      'wait',
      'instance-running',
      '--instance-ids',
      INSTANCE
    ])
    expect(runner.calls.at(-1)?.env).toEqual(AWS_ENV)
    expect(cli.output().stdout).toContain(`started ${INSTANCE}`)

    const running = new FakeRunner([operator(), hosts([INSTANCE, 'running'])])
    const noop = harness(running, setup.environment)
    expect(await noop.run(['host', 'start', '--host', 'agent-host'])).toBe(0)
    expect(noop.output().stdout).toContain('already running; nothing to do')
    expect(ec2Operations(running)).toEqual(['describe-instances'])

    const stopping = harness(new FakeRunner([operator(), hosts([INSTANCE, 'stopping'])]), setup.environment)
    expect(await stopping.run(['host', 'start', '--host', 'agent-host'])).toBe(1)
    expect(stopping.output().stderr).toContain('host agent-host is stopping; try again shortly')

    const dry = new FakeRunner([operator(), hosts([INSTANCE, 'stopped'])])
    const dryCli = harness(dry, setup.environment)
    expect(await dryCli.run(['host', 'start', '--host', 'agent-host', '--dry-run'])).toBe(0)
    expect(dryCli.output().stdout).toContain(`dry run: would start ${INSTANCE}`)
    expect(ec2Operations(dry)).toEqual(['describe-instances'])

    for (const [responses, message] of [
      [[response('', 'denied', 1)], 'agent host start failed: denied'],
      [[response(), response('', 'timed out', 255)], 'agent host did not reach running: timed out']
    ] as const) {
      const failing = harness(new FakeRunner([operator(), hosts([INSTANCE, 'stopped']), ...responses]), {
        ...setup.environment
      })
      expect(await failing.run(['host', 'start', '--host', 'agent-host'])).toBe(1)
      expect(failing.output().stderr).toContain(message)
    }
  })

  test('stops only a running host', async () => {
    const setup = fixture()
    for (const now of [[], ['--now']]) {
      const runner = new FakeRunner([operator(), hosts([INSTANCE, 'running']), response()])
      const cli = harness(runner, setup.environment)
      expect(await cli.run(['host', 'stop', '--host', 'agent-host', ...now])).toBe(0)
      expect(ec2Operations(runner)).toEqual(['describe-instances'])
      expect(runner.calls[2]).toMatchObject({
        command: 'bash',
        args: [join(setup.harness, 'operations/aws/agent-host/stop.sh'), ...now],
        mode: 'interactive',
        cwd: setup.harness,
        env: { AWS_PROFILE: OPERATOR, AWS_REGION: 'eu-west-1', EXPECTED_AWS_ACCOUNT: ACCOUNT }
      })
      expect(runner.calls).toHaveLength(3)
    }
    for (const state of ['stopped', 'stopping']) {
      const runner = new FakeRunner([operator(), hosts([INSTANCE, state])])
      expect(await harness(runner, setup.environment).run(['host', 'stop', '--host', 'agent-host'])).toBe(0)
      expect(runner.calls).toHaveLength(2)
    }
    const dry = new FakeRunner([operator(), hosts([INSTANCE, 'running'])])
    expect(await harness(dry, setup.environment).run(['host', 'stop', '--host', 'agent-host', '--dry-run'])).toBe(0)
    expect(dry.calls).toHaveLength(2)
    const failed = harness(
      new FakeRunner([operator(), hosts([INSTANCE, 'running']), response('', 'raw-secret', 1)]),
      setup.environment
    )
    expect(await failed.run(['host', 'stop', '--host', 'agent-host'])).toBe(1)
    expect(failed.output().stderr).toBe('techne: error: harness stop failed with exit status 1\n')
    const noScript = new FakeRunner([])
    expect(
      await harness(
        noScript,
        fixture({ recipes: { 'agent-host': AGENT_HOST.replace('stop = "operations/aws/agent-host/stop.sh"', '') } })
          .environment
      ).run(['host', 'stop', '--host', 'agent-host'])
    ).toBe(1)
    expect(noScript.calls).toHaveLength(0)
  })
  test('keeps teardown as a compatibility diagnostic with zero effects', async () => {
    for (const args of [[], ['--dry-run'], ['--host', 'agent-host'], ['--host', 'agent-host', '--dry-run']]) {
      const runner = new FakeRunner([])
      const cli = harness(runner, {})
      expect(await cli.run(['host', 'teardown', ...args])).toBe(2)
      expect(cli.output().stderr).toContain('use host rebuild or host withdraw')
      expect(runner.calls).toHaveLength(0)
    }
  })
  test('refuses guarded removal outside an interactive terminal but allows a dry run', async () => {
    const setup = fixture()
    for (const operation of ['rebuild', 'withdraw']) {
      const runner = new FakeRunner([])
      const cli = harness(runner, setup.environment, LOCAL_RUNTIME, false)
      expect(await cli.run(['host', operation, '--host', 'agent-host'])).toBe(2)
      expect(cli.output().stderr).toContain('requires an interactive terminal')
      expect(runner.calls).toHaveLength(0)
      const dry = harness(runner, setup.environment, LOCAL_RUNTIME, false)
      expect(await dry.run(['host', operation, '--host', 'agent-host', '--dry-run'])).toBe(0)
      expect(dry.output().stdout).toContain('Remaining footprint')
      expect(dry.output().stdout).toContain(
        operation === 'rebuild' ? 'retain credentials' : 'remove stored credentials'
      )
      expect(runner.calls).toHaveLength(0)
    }
  })
  test('connects the selected host through Tailscale and Zed without calling AWS', async () => {
    const setup = fixture({ bindings: { 'agent-host': binding('agent-host'), lab: binding('lab') } })
    const runner = new FakeRunner([response(), response(), response()])
    const cli = harness(runner, { ...setup.environment, TECHNE_HOST: 'agent-host' })
    expect(await cli.run(['host', 'connect', '/workspaces/kit'])).toBe(0)
    expect(runner.calls.map((call) => [call.command, ...call.args])).toEqual([
      ['tailscale', 'status'],
      ['tailscale', 'ping', '-c', '1', '--timeout=10s', '--until-direct=false', 'ki-techne-agent-host'],
      ['zed', 'ssh://ki-techne-agent-host/workspaces/kit']
    ])
    expect(cli.output().stdout).toBe('opened ssh://ki-techne-agent-host/workspaces/kit in Zed\n')

    const dry = new FakeRunner([response(), response()])
    const dryCli = harness(dry, setup.environment)
    expect(await dryCli.run(['host', 'connect', '--host', 'lab', '--dry-run'])).toBe(0)
    expect(dryCli.output().stdout).toBe('dry run: would open ssh://ki-techne-lab/~ in Zed\n')
    expect(dry.calls.map((call) => call.command)).toEqual(['tailscale', 'tailscale'])
  })

  test('accepts a host that answers only through a DERP relay', async () => {
    // Models `tailscale ping`: a relayed pong exits 1 ("direct connection not established")
    // unless --until-direct=false, as seen against a freshly rebuilt host.
    class RelayedTailscale implements CommandRunner {
      async run(command: string, args: readonly string[]): Promise<CommandResult> {
        const relayedOnly = command === 'tailscale' && args[0] === 'ping' && !args.includes('--until-direct=false')
        return relayedOnly
          ? {
              exitCode: 1,
              stdout: 'pong from ki-techne-agent-host via DERP(lhr) in 26ms\n',
              stderr: 'direct connection not established\n'
            }
          : { exitCode: 0, stdout: '', stderr: '' }
      }
    }
    const cli = harness(new RelayedTailscale(), fixture().environment)
    expect(await cli.run(['host', 'connect'])).toBe(0)
    expect(cli.output().stdout).toBe('opened ssh://ki-techne-agent-host/~ in Zed\n')
  })

  test('refuses to connect when Tailscale or the editor fails', async () => {
    const setup = fixture()
    const down = harness(new FakeRunner([response('', 'stopped', 1)]), setup.environment)
    expect(await down.run(['host', 'connect'])).toBe(1)
    expect(down.output().stderr).toContain('Tailscale is not up')

    const silent = new FakeRunner([response(), response('', 'timeout', 1)])
    const silentCli = harness(silent, setup.environment)
    expect(await silentCli.run(['host', 'connect'])).toBe(1)
    expect(silentCli.output().stderr).toContain('ki-techne-agent-host does not answer over Tailscale')
    expect(silent.calls).toHaveLength(2)

    const editor = harness(new FakeRunner([response(), response(), response('', '', 127)]), setup.environment)
    expect(await editor.run(['host', 'connect'])).toBe(1)
    expect(editor.output().stderr).toContain('Zed could not open ssh://ki-techne-agent-host/~')

    const extra = new FakeRunner([])
    const extraCli = harness(extra, setup.environment)
    expect(await extraCli.run(['host', 'connect', 'one', 'two'])).toBe(2)
    expect(extraCli.output().stderr).toContain('host connect accepts at most one path')
    expect(extra.calls).toHaveLength(0)
  })

  test('limits options to the commands that support them', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner, fixture().environment)
    const cases: [string[], string][] = [
      [
        ['host', 'status', '--dry-run'],
        '--dry-run is only supported for host setup, start, stop, rebuild, withdraw and connect'
      ],
      [['controller', 'status', '--dry-run'], '--dry-run is only supported'],
      [['diag', '--dry-run'], '--dry-run is only supported'],
      [['host', 'status', '--pull'], '--pull is only supported for host setup'],
      [['host', 'start', '--host', 'agent-host', '--pull'], '--pull is only supported for host setup'],
      [['host', 'list', '--all'], '--all is only supported for host status'],
      [['host', 'status', '--recipe', 'x'], '--recipe and --provider are only supported for host add'],
      [['recipe', 'list', '--provider', 'aws'], '--recipe and --provider are only supported for host add'],
      [['controller', 'status', '--host', 'agent-host'], '--host is only supported for host and recipe commands'],
      [['host', 'add', 'x', '--host', 'agent-host'], '--host is only supported for host and recipe commands'],
      [['doctor', '--host', 'agent-host'], '--host is only supported for host and recipe commands'],
      [['host', 'status', '--host'], '--host requires a value'],
      [['host', 'status', '--aws-profile', '--json'], '--aws-profile requires a value']
    ]
    for (const [args, message] of cases) {
      expect(await cli.run(args), args.join(' ')).toBe(2)
      expect(cli.output().stderr).toContain(message)
    }
    for (const command of ['setup', 'start', 'stop', 'rebuild', 'withdraw', 'connect']) {
      expect(await cli.run(['host', command, '--host', 'agent-host', '--json'])).toBe(2)
      expect(cli.output().stderr).toContain(`--json is not supported for host ${command}`)
    }
    expect(await cli.run(['host', 'add', 'x', '--recipe', 'agent-host', '--json'])).toBe(2)
    expect(cli.output().stderr).toContain('--json is not supported for host add')
    expect(runner.calls).toHaveLength(0)
  })

  test('reports unexpected runner failures', async () => {
    const provider: Provider = {
      ...stubProvider([]),
      controller: () => {
        throw new Error('provider initialization failed')
      }
    }
    const diagnostic = harness(
      new FakeRunner([]),
      fixture({ config: '[controller.stub]\nendpoint = "test"\n' }).environment,
      LOCAL_RUNTIME,
      true,
      [],
      [provider]
    )
    expect(await diagnostic.run(['doctor'])).toBe(1)
    expect(diagnostic.output().stderr).toContain('provider initialization failed')

    const errorCli = harness(new ThrowingRunner(new Error('boom')), fixture().environment)
    expect(await errorCli.run(['doctor'])).toBe(1)
    expect(errorCli.output().stderr).toBe('')
    expect(errorCli.output().stdout).toContain('Checks: pass=3 warn=0 fail=2 skipped=1')

    const stringCli = harness(new ThrowingRunner('boom'), fixture().environment)
    expect(await stringCli.run(['doctor'])).toBe(1)
    expect(stringCli.output().stdout).toContain('Verdict: unhealthy')
    const otherCommand = harness(new ThrowingRunner(new Error('boom')), fixture().environment)
    expect(await otherCommand.run(['controller', 'status'])).toBe(1)
    expect(otherCommand.output().stderr).toContain('Error: boom')
  })
})

const STATUS_ENV = {
  AGENT_HOST_TAILSCALE_NAME: 'ki-techne-agent-host',
  KI_AGENT_HOST_WORKSPACE: '~/workspaces/kit',
  ...AWS_ENV
}
const UPDATES = {
  os: 'ubuntu',
  pending: 7,
  security: 2,
  reboot_required: true,
  reboot_required_since: '2026-10-11T03:12:00Z',
  reboot_packages: ['linux-image-6.8.0-45-generic', 'libc6'],
  livepatch: 'enabled'
}
const UNKNOWN_UPDATES = {
  os: 'macos',
  pending: null,
  security: null,
  reboot_required: null,
  reboot_required_since: null,
  reboot_packages: null,
  livepatch: 'unsupported'
}

// A techne/host-workspace/v1 document as the recipe's `status --json` prints it.
function workspaceDocument(outcome = 'clean', members: Record<string, unknown> = { updates: UPDATES }): string {
  return JSON.stringify({
    schema: 'techne/host-workspace/v1',
    generated_at: '2026-10-12T04:30:00Z',
    host: { hostname: 'ki-techne-agent-host', id: INSTANCE },
    workspace: '~/workspaces/kit',
    fetched: false,
    outcome,
    repositories: [],
    problems: [],
    ...members
  })
}

// Answers the operator, instance and text status reads, then rejects the next call.
class RejectingRunner extends FakeRunner {
  override async run(command: string, args: readonly string[], options: RunOptions = {}): Promise<CommandResult> {
    const result = await super.run(command, args, options)
    if (this.calls.length > 3) throw new Error('ssh: raw-supplemental-secret')
    return result
  }
}

function patched(fields: string): string {
  return binding('agent-host', `${fields}\n${AWS_TABLE}`)
}

describe('host patching fields', () => {
  test('accepts absent fields, boundary windows and boolean Livepatch without passing them to setup or status', async () => {
    for (const fields of ['', 'reboot_window = "00:00"', 'reboot_window = "23:59"\nlivepatch = true']) {
      const setup = fixture({ bindings: { 'agent-host': patched(fields) } })
      const runner = new FakeRunner([
        operator(),
        hosts([INSTANCE, 'running']),
        response(workspaceDocument()),
        response(WORKSPACE_REPORT)
      ])
      expect(await harness(runner, setup.environment).run(['host', 'status'])).toBe(0)
      expect(runner.calls[2]?.env).toEqual(STATUS_ENV)
    }

    const setup = fixture({ bindings: { 'agent-host': patched('reboot_window = "04:00"\nlivepatch = false') } })
    const runner = new FakeRunner([response(), response(), response()])
    expect(await harness(runner, setup.environment).run(['host', 'setup', '--host', 'agent-host'])).toBe(0)
    expect(runner.calls[2]?.env).not.toHaveProperty('AGENT_HOST_REBOOT_WINDOW')
    expect(runner.calls[2]?.env).not.toHaveProperty('AGENT_HOST_LIVEPATCH')
  })

  test('passes the fields only to the scripts the recipe declares, keeping an explicit false', async () => {
    const recipe = AGENT_HOST.replaceAll(
      /(AGENT_HOST_(?:REBOOT_WINDOW|LIVEPATCH)"\n)scripts = \["provision"\]/g,
      '$1scripts = ["provision", "status"]'
    )
    const setup = fixture({
      recipes: { 'agent-host': recipe },
      bindings: { 'agent-host': patched('reboot_window = "04:00"\nlivepatch = false') }
    })
    const runner = new FakeRunner([
      operator(),
      hosts([INSTANCE, 'running']),
      response(workspaceDocument()),
      response(WORKSPACE_REPORT)
    ])
    expect(await harness(runner, setup.environment).run(['host', 'status'])).toBe(0)
    expect(runner.calls[2]?.env).toEqual({
      ...STATUS_ENV,
      AGENT_HOST_REBOOT_WINDOW: '04:00',
      AGENT_HOST_LIVEPATCH: 'false'
    })
  })

  test('refuses malformed windows and non-boolean Livepatch before any subprocess', async () => {
    const window = 'reboot_window must be a 24-hour HH:MM time, such as "04:00"'
    const livepatch = 'livepatch must be true or false'
    const cases: [string, string][] = [
      ['reboot_window = ""', window],
      ['reboot_window = "4:00"', window],
      ['reboot_window = "24:00"', window],
      ['reboot_window = "12:60"', window],
      ['reboot_window = "Mon 04:00"', window],
      ['reboot_window = " 04:00"', window],
      ['reboot_window = "04:00\\n"', window],
      ['reboot_window = 400', window],
      ['reboot_window = ["04:00"]', window],
      ['reboot_window = { at = "04:00" }', window],
      ['livepatch = "true"', livepatch],
      ['livepatch = 1', livepatch],
      ['livepatch = [true]', livepatch],
      ['livepatch = { on = true }', livepatch]
    ]
    for (const [fields, message] of cases) {
      const setup = fixture({ bindings: { 'agent-host': patched(fields) } })
      const runner = new FakeRunner([])
      const cli = harness(runner, setup.environment)
      expect(await cli.run(['host', 'status'])).toBe(1)
      expect(cli.output().stderr).toBe(
        `techne: error: ${join(setup.configuration, 'hosts/agent-host.toml')}: ${message}\n`
      )
      expect(runner.calls).toHaveLength(0)
    }
  })

  test('holds recipe defaults to the same forms without inventing any', async () => {
    const withDefault = (field: string, value: string) =>
      AGENT_HOST.replace(`[parameters.${field}]\n`, `[parameters.${field}]\ndefault = ${value}\n`)
    for (const [recipe, message] of [
      [withDefault('reboot_window', '"25:00"'), 'reboot_window must be a 24-hour HH:MM time'],
      [withDefault('livepatch', '"yes"'), 'livepatch must be true or false']
    ] as const) {
      const cli = harness(new FakeRunner([]), fixture({ recipes: { 'agent-host': recipe } }).environment)
      expect(await cli.run(['host', 'list'])).toBe(1)
      expect(cli.output().stderr).toContain(message)
    }
    const recipe = withDefault('livepatch', 'true').replace(
      'AGENT_HOST_LIVEPATCH"\nscripts = ["provision"]',
      'AGENT_HOST_LIVEPATCH"\nscripts = ["status"]'
    )
    const runner = new FakeRunner([
      operator(),
      hosts([INSTANCE, 'running']),
      response(workspaceDocument()),
      response(WORKSPACE_REPORT)
    ])
    expect(
      await harness(runner, fixture({ recipes: { 'agent-host': recipe } }).environment).run(['host', 'status'])
    ).toBe(0)
    expect(runner.calls[2]?.env).toEqual({ ...STATUS_ENV, AGENT_HOST_LIVEPATCH: 'true' })
  })

  test('refuses a malformed status declaration', async () => {
    const declaration = '[status]\nschema = "techne/host-workspace/v1"\n'
    for (const [replacement, message] of [
      ['[status]\n', 'recipe recipes/agent-host/recipe.toml status: schema is required'],
      [`${declaration}exit = 1\n`, 'recipe recipes/agent-host/recipe.toml status: exit must be a table'],
      [`${declaration}exit.clean = "0"\n`, 'status.exit.clean must be an exit status from 0 to 255'],
      [`${declaration}exit.clean = 256\n`, 'status.exit.clean must be an exit status from 0 to 255'],
      [`${declaration}exit.clean = 0.5\n`, 'status.exit.clean must be an exit status from 0 to 255']
    ] as const) {
      const recipe = AGENT_HOST.replace(/^\[status\][\s\S]*?unreachable = 255\n/m, replacement)
      const cli = harness(new FakeRunner([]), fixture({ recipes: { 'agent-host': recipe } }).environment)
      expect(await cli.run(['host', 'list'])).toBe(1)
      expect(cli.output().stderr).toContain(message)
    }
  })
})

const OAUTH_ITEM = 'op://Techne/ki-techne-agent-host-tailscale-oauth'

// The parameter the Harness adds once this field exists, declared for the given scripts.
function oauthRecipe(scripts: string): string {
  return `${AGENT_HOST}\n[parameters.tailscale_oauth_item]\noptional = true\nenv = "AGENT_HOST_TAILSCALE_OAUTH_ITEM"\nscripts = [${scripts}]\n`
}

describe('host Tailscale OAuth field', () => {
  test('accepts an absent field and references without passing them to scripts the recipe does not list', async () => {
    for (const fields of [
      '',
      `tailscale_oauth_item = "${OAUTH_ITEM}"`,
      'tailscale_oauth_item = "op://v/i/credential"'
    ]) {
      for (const recipe of [AGENT_HOST, oauthRecipe('"provision", "destroy"')]) {
        const setup = fixture({ recipes: { 'agent-host': recipe }, bindings: { 'agent-host': patched(fields) } })
        const runner = new FakeRunner([
          operator(),
          hosts([INSTANCE, 'running']),
          response(workspaceDocument()),
          response(WORKSPACE_REPORT)
        ])
        expect(await harness(runner, setup.environment).run(['host', 'status'])).toBe(0)
        expect(runner.calls[2]?.env).toEqual(STATUS_ENV)
      }
    }

    const setup = fixture({
      recipes: { 'agent-host': oauthRecipe('"provision", "destroy"') },
      bindings: { 'agent-host': patched(`tailscale_oauth_item = "${OAUTH_ITEM}"`) }
    })
    const runner = new FakeRunner([response(), response(), response()])
    expect(await harness(runner, setup.environment).run(['host', 'setup', '--host', 'agent-host'])).toBe(0)
    expect(runner.calls[2]?.env).not.toHaveProperty('AGENT_HOST_TAILSCALE_OAUTH_ITEM')
  })

  test('passes the reference only to the scripts the recipe declares, and nothing when unset', async () => {
    for (const [fields, expected] of [
      [`tailscale_oauth_item = "${OAUTH_ITEM}"`, { ...STATUS_ENV, AGENT_HOST_TAILSCALE_OAUTH_ITEM: OAUTH_ITEM }],
      ['', STATUS_ENV]
    ] as const) {
      const setup = fixture({
        recipes: { 'agent-host': oauthRecipe('"status", "destroy"') },
        bindings: { 'agent-host': patched(fields) }
      })
      const runner = new FakeRunner([
        operator(),
        hosts([INSTANCE, 'running']),
        response(workspaceDocument()),
        response(WORKSPACE_REPORT)
      ])
      expect(await harness(runner, setup.environment).run(['host', 'status'])).toBe(0)
      expect(runner.calls[2]?.env).toEqual(expected)
    }
  })

  test('refuses anything but a 1Password reference before any subprocess, without echoing it', async () => {
    const message = 'tailscale_oauth_item must be a 1Password reference, such as "op://<vault>/<item>"'
    for (const value of [
      '""',
      '"tskey-client-secret"',
      '"op://"',
      '"op://vault"',
      '"op://vault/"',
      '"op:///item"',
      '"op://vault//item"',
      '"op://my vault/item"',
      '"op://vault/item\\n"',
      '"OP://vault/item"',
      '" op://vault/item"',
      '1',
      '["op://vault/item"]',
      '{ ref = "op://vault/item" }'
    ]) {
      const setup = fixture({ bindings: { 'agent-host': patched(`tailscale_oauth_item = ${value}`) } })
      const runner = new FakeRunner([])
      const cli = harness(runner, setup.environment)
      expect(await cli.run(['host', 'status'])).toBe(1)
      expect(cli.output().stderr).toBe(
        `techne: error: ${join(setup.configuration, 'hosts/agent-host.toml')}: ${message}\n`
      )
      expect(runner.calls).toHaveLength(0)
    }
  })

  test('holds a recipe default to the same form', async () => {
    const recipe = oauthRecipe('"status"').replace(
      '[parameters.tailscale_oauth_item]\n',
      '[parameters.tailscale_oauth_item]\ndefault = "tskey-client-{name}"\n'
    )
    const cli = harness(new FakeRunner([]), fixture({ recipes: { 'agent-host': recipe } }).environment)
    expect(await cli.run(['host', 'list'])).toBe(1)
    expect(cli.output().stderr).toContain('tailscale_oauth_item must be a 1Password reference')
    expect(cli.output().stderr).not.toContain('tskey')
  })
})

describe('guarded host safety', () => {
  const status = async (document: CommandResult, text?: CommandResult, options: FixtureOptions = {}) => {
    const runner = new FakeRunner([operator(), hosts([INSTANCE, 'running']), document, ...(text ? [text] : [])])
    const cli = harness(runner, fixture(options).environment)
    const code = await cli.run(['host', 'status', ...(text ? [] : ['--json'])])
    return { code, runner, ...cli.output() }
  }

  test('uses one authoritative report, preserving additive data and advisory updates', async () => {
    for (const [outcome, code] of [
      ['clean', 0],
      ['at-risk', 3],
      ['unknown', 4],
      ['failed', 1],
      ['unreachable', 255]
    ] as const) {
      const result = await status(
        response(
          workspaceDocument(outcome, { updates: UPDATES, profile: { revision: 'abc' }, extra: ['signal'] }),
          '',
          code
        )
      )
      expect(result.code).toBe(code)
      const workspace = JSON.parse(result.stdout).workspace
      expect(workspace.outcome).toBe(outcome)
      expect(workspace.report).toBeNull()
      if (outcome !== 'unreachable') {
        expect(workspace.safety.extra).toEqual(['signal'])
        expect(workspace.safety.profile).toEqual({ revision: 'abc' })
        expect(workspace.updates).toEqual(UPDATES)
      }
      expect(result.runner.calls).toHaveLength(3)
      expect(result.runner.calls[2]?.args.at(-1)).toBe('--json')
      expect(result.runner.calls.flatMap((call) => call.args)).not.toContain('--fetch')
    }
    for (const [members, expected] of [
      [{ updates: null }, null],
      [{ updates: UNKNOWN_UPDATES }, UNKNOWN_UPDATES],
      [{}, undefined]
    ] as const) {
      const result = await status(response(workspaceDocument('clean', members)))
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout).workspace.updates).toEqual(expected)
    }
  })

  test('drops malformed updates without changing safety or revealing their raw value', async () => {
    const missing = { ...UPDATES } as Record<string, unknown>
    delete missing['os']
    const invalid: unknown[] = [
      'raw-secret',
      missing,
      { ...UPDATES, os: 1 },
      { ...UPDATES, pending: -1 },
      { ...UPDATES, pending: 1.5 },
      { ...UPDATES, security: 'x' },
      { ...UPDATES, reboot_required: 1 },
      { ...UPDATES, reboot_packages: [1] },
      { ...UPDATES, reboot_required_since: false },
      { ...UPDATES, livepatch: [] }
    ]
    for (const updates of invalid) {
      const result = await status(response(workspaceDocument('clean', { updates })))
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout).workspace).not.toHaveProperty('updates')
      expect(JSON.parse(result.stdout).workspace.safety).not.toHaveProperty('updates')
      expect(result.stdout + result.stderr).not.toContain('raw-secret')
    }
  })

  test('fails closed on malformed or contradictory safety evidence without raw output', async () => {
    const bad = [
      response('raw-secret'),
      response('[]'),
      response('null'),
      response(workspaceDocument('clean'), '', 3),
      response(workspaceDocument('at-risk')),
      response(workspaceDocument('surprise')),
      response(workspaceDocument('clean', { schema: 'other' })),
      response(workspaceDocument('clean', { outcome: 3 })),
      response(workspaceDocument('clean', { generated_at: null })),
      response(workspaceDocument('clean', { workspace: [] })),
      response(workspaceDocument('clean', { fetched: 'yes' })),
      response(workspaceDocument('clean', { host: 'host' })),
      response(workspaceDocument('clean', { host: { hostname: 1, id: null } })),
      response(workspaceDocument('clean', { host: { hostname: 'host', id: false } })),
      response(workspaceDocument('clean', { repositories: {} })),
      response(workspaceDocument('clean', { repositories: [null] })),
      response(workspaceDocument('clean', { problems: [1] })),
      response('', 'raw-secret', 1)
    ]
    const repository = {
      path: '/workspace/repo',
      state: 'clean',
      branch: 'main',
      dirty: 0,
      unpushed: 0,
      stashes: 0,
      upstream: { ahead: 0, behind: 0 },
      problem: null
    }
    for (const [key, value] of Object.entries({
      path: 1,
      state: 'other',
      branch: 1,
      dirty: -1,
      unpushed: false,
      stashes: 'x',
      upstream: { ahead: 0, behind: 'x' },
      problem: []
    })) {
      bad.push(response(workspaceDocument('clean', { repositories: [{ ...repository, [key]: value }] })))
    }
    for (const document of bad) {
      const result = await status(document)
      expect(result.code).toBe(1)
      expect(JSON.parse(result.stdout).workspace).toMatchObject({ state: 'failed', outcome: 'failed', safety: null })
      expect(result.stdout + result.stderr).not.toContain('raw-secret')
    }
    for (const upstream of [null, repository.upstream]) {
      expect(
        (
          await status(
            response(
              workspaceDocument('clean', {
                host: { hostname: 'host', id: null },
                repositories: [{ ...repository, upstream }]
              })
            )
          )
        ).code
      ).toBe(0)
    }
  })

  test('refuses a verdict safer than its repository or inventory evidence', async () => {
    const repo = { path: 'repo', branch: 'main', dirty: 1, unpushed: 0, stashes: 0, upstream: null, problem: null }
    for (const [outcome, state, problems, code] of [
      ['clean', 'at-risk', [], 1],
      ['clean', 'unknown', [], 1],
      ['clean', 'clean', ['missing repository'], 1],
      ['at-risk', 'unknown', [], 1],
      ['at-risk', 'at-risk', [], 3],
      ['unknown', 'unknown', [], 4]
    ] as const) {
      const result = await status(
        response(
          workspaceDocument(outcome, { repositories: [{ ...repo, state }], problems }),
          '',
          outcome === 'clean' ? 0 : outcome === 'at-risk' ? 3 : 4
        )
      )
      expect(result.code).toBe(code)
    }
    const unreachable = await status(response('', 'raw-secret', 255))
    expect(unreachable.code).toBe(255)
    expect(unreachable.stdout + unreachable.stderr).not.toContain('raw-secret')
  })

  test('keeps supplied text advisory, including expiry and pin warnings', async () => {
    for (const [outcome, code] of [
      ['clean', 0],
      ['at-risk', 3],
      ['unknown', 4]
    ] as const) {
      const text = 'Expires in 14 days EXPIRES SOON\nOverdue -2 days\nExpiry unknown\nPins DRIFT\n'
      const result = await status(response(workspaceDocument(outcome), '', code), response(text, '', code))
      expect(result.code).toBe(code)
      expect(result.stdout).toContain(text)
      expect(result.runner.calls[3]?.args.slice(-2)).toEqual(['--connect-timeout', '5'])
      expect(result.runner.calls).toHaveLength(4)
    }
    const failed = await status(response(workspaceDocument('at-risk'), '', 3), response('raw-secret', 'raw-secret', 1))
    expect(failed.code).toBe(3)
    expect(failed.stderr).toContain('advisory text report unavailable')
    expect(failed.stdout + failed.stderr).not.toContain('raw-secret')
    const runner = new RejectingRunner([operator(), hosts([INSTANCE, 'running']), response(workspaceDocument())])
    const cli = harness(runner, fixture().environment)
    expect(await cli.run(['host', 'status'])).toBe(0)
    expect(cli.output().stderr).toContain('advisory text report unavailable')
  })

  test('handles missing scripts/contracts, runner rejection and unavailable hosts conservatively', async () => {
    const legacy = AGENT_HOST.replace(/^\[status\][\s\S]*?(?=^\[operations)/m, '')
    const legacyResult = await status(response(WORKSPACE_REPORT), undefined, { recipes: { 'agent-host': legacy } })
    expect(legacyResult.code).toBe(4)
    expect(JSON.parse(legacyResult.stdout).workspace).toMatchObject({ safety: null, outcome: 'unknown' })
    expect((await status(response('', 'raw-secret', 255), undefined, { recipes: { 'agent-host': legacy } })).code).toBe(
      255
    )
    expect((await status(response('', 'raw-secret', 1), undefined, { recipes: { 'agent-host': legacy } })).code).toBe(1)
    for (const recipe of [
      AGENT_HOST.replace('host-workspace/v1', 'host-workspace/v9'),
      AGENT_HOST.replace('at-risk = 3', 'at-risk = 7'),
      AGENT_HOST.replace('status = "operations/aws/agent-host/status.sh"', '')
    ]) {
      const result = await status(response(), undefined, { recipes: { 'agent-host': recipe } })
      expect(result.code).toBe(1)
      expect(result.runner.calls).toHaveLength(2)
    }
    class RejectStatus extends FakeRunner {
      override async run(command: string, args: readonly string[], options?: RunOptions): Promise<CommandResult> {
        if (command === 'bash') throw new Error('raw-secret')
        return super.run(command, args, options)
      }
    }
    const cli = harness(new RejectStatus([operator(), hosts([INSTANCE, 'running'])]), fixture().environment)
    expect(await cli.run(['host', 'status', '--json'])).toBe(1)
    expect(cli.output().stdout + cli.output().stderr).not.toContain('raw-secret')
    for (const instance of [hosts(), hosts([INSTANCE, 'stopped'])]) {
      const runner = new FakeRunner([operator(), instance])
      const stopped = harness(runner, fixture().environment)
      expect(await stopped.run(['host', 'status', '--json'])).toBe(4)
      expect(JSON.parse(stopped.output().stdout).workspace).toMatchObject({
        state: 'skipped',
        safety: null,
        outcome: 'unknown'
      })
      expect(runner.calls).toHaveLength(2)
    }
  })

  test('aggregates mixed hosts with failure, unreachable, unknown, risk, clean precedence', async () => {
    for (const [left, right, expected] of [
      ['clean', 'clean', 0],
      ['clean', 'at-risk', 3],
      ['at-risk', 'unknown', 4],
      ['unknown', 'unreachable', 255],
      ['unreachable', 'failed', 1]
    ] as const) {
      const fixtureOptions = { bindings: { a: binding('a'), b: binding('b') } }
      const runner = new FakeRunner([
        operator('ki-techne-a-operator'),
        hosts([INSTANCE, 'running']),
        response(
          workspaceDocument(left),
          '',
          { clean: 0, 'at-risk': 3, unknown: 4, unreachable: 255, failed: 1 }[left]
        ),
        operator('ki-techne-b-operator'),
        hosts([INSTANCE, 'running']),
        response(
          workspaceDocument(right),
          '',
          { clean: 0, 'at-risk': 3, unknown: 4, unreachable: 255, failed: 1 }[right]
        )
      ])
      const cli = harness(runner, fixture(fixtureOptions).environment)
      expect(await cli.run(['host', 'status', '--all', '--json'])).toBe(expected)
      const report = JSON.parse(cli.output().stdout)
      expect(report.schema).toBe('techne/host-status-list/v2')
      expect(report.hosts).toHaveLength(2)
      expect(runner.calls).toHaveLength(6)
    }
  })

  test('continues after an unexpected provider rejection without leaking its raw failure', async () => {
    const setup = fixture({
      bindings: {
        a: binding('a', '[stub]\n', 'multi').replace('recipe =', 'workspace = "w"\nrecipe ='),
        z: binding('z')
      }
    })
    const runner = new FakeRunner([
      operator('ki-techne-z-operator'),
      hosts([INSTANCE, 'running']),
      response(workspaceDocument())
    ])
    const cli = harness(runner, setup.environment, LOCAL_RUNTIME, true, [], [...PROVIDERS, stubProvider([], 'error')])
    expect(await cli.run(['host', 'status', '--all', '--json'])).toBe(1)
    const report = JSON.parse(cli.output().stdout)
    expect(report.hosts[0]).toEqual({ host: 'a', error: 'host report unavailable' })
    expect(report.hosts[1].workspace.outcome).toBe('clean')
    expect(runner.calls).toHaveLength(3)
    expect(cli.output().stdout + cli.output().stderr).not.toContain('stub exploded')
  })

  test('delegates each guarded removal and its exact overrides without provider termination', async () => {
    const setup = fixture()
    const scenarios = [
      { label: 'clean success', args: [], exit: 0 },
      { label: 'already removed idempotence', args: [], exit: 0 },
      { label: 'exact-risk discard success', args: ['--discard', 'repo/a', 'repo/b'], exit: 0 },
      { label: 'missing risk override', args: [], exit: 1 },
      { label: 'partial risk set', args: ['--discard', 'repo/a'], exit: 1 },
      { label: 'extra risk set', args: ['--discard', 'repo/a', 'repo/b', 'repo/c'], exit: 1 },
      { label: 'unknown host refusal', args: [], exit: 4 },
      { label: 'unreachable host refusal', args: [], exit: 255 },
      { label: 'typed unreadable refusal', args: ['--discard-unreadable-host'], exit: 1 },
      { label: 'typed unreadable success', args: ['--discard-unreadable-host'], exit: 0 },
      { label: 'same-host mismatch', args: ['--discard-unreadable-host'], exit: 1 },
      { label: 'missing operator confirmation variable', args: [], exit: 1 },
      { label: 'script failure', args: [], exit: 1 }
    ]
    // These injected script decisions prove delegation and truthful handling;
    // the Harness owns the risk-set and confirmation implementation.
    for (const operation of ['rebuild', 'withdraw']) {
      for (const { label, args, exit } of scenarios) {
        const runner = new FakeRunner([response('', 'guard-owned-output', exit)])
        const cli = harness(runner, setup.environment)
        expect(await cli.run(['host', operation, '--host', 'agent-host', ...args]), label).toBe(exit === 0 ? 0 : 1)
        expect(runner.calls).toHaveLength(1)
        expect(runner.calls[0]).toMatchObject({
          command: 'bash',
          args: [join(setup.harness, 'operations/aws/agent-host/destroy.sh'), operation, ...args],
          mode: 'interactive',
          cwd: setup.harness,
          env: { AWS_PROFILE: 'knowledge-islands-techne', AWS_REGION: 'eu-west-1', EXPECTED_AWS_ACCOUNT: ACCOUNT }
        })
        expect(runner.calls[0]?.env).not.toHaveProperty('CONFIRM_DESTROY_AGENT_HOST')
        expect(cli.output().stdout.includes('completed guarded')).toBe(exit === 0)
        expect(cli.output().stderr).not.toContain('guard-owned-output')
      }
    }
    const rejected = harness(new ThrowingRunner(new Error('raw-secret')), setup.environment)
    expect(await rejected.run(['host', 'rebuild', '--host', 'agent-host'])).toBe(1)
    expect(rejected.output().stderr).toBe('techne: error: harness rebuild could not run\n')
  })

  test('validates operation metadata and retains unresolved recipe footprint text', async () => {
    const recipeCli = harness(new FakeRunner([]), fixture().environment)
    expect(await recipeCli.run(['recipe', 'show', 'agent-host', '--json'])).toBe(0)
    expect(JSON.parse(recipeCli.output().stdout).operations).toMatchObject({
      rebuild: { script: 'destroy' },
      withdraw: { script: 'destroy' }
    })
    const invalid = [
      AGENT_HOST.replace(
        '[operations.rebuild]\nsummary = "Replace the host, keeping credentials for the next build"\nscript = "destroy"',
        '[operations]\nrebuild = "invalid"'
      ),
      AGENT_HOST.replace('summary = "Replace the host, keeping credentials for the next build"', 'summary = 1'),
      AGENT_HOST.replace('script = "destroy"', 'script = 1'),
      AGENT_HOST.replace('script = "destroy"', '')
    ]
    for (const recipe of invalid) {
      const runner = new FakeRunner([])
      const cli = harness(runner, fixture({ recipes: { 'agent-host': recipe } }).environment)
      expect(await cli.run(['host', 'rebuild', '--host', 'agent-host'])).toBe(1)
      expect(runner.calls).toHaveLength(0)
    }
    const setup = fixture({
      recipes: { 'agent-host': AGENT_HOST.replace('tailnet device {tailscale_name}', 'unresolved {missing}') }
    })
    const runner = new FakeRunner([])
    const cli = harness(runner, setup.environment)
    expect(await cli.run(['host', 'rebuild', '--host', 'agent-host', '--dry-run'])).toBe(0)
    expect(cli.output().stdout).toContain('unresolved {missing}')
    expect(runner.calls).toHaveLength(0)
  })

  test('refuses invalid grammar and missing removal declarations before any call', async () => {
    const setup = fixture()
    for (const args of [
      ['host', 'rebuild', '--discard'],
      ['host', 'rebuild', '--discard', ''],
      ['host', 'withdraw', '--discard', '  '],
      ['host', 'rebuild', '--discard', 'a', 'a'],
      ['host', 'rebuild', '--discard', 'a', '--discard', 'b'],
      ['host', 'withdraw', '--discard', 'a', '--discard-unreadable-host'],
      ['host', 'status', '--discard', 'a'],
      ['host', 'status', '--discard-unreadable-host'],
      ['host', 'start', '--now'],
      ['host', 'withdraw', '--now'],
      ['host', 'stop', '--discard', 'a'],
      ['host', 'rebuild', 'extra']
    ]) {
      const runner = new FakeRunner([])
      expect(await harness(runner, setup.environment).run([...args, '--host', 'agent-host'])).toBe(2)
      expect(runner.calls).toHaveLength(0)
    }
    for (const recipe of [
      AGENT_HOST.replace(/\[operations.rebuild\][\s\S]*?(?=\[operations.withdraw)/, ''),
      AGENT_HOST.replace('destroy = "operations/aws/agent-host/destroy.sh"', '')
    ]) {
      const runner = new FakeRunner([])
      expect(
        await harness(runner, fixture({ recipes: { 'agent-host': recipe } }).environment).run([
          'host',
          'rebuild',
          '--host',
          'agent-host'
        ])
      ).toBe(1)
      expect(runner.calls).toHaveLength(0)
    }
  })
})

describe('recipes and new bindings', () => {
  test('lists recipes from the harness checkout, marking the selected host recipe', async () => {
    const setup = fixture()
    const runner = new FakeRunner([])
    const cli = harness(runner, setup.environment)
    expect(await cli.run(['recipe', 'list'])).toBe(0)
    expect(cli.output().stdout).toBe(
      '* agent-host (aws): Agents run directly on one host reached only over Tailscale SSH\n' +
        '  multi (aws, stub): Test recipe for two providers\n'
    )
    const json = harness(runner, setup.environment)
    expect(await json.run(['recipe', 'list', '--json'])).toBe(0)
    expect(JSON.parse(json.output().stdout)).toEqual({
      schema: 'techne/recipe-list/v1',
      recipes: [
        {
          name: 'agent-host',
          summary: 'Agents run directly on one host reached only over Tailscale SSH',
          runtime: 'direct',
          providers: ['aws'],
          selected: true
        },
        {
          name: 'multi',
          summary: 'Test recipe for two providers',
          runtime: 'direct',
          providers: ['aws', 'stub'],
          selected: false
        }
      ]
    })
    const unselected = harness(runner, fixture({ bindings: { a: binding('a'), b: binding('b') } }).environment)
    expect(await unselected.run(['recipe', 'list'])).toBe(0)
    expect(unselected.output().stdout).toMatch(/^ {2}agent-host/)
    const unbound = harness(runner, fixture({ bindings: {} }).environment)
    expect(await unbound.run(['recipe', 'list'])).toBe(0)
    expect(unbound.output().stdout).toMatch(/^ {2}agent-host/)
    const empty = harness(runner, fixture({ recipes: {}, bindings: {} }).environment)
    expect(await empty.run(['recipe', 'list'])).toBe(0)
    expect(empty.output().stdout).toBe('no recipes in the harness checkout\n')
    expect(runner.calls).toHaveLength(0)
  })

  test("shows a named recipe, or the selected host's recipe", async () => {
    const setup = fixture()
    const named = harness(new FakeRunner([]), setup.environment)
    expect(await named.run(['recipe', 'show', 'multi'])).toBe(0)
    expect(named.output().stdout).toBe(
      'recipe: multi\nsummary: Test recipe for two providers\nruntime: direct\nproviders: aws, stub\n' +
        'parameters: tailscale_name, workspace\naws parameters: none\nstub parameters: zone\n'
    )
    const selected = harness(new FakeRunner([]), setup.environment)
    expect(await selected.run(['recipe', 'show', '--json'])).toBe(0)
    const recipe = JSON.parse(selected.output().stdout)
    expect(recipe).toMatchObject({ schema: 'techne/recipe/v1', name: 'agent-host', providers: ['aws'] })
    expect(recipe.provider.aws.selectors.tag_key).toBe('ki-agent-host-id')
    expect(recipe.parameters.host_name).toEqual({
      summary: 'Operating-system host name and resource name',
      required: false,
      default: 'ki-techne-{name}',
      env: 'AGENT_HOST_NAME',
      scripts: ['setup', 'provision', 'stop']
    })
    const bare = fixture({
      recipes: { x: 'schema = "techne/recipe/v1"\nname = "x"\nsummary = "s"\nruntime = "r"\n[providers.aws]\n' },
      bindings: {}
    })
    const none = harness(new FakeRunner([]), bare.environment)
    expect(await none.run(['recipe', 'show', 'x'])).toBe(0)
    expect(none.output().stdout).toContain('parameters: none\naws parameters: none\n')

    const unknown = harness(new FakeRunner([]), setup.environment)
    expect(await unknown.run(['recipe', 'show', 'ghost'])).toBe(1)
    expect(unknown.output().stderr).toBe('techne: error: unknown recipe ghost; available: agent-host, multi\n')
    const nothing = harness(new FakeRunner([]), fixture({ recipes: {}, bindings: {} }).environment)
    expect(await nothing.run(['recipe', 'show', 'ghost'])).toBe(1)
    expect(nothing.output().stderr).toBe('techne: error: unknown recipe ghost; available: none\n')
    const extra = harness(new FakeRunner([]), setup.environment)
    expect(await extra.run(['recipe', 'show', 'a', 'b'])).toBe(2)
    expect(extra.output().stderr).toContain('recipe show accepts at most one recipe')
  })

  test('writes a new binding with one provider table and never overwrites', async () => {
    const setup = fixture({ bindings: {}, config: null })
    const cli = harness(new FakeRunner([]), setup.environment)
    expect(await cli.run(['host', 'add', 'lab', '--recipe', 'agent-host'])).toBe(0)
    const file = join(setup.configuration, 'hosts/lab.toml')
    expect(cli.output().stdout).toBe(`wrote ${file}\nset its provider values before use; nothing was provisioned\n`)
    expect(readFileSync(file, 'utf8')).toBe(
      'schema = "techne/host-binding/v1"\nname = "lab"\nrecipe = "agent-host"\n\n[aws]\n'
    )
    const again = harness(new FakeRunner([]), setup.environment)
    expect(await again.run(['host', 'add', 'lab', '--recipe', 'agent-host'])).toBe(1)
    expect(again.output().stderr).toBe(`techne: error: refusing to overwrite the existing binding ${file}\n`)

    const stub = harness(
      new FakeRunner([]),
      setup.environment,
      LOCAL_RUNTIME,
      true,
      [],
      [...PROVIDERS, stubProvider([])]
    )
    expect(await stub.run(['host', 'add', 'zoned', '--recipe', 'multi', '--provider', 'stub'])).toBe(0)
    expect(readFileSync(join(setup.configuration, 'hosts/zoned.toml'), 'utf8')).toContain('\n[stub]\n')

    const cases: [string[], string][] = [
      [
        ['host', 'add', 'x', '--recipe', 'multi'],
        'recipe multi supports several providers; choose one with --provider <aws|stub>'
      ],
      [['host', 'add', 'x', '--recipe', 'agent-host', '--provider', 'stub'], 'unknown provider stub'],
      [['host', 'add', 'Bad_Name', '--recipe', 'agent-host'], 'invalid binding name Bad_Name'],
      [['host', 'add', 'x'], 'host add requires --recipe <recipe>'],
      [['host', 'add', '--recipe', 'agent-host'], 'host add requires exactly one name'],
      [['host', 'add', 'x', 'y', '--recipe', 'agent-host'], 'host add requires exactly one name']
    ]
    for (const [args, message] of cases) {
      const refused = harness(new FakeRunner([]), setup.environment)
      expect(await refused.run(args), args.join(' ')).toBe(2)
      expect(refused.output().stderr).toContain(message)
    }
    const unsupported = harness(
      new FakeRunner([]),
      setup.environment,
      LOCAL_RUNTIME,
      true,
      [],
      [...PROVIDERS, stubProvider([])]
    )
    expect(await unsupported.run(['host', 'add', 'x', '--recipe', 'agent-host', '--provider', 'stub'])).toBe(2)
    expect(unsupported.output().stderr).toContain('recipe agent-host does not support provider stub; it supports aws')
    expect(existsSync(join(setup.configuration, 'hosts/x.toml'))).toBe(false)
  })
})

describe('provider contract', () => {
  const zoned = binding('zoned', '[stub]\n', 'multi').replace('recipe =', 'workspace = "w"\nrecipe =')

  test('dispatches host commands and guarded script resolution through the binding provider', async () => {
    const log: string[] = []
    const setup = fixture({ bindings: { zoned } })
    const providers = [...PROVIDERS, stubProvider(log, 'stopped')]
    const runner = new FakeRunner([])
    const status = harness(runner, setup.environment, LOCAL_RUNTIME, true, [], providers)
    expect(await status.run(['host', 'status', '--stub-zone', 'z9', '--json'])).toBe(4)
    expect(status.output().stdout).toContain('"zone":"z9"')
    const start = harness(runner, setup.environment, LOCAL_RUNTIME, true, [], providers)
    expect(await start.run(['host', 'start', '--host', 'zoned'])).toBe(0)
    expect(log).toContain('start stub-1')
    const missing = harness(runner, setup.environment, LOCAL_RUNTIME, true, [], providers)
    expect(await missing.run(['host', 'stop', '--host', 'zoned'])).toBe(1)
    expect(missing.output().stderr).toContain('declares no stop script')
    expect(runner.calls).toHaveLength(0)
    const refused = harness(
      runner,
      setup.environment,
      LOCAL_RUNTIME,
      true,
      [],
      [...PROVIDERS, stubProvider([], 'refused')]
    )
    expect(await refused.run(['host', 'status', '--all'])).toBe(1)
    expect(refused.output().stdout).toContain('host: zoned\nerror: stub refused\n')
  })

  test('dispatches every controller command to the configured controller provider', async () => {
    const log: string[] = []
    const setup = fixture({ config: '[controller.stub]\nendpoint = "https://controller"\n' })
    const providers = [...PROVIDERS, stubProvider(log)]
    const runner = new FakeRunner([response('', '', 127), response('', '', 127)])
    const outputs: string[] = []
    for (const args of [
      ['controller', 'status', '--json'],
      ['controller', 'bootstrap'],
      ['auth', 'login'],
      ['doctor'],
      ['diag', '--full', '--stub-endpoint', 'https://flag']
    ]) {
      const cli = harness(runner, setup.environment, LOCAL_RUNTIME, true, [], providers)
      expect(await cli.run(args), args.join(' ')).toBe(0)
      outputs.push(cli.output().stdout)
    }
    expect(JSON.parse(outputs[0] as string)).toEqual({
      exists: true,
      stackName: 'https://controller',
      stackStatus: null,
      instanceId: null
    })
    expect(outputs[1]).toBe('stub bootstrap\n')
    expect(outputs[2]).toBe('ok auth stub: stub session\n')
    expect(outputs[3]).toContain('ok controller: stub target configured\nok stub: stub reachable\n')
    expect(outputs[4]).toContain('controller provider: stub\ncontroller endpoint: https://flag\n')
    expect(log).toEqual(['bootstrap'])
    expect(runner.calls).toEqual([])
  })
})
