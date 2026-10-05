import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'
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
  bunVersion: '1.4.1',
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

function harness(
  runner: CommandRunner,
  environment: Record<string, string | undefined> = {},
  runtime: TechneRuntime = LOCAL_RUNTIME,
  interactive = true
) {
  let stdout = ''
  let stderr = ''
  const io: CliIo = {
    stdout: (value) => {
      stdout += value
    },
    stderr: (value) => {
      stderr += value
    }
  }
  return {
    run: (argv: readonly string[]) => runCli(argv, { runner, environment, runtime, io, interactive }),
    output: () => ({ stdout, stderr })
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
  })

  test('reports its version without running a subprocess', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner)

    expect(await cli.run(['--version'])).toBe(0)
    expect(cli.output().stdout).toBe(`${TECHNE_VERSION}\n`)
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
          `source "$1"; complete -p techne; COMP_WORDS=(techne --region local auth lo); COMP_CWORD=4; _techne; [[ "${dollar}{COMPREPLY[*]}" == login ]]; COMP_WORDS=(techne help controller bo); COMP_CWORD=3; _techne; [[ "${dollar}{COMPREPLY[*]}" == bootstrap ]]`,
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
      'Runtime: Bun 1.4.1',
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
    expect(cli.output().stderr).toContain('unknown command')
    expect(await cli.run(['controller', 'explode', '--help'])).toBe(2)
    expect(await cli.run(['controller', 'explode', '--version'])).toBe(2)
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
    expect(report.checks).toContainEqual({ name: 'runtime', ok: true, detail: 'embedded Bun 1.4.1' })
    expect(runner.calls.map((call) => call.command)).toEqual(['aws', 'session-manager-plugin', 'aws'])
  })

  test('reports a mismatched local Bun runtime', async () => {
    const runner = new FakeRunner([response('', '', 127), response('', '', 127)])
    const cli = harness(runner, {}, { ...LOCAL_RUNTIME, bunVersion: '1.4.2' })

    expect(await cli.run(['doctor', '--json'])).toBe(1)
    expect(JSON.parse(cli.output().stdout).checks).toContainEqual({
      name: 'bun',
      ok: false,
      detail: 'running Bun 1.4.2; expected 1.4.1'
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
