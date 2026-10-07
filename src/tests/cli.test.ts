import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'
import packageMetadata from '../../package.json' with { type: 'json' }
import { type CliIo, runCli } from '../cli.ts'
import type { CommandCall, CommandResult, CommandRunner, RunOptions } from '../process.ts'
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
    this.calls.push({ command, args: [...args], mode: options.mode ?? 'capture' })
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

function stack(instanceId: string | null = INSTANCE): CommandResult {
  const Outputs = instanceId === null ? [] : [{ OutputKey: 'ControllerInstanceId', OutputValue: instanceId }]
  return response(JSON.stringify({ Stacks: [{ StackStatus: 'CREATE_COMPLETE', Outputs }] }))
}

function operator(role = 'ki-techne-agent-host-operator', account = ACCOUNT): CommandResult {
  return response(JSON.stringify({ Account: account, Arn: `arn:aws:sts::${account}:assumed-role/${role}/kris` }))
}

function hosts(...rows: [string, string][]): CommandResult {
  return response(JSON.stringify(rows))
}

const WORKSPACE_REPORT = 'Repositories under /home/techne/workspaces/kit\nsummary: REPOSITORIES=21 AT_RISK=0\n'

function harnessCheckout(...scripts: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'techne-harness-'))
  mkdirSync(join(directory, 'operations/aws/agent-host'), { recursive: true })
  for (const script of scripts) {
    writeFileSync(join(directory, 'operations/aws/agent-host', script), '#!/usr/bin/env bash\n')
  }
  return directory
}

function ec2Operations(runner: FakeRunner): string[] {
  return runner.calls.filter((call) => call.args[0] === 'ec2').map((call) => call.args[1] as string)
}

