import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { type CliIo, runCli } from '../cli.ts'
import type { CommandCall, CommandResult, CommandRunner, RunOptions } from '../process.ts'
import type { TechneRuntime } from '../runtime.ts'

const ACCOUNT = '655383751458'
const INSTANCE = 'i-0123456789abcdef0'
const LOCAL_RUNTIME: TechneRuntime = {
  version: '0.1.0',
  installation: 'local',
  executable: '/checkout/src/main.ts',
  workingDirectory: '/checkout',
  bunVersion: '1.4.1'
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

  test('reports its version without running a subprocess', async () => {
    const runner = new FakeRunner([])
    const cli = harness(runner)

    expect(await cli.run(['--version'])).toBe(0)
    expect(cli.output().stdout).toBe('0.1.0\n')
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
          `source "$1"; complete -p techne; COMP_WORDS=(techne --region local auth lo); COMP_CWORD=4; _techne; [[ "${dollar}{COMPREPLY[*]}" == login ]]`,
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
      version: '0.1.0',
      installation: 'local',
      executable: '/checkout/src/main.ts',
      configuration: { profile: 'local-profile' }
    })
    expect(cli.output().stdout).not.toContain('must-not-leak')
    expect(runner.calls).toHaveLength(0)
  })

  test('renders human-readable diagnostics', async () => {
    const cli = harness(new FakeRunner([]))

    expect(await cli.run(['diag'])).toBe(0)
    expect(cli.output().stdout).toContain('Techne 0.1.0')
    expect(cli.output().stdout).toContain('controller stack:')
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
      detail: 'TechneError: AWS identity check failed: denied'
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
    expect(errorCli.output().stderr).toContain('Error: boom')

    const stringCli = harness(new ThrowingRunner('boom'))
    expect(await stringCli.run(['doctor'])).toBe(1)
    expect(stringCli.output().stderr).toContain('boom')
  })
})