function harness(
  runner: CommandRunner,
  environment: Record<string, string | undefined> = {},
  runtime: TechneRuntime = LOCAL_RUNTIME,
  interactive = true,
  answers: (string | null)[] = []
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
    run: (argv: readonly string[]) => runCli(argv, { runner, environment, runtime, io, interactive }),
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
      const cli = harness(
        new FakeRunner([]),
        {},
        { ...LOCAL_RUNTIME, platform: platform as string, architecture: architecture as string }
      )
      expect(await cli.run(['diag', '--json'])).toBe(0)
      expect(JSON.parse(cli.output().stdout)).toMatchObject({
        platform: expected,
        architecture: 'x86_64',
        configuration: 'available (defaults and explicit overrides)'
      })
    }
    const cli = harness(new FakeRunner([response('aws-cli/2'), response('1.2'), identity()]))
    expect(await cli.run(['doctor', '--json'])).toBe(0)
    const report = JSON.parse(cli.output().stdout)
    expect(report).toMatchObject({
      tool: 'techne',
      installation: 'local',
      platform: 'macos',
      architecture: 'arm64',
      verdict: 'healthy',
      counts: { pass: 5, warn: 0, fail: 0, skipped: 0 }
    })
    expect(Object.values(report.counts).reduce((sum: number, value) => sum + Number(value), 0)).toBe(
      report.checks.length
    )
    expect(cli.output().stdout).not.toContain(ACCOUNT)
    expect(cli.output().stdout).not.toContain('/checkout')
  })

  test('reports unknown provenance honestly and unavailable identity as skipped', async () => {
    const cli = harness(
      new FakeRunner([response('aws-cli/2'), response('1.2'), identity()]),
      {},
      { ...LOCAL_RUNTIME, installation: 'unknown' }
    )
    expect(await cli.run(['doctor', '--json'])).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toMatchObject({
      installation: 'unknown',
      verdict: 'healthy',
      counts: { pass: 4, warn: 1, fail: 0, skipped: 0 }
    })
    const missing = harness(
      new FakeRunner([response('', '', 127), response('', '', 127)]),
      {},
      { ...LOCAL_RUNTIME, installation: 'release', bunVersion: 'unavailable' }
    )
    expect(await missing.run(['doctor', '--json'])).toBe(1)
    expect(JSON.parse(missing.output().stdout)).toMatchObject({
      verdict: 'unhealthy',
      counts: { pass: 1, warn: 0, fail: 3, skipped: 1 }
    })
  })
  test('shows help without running a subprocess', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner)

    expect(await cli.run(['--help'])).toBe(0)
    expect(cli.output().stdout).toContain('auth login')
    expect(cli.output().stdout).toContain('controller bootstrap')
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
      ['host'],
      ['host', 'status'],
      ['host', 'setup'],
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
    expect(connect.output().stdout).toContain('host connect [--dry-run] [path]')
    const completion = harness(new FakeRunner([]))
    expect(await completion.run(['completion', 'zsh', '--help'])).toBe(0)
    expect(completion.output().stdout).toContain('Usage: techne completion <bash|zsh>')
  })

  test('lists group subcommands and rejects a bare group with its usage', async () => {
    for (const [group, commands, message] of [
      ['auth', ['login'], 'login'],
      ['controller', ['status', 'bootstrap'], 'status or bootstrap'],
      [
        'host',
        ['status', 'setup', 'start', 'stop', 'teardown', 'connect'],
        'status, setup, start, stop, teardown or connect'
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
      expect(runner.calls).toHaveLength(0)
    }
  })

  test('Bash completion registers and resolves command context', async () => {
    const dollar = '$'
    const cli = harness(new FakeRunner([]))
    expect(await cli.run(['completion', 'bash'])).toBe(0)
    const directory = mkdtempSync(join(tmpdir(), 'techne-bash-'))
    try {
      const definition = join(directory, 'techne.bash')
      writeFileSync(definition, cli.output().stdout)
      const result = spawnSync(
        'bash',
        [
          '-c',
          `source "$1"; complete -p techne; COMP_WORDS=(techne --region local auth lo); COMP_CWORD=4; _techne; [[ "${dollar}{COMPREPLY[*]}" == login ]]; COMP_WORDS=(techne help controller bo); COMP_CWORD=3; _techne; [[ "${dollar}{COMPREPLY[*]}" == bootstrap ]]; COMP_WORDS=(techne --host-profile p host te); COMP_CWORD=4; _techne; [[ "${dollar}{COMPREPLY[*]}" == teardown ]]; COMP_WORDS=(techne host stop --dr); COMP_CWORD=3; _techne; [[ "${dollar}{COMPREPLY[*]}" == --dry-run ]]; COMP_WORDS=(techne --harness-dir d host setup --pu); COMP_CWORD=5; _techne; [[ "${dollar}{COMPREPLY[*]}" == --pull ]]`,
          '_',
          definition
        ],
        { encoding: 'utf8' }
      )
      expect(result.status, result.stderr).toBe(0)
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
    const cli = harness(runner, { AWS_PROFILE: 'local-profile', TELEGRAM_BOT_TOKEN: 'must-not-leak' })

    expect(await cli.run(['diag', '--json'])).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toMatchObject({
      schema: 'techne/diag/v1',
      version: TECHNE_VERSION,
      installation: 'local'
    })
    expect(cli.output().stdout).not.toContain('/checkout')
    expect(cli.output().stdout).not.toContain('local-profile')
    expect(cli.output().stdout).not.toContain('must-not-leak')
    expect(runner.calls).toHaveLength(0)
  })

  test('renders human-readable diagnostics', async () => {
    const cli = harness(new FakeRunner([]))

    expect(await cli.run(['diag'])).toBe(0)
    expect(cli.output().stdout).toContain(`Version: ${TECHNE_VERSION}`)
    for (const field of [
      'Tool: techne',
      'Platform: macos',
      'Architecture: arm64',
      'Runtime: Bun 1.4.2',
      'Configuration: available'
    ])
      expect(cli.output().stdout).toContain(field)
    expect(cli.output().stdout).toContain('identifiers omitted')
    expect(cli.output().stdout).not.toContain(ACCOUNT)
  })

  test('includes private diagnostic details only on explicit request', async () => {
    const cli = harness(new FakeRunner([]), { AWS_PROFILE: 'local-profile' })
    expect(await cli.run(['diag', '--full', '--json'])).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toMatchObject({
      details: { executable: '/checkout/src/main.ts', profile: 'local-profile' }
    })

    const human = harness(new FakeRunner([]), { AWS_PROFILE: 'local-profile' })
    expect(await human.run(['diag', '--full'])).toBe(0)
    expect(human.output().stdout).toContain('AWS profile: local-profile')

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

  test('logs in every configured authentication surface', async () => {
    const runner = new FakeRunner([response('', 'aws-cli/2.36.49'), identity()])
    const cli = harness(runner)

    expect(await cli.run(['auth', 'login'])).toBe(0)
    expect(cli.output().stdout).toBe(`ok auth aws: account ${ACCOUNT}\n`)
    expect(runner.calls.map((call) => call.command)).toEqual(['aws', 'aws'])
  })

  test('reports a configured authentication surface failure', async () => {
    const cli = harness(new FakeRunner([response('', '', 127)]))

    expect(await cli.run(['auth', 'login'])).toBe(1)
    expect(cli.output().stdout).toBe('fail auth aws: AWS CLI is unavailable\n')
  })

  test('rejects JSON authentication without running subprocesses', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner)

    expect(await cli.run(['auth', 'login', '--json'])).toBe(2)
    expect(cli.output().stderr).toContain('--json is not supported for interactive authentication')
    expect(runner.calls).toHaveLength(0)
  })

  test('rejects authentication outside an interactive terminal', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner, {}, LOCAL_RUNTIME, false)

    expect(await cli.run(['auth', 'login'])).toBe(2)
    expect(cli.output().stderr).toContain('auth login requires an interactive terminal')
    expect(runner.calls).toHaveLength(0)
  })

  test('guides expired doctor sessions to explicit authentication', async () => {
    const runner = new FakeRunner([
      response('', 'aws-cli/2.36.49'),
      response('1.2.835.0\n'),
      response('', 'The SSO session associated with this profile has expired.', 1)
    ])
    const cli = harness(runner)

    expect(await cli.run(['doctor'])).toBe(1)
    expect(cli.output().stdout).toContain('run techne auth login')
    expect(runner.calls).toHaveLength(3)
  })

  test('reports local tools and expected AWS identity', async () => {
    const runner = new FakeRunner([response('', 'aws-cli/2.36.49'), response('1.2.835.0\n'), identity()])
    const cli = harness(runner)

    expect(await cli.run(['doctor', '--json'])).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toMatchObject({ ok: true })
    expect(runner.calls.map((call) => call.command)).toEqual(['aws', 'session-manager-plugin', 'aws'])
  })

  test('renders unavailable local tools in human output', async () => {
    const runner = new FakeRunner([response('', '', 127), response('', '', 127)])
    const cli = harness(runner)

    expect(await cli.run(['doctor'])).toBe(1)
    expect(cli.output().stdout).toContain('fail aws: AWS CLI is unavailable')
    expect(cli.output().stdout).toContain('fail session-manager-plugin')
  })

  test('reports an AWS identity failure from doctor', async () => {
    const runner = new FakeRunner([
      response('aws-cli/2.36.49\nsecond line'),
      response('', '1.2.835.0\n'),
      response('', 'denied', 1)
    ])
    const cli = harness(runner)

    expect(await cli.run(['doctor', '--json'])).toBe(1)
    expect(JSON.parse(cli.output().stdout).checks).toContainEqual({
      name: 'aws-account',
      ok: false,
      detail: 'AWS identity check failed; run techne auth login and verify the expected account with techne diag --full'
    })
  })

  test('uses the embedded runtime for a release installation', async () => {
    const runner = new FakeRunner([response('', 'aws-cli/2.36.49'), response('1.2.835.0\n'), identity()])
    const cli = harness(runner, {}, { ...LOCAL_RUNTIME, installation: 'release', executable: '/bin/techne' })

    expect(await cli.run(['doctor', '--json'])).toBe(0)
    const report = JSON.parse(cli.output().stdout)
    expect(report.checks).toContainEqual({ name: 'runtime', ok: true, detail: 'embedded Bun 1.4.2' })
    expect(runner.calls.map((call) => call.command)).toEqual(['aws', 'session-manager-plugin', 'aws'])
  })

  test('reports a mismatched local Bun runtime', async () => {
    const runner = new FakeRunner([response('', '', 127), response('', '', 127)])
    const cli = harness(runner, {}, { ...LOCAL_RUNTIME, bunVersion: '1.4.1' })

    expect(await cli.run(['doctor', '--json'])).toBe(1)
    expect(JSON.parse(cli.output().stdout).checks).toContainEqual({
      name: 'bun',
      ok: false,
      detail: 'running Bun 1.4.1; expected 1.4.2'
    })
  })

  test('reports a controller stack using flag precedence', async () => {
    const runner = new FakeRunner([identity('222222222222'), stack()])
    const cli = harness(runner, {
      AWS_PROFILE: 'environment-profile',
      AWS_REGION: 'environment-region',
      EXPECTED_AWS_ACCOUNT: ACCOUNT
    })

    expect(
      await cli.run([
        'controller',
        'status',
        '--profile',
        'flag-profile',
        '--region',
        'flag-region',
        '--account',
        '222222222222',
        '--json'
      ])
    ).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toMatchObject({
      exists: true,
      stackStatus: 'CREATE_COMPLETE',
      instanceId: INSTANCE
    })
    expect(runner.calls[0]?.args).toContain('flag-profile')
    expect(runner.calls[1]?.args).toContain('flag-region')
  })

  test('reports an absent controller stack without masking identity checks', async () => {
    const runner = new FakeRunner([
      identity(),
      response('', 'Stack with id ki-techne-ops-007-controller does not exist', 255)
    ])
    const cli = harness(runner)

    expect(await cli.run(['controller', 'status'])).toBe(0)
    expect(cli.output().stdout).toContain('state: absent')
  })

  test('renders a controller instance in human output', async () => {
    const cli = harness(new FakeRunner([identity(), stack()]))

    expect(await cli.run(['controller', 'status'])).toBe(0)
    expect(cli.output().stdout).toContain(`instance: ${INSTANCE}`)
  })

  test('renders an unknown controller status without an instance', async () => {
    const runner = new FakeRunner([identity(), response(JSON.stringify({ Stacks: [{ Outputs: [] }] }))])
    const cli = harness(runner)

    expect(await cli.run(['controller', 'status'])).toBe(0)
    expect(cli.output().stdout).toContain('state: unknown')
    expect(cli.output().stdout).not.toContain('instance:')
  })

  test('refuses an unexpected AWS account before inspecting the stack', async () => {
    const runner = new FakeRunner([identity('999999999999')])
    const cli = harness(runner)

    expect(await cli.run(['controller', 'status'])).toBe(1)
    expect(cli.output().stderr).toContain('refusing AWS account')
    expect(runner.calls).toHaveLength(1)
  })

  test('opens bootstrap through an interactive SSM session', async () => {
    const runner = new FakeRunner([response('1.2.835.0\n'), identity(), stack(), response()])
    const cli = harness(runner, { TELEGRAM_BOT_TOKEN: 'must-not-leak' })

    expect(await cli.run(['controller', 'bootstrap'])).toBe(0)
    const session = runner.calls.at(-1)
    expect(session).toMatchObject({ command: 'aws', mode: 'interactive' })
    expect(session?.args.join(' ')).toContain('AWS-StartInteractiveCommand')
    expect(session?.args.join(' ')).toContain('/opt/ki-techne-harness/deploy/runtime/controller/bootstrap.sh')
    expect(session?.args.join(' ')).not.toContain('must-not-leak')
    expect(cli.output().stdout).toContain('private interactive bootstrap session')
  })

  test('requires the Session Manager plugin before bootstrap', async () => {
    const cli = harness(new FakeRunner([response('', '', 127)]))

    expect(await cli.run(['controller', 'bootstrap'])).toBe(1)
    expect(cli.output().stderr).toContain('Session Manager plugin is unavailable')
  })

  test('requires an existing controller before bootstrap', async () => {
    const runner = new FakeRunner([
      response('1.2.835.0'),
      identity(),
      response('', 'Stack with id controller does not exist', 255)
    ])
    const cli = harness(runner)

    expect(await cli.run(['controller', 'bootstrap'])).toBe(1)
    expect(cli.output().stderr).toContain('controller stack does not exist')
  })

  test('requires a valid controller instance before bootstrap', async () => {
    const missing = harness(new FakeRunner([response('1.2.835.0'), identity(), stack(null)]))
    expect(await missing.run(['controller', 'bootstrap'])).toBe(1)
    expect(missing.output().stderr).toContain('controller instance output is missing')

    const invalid = harness(
      new FakeRunner([
        response('1.2.835.0'),
        identity(),
        response(
          JSON.stringify({
            Stacks: [
              {
                StackStatus: 'CREATE_COMPLETE',
                Outputs: [{ OutputKey: 'ControllerInstanceId', OutputValue: 'invalid' }]
              }
            ]
          })
        )
      ])
    )
    expect(await invalid.run(['controller', 'bootstrap'])).toBe(1)
  })

  test('reports a failed interactive bootstrap session', async () => {
    const runner = new FakeRunner([response('1.2.835.0'), identity(), stack(), response('', '', 1)])
    const cli = harness(runner)

    expect(await cli.run(['controller', 'bootstrap'])).toBe(1)
    expect(cli.output().stderr).toContain('interactive controller bootstrap session failed')
  })

  test('rejects JSON output for interactive bootstrap', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner)

    expect(await cli.run(['controller', 'bootstrap', '--json'])).toBe(2)
    expect(runner.calls).toHaveLength(0)
  })

  test('reports the one tagged agent host under the operator role', async () => {
    const checkout = harnessCheckout('status.sh')
    const runner = new FakeRunner([operator(), hosts([INSTANCE, 'running']), response(WORKSPACE_REPORT)])
    const cli = harness(runner, { TECHNE_HARNESS_DIR: checkout })

    expect(await cli.run(['host', 'status', '--json'])).toBe(0)
    expect(JSON.parse(cli.output().stdout)).toEqual({
      schema: 'techne/host-status/v1',
      exists: true,
      instanceId: INSTANCE,
      state: 'running',
      region: 'eu-west-1',
      selector: 'ki-agent-host-id=agent-host',
      workspace: { state: 'reported', report: WORKSPACE_REPORT, detail: null }
    })
    expect(runner.calls[2]).toEqual({
      command: 'bash',
      args: [join(checkout, 'operations/aws/agent-host/status.sh')],
      mode: 'capture'
    })
    rmSync(checkout, { recursive: true, force: true })
    expect(cli.output().stdout).not.toContain(ACCOUNT)
    expect(runner.calls[0]?.args).toEqual([
      'sts',
      'get-caller-identity',
      '--profile',
      'knowledge-islands-techne-agent-host',
      '--output',
      'json'
    ])
    expect(runner.calls[1]?.args).toEqual([
      'ec2',
      'describe-instances',
      '--filters',
      'Name=tag:ki-agent-host-id,Values=agent-host',
      'Name=instance-state-name,Values=pending,running,stopping,stopped',
      '--query',
      'Reservations[].Instances[].[InstanceId,State.Name]',
      '--output',
      'json',
      '--profile',
      'knowledge-islands-techne-agent-host',
      '--region',
      'eu-west-1'
    ])
  })

  test('renders an absent agent host in human output', async () => {
    const cli = harness(new FakeRunner([operator(), hosts()]))

    expect(await cli.run(['host', 'status'])).toBe(0)
    expect(cli.output().stdout).toBe(
      'agent host: absent\nstate: absent\nselector: ki-agent-host-id=agent-host\nregion: eu-west-1\n' +
        'workspace: skipped (agent host is absent)\n'
    )
  })

  test('renders the harness workspace report unchanged for a running host', async () => {
    const checkout = harnessCheckout('status.sh')
    const runner = new FakeRunner([operator(), hosts([INSTANCE, 'running']), response('summary: REPOSITORIES=0')])
    const cli = harness(runner, { HOME: '/nowhere' })

    expect(await cli.run(['host', 'status', '--harness-dir', checkout])).toBe(0)
    expect(cli.output().stdout).toBe(
      `agent host: ${INSTANCE}\nstate: running\nselector: ki-agent-host-id=agent-host\nregion: eu-west-1\n` +
        'workspace: reported by ki-techne-harness status.sh\nsummary: REPOSITORIES=0\n'
    )

    const ended = harness(new FakeRunner([operator(), hosts([INSTANCE, 'running']), response(WORKSPACE_REPORT)]))
    expect(await ended.run(['host', 'status', '--harness-dir', checkout])).toBe(0)
    expect(ended.output().stdout).toMatch(/status\.sh\nRepositories under .*\nsummary: REPOSITORIES=21 AT_RISK=0\n$/)

    const stopped = new FakeRunner([operator(), hosts([INSTANCE, 'stopped'])])
    const stoppedCli = harness(stopped, { TECHNE_HARNESS_DIR: checkout })
    expect(await stoppedCli.run(['host', 'status', '--json'])).toBe(0)
    expect(JSON.parse(stoppedCli.output().stdout).workspace).toEqual({
      state: 'skipped',
      report: null,
      detail: 'agent host is stopped'
    })
    expect(stopped.calls).toHaveLength(2)
    rmSync(checkout, { recursive: true, force: true })
  })

  test('keeps the instance report and exits 1 when the workspace report fails', async () => {
    const checkout = harnessCheckout('status.sh')
    const failing = new FakeRunner([operator(), hosts([INSTANCE, 'running']), response('', 'ssh: connect failed', 255)])
    const cli = harness(failing, { TECHNE_HARNESS_DIR: checkout })

    expect(await cli.run(['host', 'status'])).toBe(1)
    expect(cli.output().stdout).toContain(`agent host: ${INSTANCE}\n`)
    expect(cli.output().stdout).toContain('workspace: failed\n')
    expect(cli.output().stderr).toBe(
      'techne: error: workspace report failed: harness status.sh failed: ssh: connect failed\n'
    )

    const missing = new FakeRunner([operator(), hosts([INSTANCE, 'running'])])
    const missingCli = harness(missing, { HOME: '/nowhere' })
    expect(await missingCli.run(['host', 'status', '--json'])).toBe(1)
    expect(JSON.parse(missingCli.output().stdout).workspace).toEqual({
      state: 'failed',
      report: null,
      detail:
        'ki-techne-harness checkout not found at /nowhere/workspaces/kit/knowledgeislands/ki-techne-harness; ' +
        'clone it or set --harness-dir or TECHNE_HARNESS_DIR'
    })
    expect(missing.calls).toHaveLength(2)
    rmSync(checkout, { recursive: true, force: true })
  })

  test('runs the harness setup script after checking the checkout and Tailscale', async () => {
    const checkout = harnessCheckout('setup.sh')
    const script = join(checkout, 'operations/aws/agent-host/setup.sh')
    const runner = new FakeRunner([response(), response(), response()])
    const cli = harness(runner, { TECHNE_HARNESS_DIR: checkout })

    expect(await cli.run(['host', 'setup', '--pull'])).toBe(0)
    expect(runner.calls).toEqual([
      { command: 'tailscale', args: ['status'], mode: 'capture' },
      { command: 'tailscale', args: ['ping', '-c', '1', '--timeout=10s', 'ki-techne-agent-host'], mode: 'capture' },
      { command: 'bash', args: [script, '--pull'], mode: 'interactive' }
    ])
    expect(cli.output().stdout).toBe(`running bash ${script} --pull\n`)

    const plain = new FakeRunner([response(), response(), response()])
    expect(await harness(plain, { TECHNE_HARNESS_DIR: checkout }).run(['host', 'setup'])).toBe(0)
    expect(plain.calls[2]?.args).toEqual([script])

    const dry = new FakeRunner([response(), response()])
    const dryCli = harness(dry, { TECHNE_HARNESS_DIR: checkout })
    expect(await dryCli.run(['host', 'setup', '--dry-run', '--pull'])).toBe(0)
    expect(dryCli.output().stdout).toBe(`dry run: would run bash ${script} --pull\n`)
    expect(dry.calls.map((call) => call.command)).toEqual(['tailscale', 'tailscale'])

    const failed = harness(new FakeRunner([response(), response(), response('', '', 3)]), {
      TECHNE_HARNESS_DIR: checkout
    })
    expect(await failed.run(['host', 'setup'])).toBe(1)
    expect(failed.output().stderr).toContain('harness setup failed with exit status 3')

    const unreachable = new FakeRunner([response('', 'stopped', 1)])
    const unreachableCli = harness(unreachable, { TECHNE_HARNESS_DIR: checkout })
    expect(await unreachableCli.run(['host', 'setup'])).toBe(1)
    expect(unreachableCli.output().stderr).toContain('Tailscale is not up')
    expect(unreachable.calls).toHaveLength(1)
    rmSync(checkout, { recursive: true, force: true })
  })

  test('refuses host setup without a usable harness checkout before running anything', async () => {
    const empty = harnessCheckout()
    const cases: [Record<string, string>, string[], string][] = [
      [{}, [], 'no ki-techne-harness checkout is configured; set --harness-dir or TECHNE_HARNESS_DIR'],
      [{ HOME: '/nowhere' }, [], 'ki-techne-harness checkout not found at /nowhere/workspaces/kit/knowledgeislands/'],
      [
        { TECHNE_HARNESS_DIR: '/environment' },
        ['--harness-dir', empty],
        `${empty} has no operations/aws/agent-host/setup.sh; update the ki-techne-harness checkout`
      ]
    ]
    for (const [environment, args, message] of cases) {
      const runner = new FakeRunner([])
      const cli = harness(runner, environment)
      expect(await cli.run(['host', 'setup', ...args])).toBe(1)
      expect(cli.output().stderr).toContain(message)
      expect(runner.calls).toHaveLength(0)
    }
    rmSync(empty, { recursive: true, force: true })
  })

  test('selects the host profile by flag over environment', async () => {
    const runner = new FakeRunner([operator(), hosts()])
    const cli = harness(runner, { TECHNE_HOST_PROFILE: 'environment-host', AWS_PROFILE: 'controller' })

    expect(await cli.run(['host', 'status', '--host-profile', 'flag-host'])).toBe(0)
    expect(runner.calls.every((call) => call.args.includes('flag-host'))).toBe(true)

    const environment = new FakeRunner([operator(), hosts()])
    expect(await harness(environment, { TECHNE_HOST_PROFILE: 'environment-host' }).run(['host', 'status'])).toBe(0)
    expect(environment.calls.every((call) => call.args.includes('environment-host'))).toBe(true)
  })

  test('refuses credentials that are not the operator role before any EC2 call', async () => {
    for (const identityResponse of [
      operator('AWSAdministratorAccess'),
      operator('ki-techne-agent-host-operator-other'),
      operator(undefined, '999999999999')
    ]) {
      const runner = new FakeRunner([identityResponse])
      const cli = harness(runner)

      for (const command of ['status', 'start', 'stop', 'teardown']) {
        expect(await cli.run(['host', command])).toBe(1)
      }
      expect(cli.output().stderr).toMatch(/refusing (credentials|AWS account)/)
      expect(ec2Operations(runner)).toEqual([])
    }
  })

  test('refuses several tagged instances and a missing host', async () => {
    const several = new FakeRunner([operator(), hosts([INSTANCE, 'running'], ['i-0fedcba9876543210', 'stopped'])])
    const cli = harness(several)
    expect(await cli.run(['host', 'stop'])).toBe(1)
    expect(cli.output().stderr).toContain(`more than one instance tagged ki-agent-host-id=agent-host: ${INSTANCE}, i-`)
    expect(ec2Operations(several)).toEqual(['describe-instances'])

    const missing = harness(new FakeRunner([operator(), hosts()]))
    expect(await missing.run(['host', 'start'])).toBe(1)
    expect(missing.output().stderr).toContain('no agent host tagged ki-agent-host-id=agent-host in eu-west-1')
  })

  test('starts only a stopped host and waits until it runs', async () => {
    const runner = new FakeRunner([operator(), hosts([INSTANCE, 'stopped'])])
    const cli = harness(runner)
    expect(await cli.run(['host', 'start'])).toBe(0)
    expect(ec2Operations(runner)).toEqual(['describe-instances', 'start-instances', 'wait'])
    expect(runner.calls.at(-1)?.args.slice(0, 5)).toEqual([
      'ec2',
      'wait',
      'instance-running',
      '--instance-ids',
      INSTANCE
    ])
    expect(cli.output().stdout).toContain(`started ${INSTANCE}`)

    const running = new FakeRunner([operator(), hosts([INSTANCE, 'running'])])
    const noop = harness(running)
    expect(await noop.run(['host', 'start'])).toBe(0)
    expect(noop.output().stdout).toContain('already running; nothing to do')
    expect(ec2Operations(running)).toEqual(['describe-instances'])

    const stopping = harness(new FakeRunner([operator(), hosts([INSTANCE, 'stopping'])]))
    expect(await stopping.run(['host', 'start'])).toBe(1)
    expect(stopping.output().stderr).toContain('agent host is stopping; try again shortly')

    const dry = new FakeRunner([operator(), hosts([INSTANCE, 'stopped'])])
    const dryCli = harness(dry)
    expect(await dryCli.run(['host', 'start', '--dry-run'])).toBe(0)
    expect(dryCli.output().stdout).toContain(`dry run: would start ${INSTANCE}`)
    expect(ec2Operations(dry)).toEqual(['describe-instances'])
  })

  test('stops only a running host', async () => {
    const runner = new FakeRunner([operator(), hosts([INSTANCE, 'running'])])
    const cli = harness(runner)
    expect(await cli.run(['host', 'stop'])).toBe(0)
    expect(ec2Operations(runner)).toEqual(['describe-instances', 'stop-instances'])
    expect(cli.output().stdout).toContain(`stopping ${INSTANCE}`)

    for (const state of ['stopped', 'stopping']) {
      const idle = new FakeRunner([operator(), hosts([INSTANCE, state])])
      const idleCli = harness(idle)
      expect(await idleCli.run(['host', 'stop'])).toBe(0)
      expect(idleCli.output().stdout).toContain(`already ${state}; nothing to do`)
      expect(ec2Operations(idle)).toEqual(['describe-instances'])
    }

    const dry = new FakeRunner([operator(), hosts([INSTANCE, 'pending'])])
    const dryCli = harness(dry)
    expect(await dryCli.run(['host', 'stop', '--dry-run'])).toBe(0)
    expect(dryCli.output().stdout).toContain(`dry run: would stop ${INSTANCE}`)
    expect(ec2Operations(dry)).toEqual(['describe-instances'])
  })

  test('terminates the host only after the exact instance ID is typed', async () => {
    const runner = new FakeRunner([operator(), hosts([INSTANCE, 'stopped'])])
    const cli = harness(runner, {}, LOCAL_RUNTIME, true, [` ${INSTANCE} `])
    expect(await cli.run(['host', 'teardown'])).toBe(0)
    expect(cli.prompts).toEqual(['type the instance ID to confirm: '])
    expect(ec2Operations(runner)).toEqual(['describe-instances', 'terminate-instances'])
    expect(cli.output().stdout).toContain('this cannot be undone')
    expect(cli.output().stdout).toContain('teardown still needs: the security group')

    for (const answer of ['i-0fedcba9876543210', null]) {
      const refused = new FakeRunner([operator(), hosts([INSTANCE, 'running'])])
      const refusedCli = harness(refused, {}, LOCAL_RUNTIME, true, [answer])
      expect(await refusedCli.run(['host', 'teardown'])).toBe(1)
      expect(refusedCli.output().stderr).toContain('confirmation did not match; nothing done')
      expect(ec2Operations(refused)).toEqual(['describe-instances'])
    }
  })

  test('refuses teardown outside an interactive terminal but allows a dry run', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner, {}, LOCAL_RUNTIME, false)
    expect(await cli.run(['host', 'teardown'])).toBe(2)
    expect(cli.output().stderr).toContain('host teardown requires an interactive terminal')
    expect(runner.calls).toHaveLength(0)

    const dry = new FakeRunner([operator(), hosts([INSTANCE, 'running'])])
    const dryCli = harness(dry, {}, LOCAL_RUNTIME, false)
    expect(await dryCli.run(['host', 'teardown', '--dry-run'])).toBe(0)
    expect(dryCli.output().stdout).toContain(`dry run: would terminate ${INSTANCE}`)
    expect(dryCli.prompts).toEqual([])
    expect(ec2Operations(dry)).toEqual(['describe-instances'])
  })

  test('connects through Tailscale and Zed without calling AWS', async () => {
    const runner = new FakeRunner([response(), response(), response()])
    const cli = harness(runner)
    expect(await cli.run(['host', 'connect', '/workspaces/kit'])).toBe(0)
    expect(runner.calls.map((call) => [call.command, ...call.args])).toEqual([
      ['tailscale', 'status'],
      ['tailscale', 'ping', '-c', '1', '--timeout=10s', 'ki-techne-agent-host'],
      ['zed', 'ssh://ki-techne-agent-host/workspaces/kit']
    ])

    const dry = new FakeRunner([response(), response()])
    const dryCli = harness(dry)
    expect(await dryCli.run(['host', 'connect', '--dry-run'])).toBe(0)
    expect(dryCli.output().stdout).toBe('dry run: would open ssh://ki-techne-agent-host/~ in Zed\n')
    expect(dry.calls.map((call) => call.command)).toEqual(['tailscale', 'tailscale'])
  })

  test('refuses to connect when Tailscale or the editor fails', async () => {
    const down = harness(new FakeRunner([response('', 'stopped', 1)]))
    expect(await down.run(['host', 'connect'])).toBe(1)
    expect(down.output().stderr).toContain('Tailscale is not up')

    const silent = new FakeRunner([response(), response('', 'timeout', 1)])
    const silentCli = harness(silent)
    expect(await silentCli.run(['host', 'connect'])).toBe(1)
    expect(silentCli.output().stderr).toContain('ki-techne-agent-host does not answer over Tailscale')
    expect(silent.calls).toHaveLength(2)

    const editor = harness(new FakeRunner([response(), response(), response('', '', 127)]))
    expect(await editor.run(['host', 'connect'])).toBe(1)
    expect(editor.output().stderr).toContain('Zed could not open ssh://ki-techne-agent-host/~')

    const extra = new FakeRunner([])
    const extraCli = harness(extra)
    expect(await extraCli.run(['host', 'connect', 'one', 'two'])).toBe(2)
    expect(extraCli.output().stderr).toContain('host connect accepts at most one path')
    expect(extra.calls).toHaveLength(0)
  })

  test('limits dry runs and JSON to the host commands that support them', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner)
    for (const args of [
      ['host', 'status', '--dry-run'],
      ['controller', 'status', '--dry-run'],
      ['diag', '--dry-run']
    ]) {
      expect(await cli.run(args)).toBe(2)
    }
    expect(cli.output().stderr).toContain(
      '--dry-run is only supported for host setup, start, stop, teardown and connect'
    )
    for (const args of [
      ['host', 'status', '--pull'],
      ['host', 'start', '--pull']
    ]) {
      expect(await cli.run(args)).toBe(2)
    }
    expect(cli.output().stderr).toContain('--pull is only supported for host setup')
    for (const command of ['setup', 'start', 'stop', 'teardown', 'connect']) {
      expect(await cli.run(['host', command, '--json'])).toBe(2)
      expect(cli.output().stderr).toContain(`--json is not supported for host ${command}`)
    }
    expect(runner.calls).toHaveLength(0)
  })

  test('explains every host command', async () => {
    const cli = harness(new FakeRunner([]))
    expect(await cli.run(['--help'])).toBe(0)
    expect(cli.output().stdout).toContain('host connect [--dry-run] [path]')
    expect(cli.output().stdout).toContain('host setup [--pull] [--dry-run]')
    for (const command of ['status', 'setup', 'start', 'stop', 'teardown', 'connect']) {
      expect(await cli.run(['help', 'host', command])).toBe(0)
      expect(cli.output().stdout).toContain(`host ${command}`)
    }
  })

  test('reports unexpected runner failures', async () => {
    const errorCli = harness(new ThrowingRunner(new Error('boom')))
    expect(await errorCli.run(['doctor'])).toBe(1)
    expect(errorCli.output().stderr).toBe('')
    expect(errorCli.output().stdout).toContain('Checks: pass=2 warn=0 fail=2 skipped=1')

    const stringCli = harness(new ThrowingRunner('boom'))
    expect(await stringCli.run(['doctor'])).toBe(1)
    expect(stringCli.output().stderr).toBe('')
    expect(stringCli.output().stdout).toContain('Verdict: unhealthy')
    const otherCommand = harness(new ThrowingRunner(new Error('boom')))
    expect(await otherCommand.run(['controller', 'status'])).toBe(1)
    expect(otherCommand.output().stderr).toContain('Error: boom')
  })
})
