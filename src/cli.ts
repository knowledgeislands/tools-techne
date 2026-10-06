import { loginConfiguredAuth } from './auth.ts'
import { AwsClient, type ControllerStatus } from './aws.ts'
import { renderCompletion } from './completion.ts'
import { type Environment, type Invocation, parseInvocation } from './config.ts'
import { TechneError } from './errors.ts'
import type { CommandRunner } from './process.ts'
import type { TechneRuntime } from './runtime.ts'

export interface CliIo {
  stdout(value: string): void
  stderr(value: string): void
}

export interface CliDependencies {
  runner: CommandRunner
  environment: Environment
  runtime: TechneRuntime
  io: CliIo
  interactive: boolean
}

interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
  status?: 'warn' | 'skipped'
}

const HELP = `techne — operate the Techne controller and execution fabric

Usage:
  techne [global options] diag [--full]
  techne [global options] doctor
  techne [global options] auth login
  techne [global options] controller status
  techne [global options] controller bootstrap
  techne completion <bash|zsh>
  techne help [command]

Global options:
  --profile <name>            AWS profile
  --region <region>           AWS region
  --account <id>              expected AWS account
  --controller-stack <name>   controller CloudFormation stack
  --json                      machine-readable output where supported
  --full                      include local paths and identifiers in diag
  -h, --help                  show help
  -V, --version               show version
`

const HELP_TOPICS: Readonly<Record<string, string>> = {
  diag: 'Usage: techne [global options] diag [--full]\nReport share-safe tool, installation, host, runtime, and configuration facts; --full includes paths and identifiers.\n',
  doctor:
    'Usage: techne [global options] doctor\nReport diagnostic context, read-only local prerequisite and AWS identity checks, verdict, and counts; freshness is not checked.\n',
  'auth login': 'Usage: techne [global options] auth login\nOpen an interactive authentication session.\n',
  'controller status': 'Usage: techne [global options] controller status\nInspect the configured controller stack.\n',
  'controller bootstrap':
    'Usage: techne [global options] controller bootstrap\nOpen a private interactive bootstrap session.\n',
  completion: 'Usage: techne completion <bash|zsh>\nPrint shell completion source.\n'
}

function commandName(invocation: Invocation): string {
  return invocation.command.join(' ')
}

function cleanVersion(result: { stdout: string; stderr: string }): string {
  return (result.stdout.trim() || result.stderr.trim()).split('\n', 1)[0] as string
}

function diagnosticContext(dependencies: CliDependencies) {
  return {
    tool: 'techne',
    version: dependencies.runtime.version,
    installation: dependencies.runtime.installation,
    platform:
      ({ darwin: 'macos', win32: 'windows' } as Record<string, string>)[dependencies.runtime.platform] ??
      dependencies.runtime.platform,
    architecture:
      ({ x64: 'x86_64', AMD64: 'x86_64' } as Record<string, string>)[dependencies.runtime.architecture] ??
      dependencies.runtime.architecture,
    runtime: `Bun ${dependencies.runtime.bunVersion}`,
    configuration: 'available (defaults and explicit overrides)'
  }
}

function printContext(dependencies: CliDependencies): void {
  for (const [label, value] of Object.entries(diagnosticContext(dependencies))) {
    dependencies.io.stdout(`${label.charAt(0).toUpperCase()}${label.slice(1)}: ${value}\n`)
  }
}

async function prerequisite(
  dependencies: CliDependencies,
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    return await dependencies.runner.run(command, ['--version'])
  } catch {
    return { stdout: '', stderr: '', exitCode: 1 }
  }
}

async function doctor(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  const checks: DoctorCheck[] = [
    {
      name: 'installation',
      ok: true,
      detail: dependencies.runtime.installation,
      ...(dependencies.runtime.installation === 'unknown' ? { status: 'warn' as const } : {})
    }
  ]
  if (dependencies.runtime.installation === 'local') {
    checks.push({
      name: 'bun',
      ok: dependencies.runtime.bunVersion === '1.4.2',
      detail:
        dependencies.runtime.bunVersion === '1.4.2'
          ? dependencies.runtime.bunVersion
          : `running Bun ${dependencies.runtime.bunVersion}; expected 1.4.2`
    })
  } else {
    checks.push({
      name: 'runtime',
      ok: dependencies.runtime.bunVersion !== 'unavailable',
      detail: `${dependencies.runtime.installation === 'release' ? 'embedded ' : ''}Bun ${dependencies.runtime.bunVersion}`
    })
  }
  const awsVersion = await prerequisite(dependencies, 'aws')
  checks.push({
    name: 'aws',
    ok: awsVersion.exitCode === 0,
    detail: awsVersion.exitCode === 0 ? cleanVersion(awsVersion) : 'AWS CLI is unavailable; install awscli and retry'
  })

  const pluginVersion = await prerequisite(dependencies, 'session-manager-plugin')
  checks.push({
    name: 'session-manager-plugin',
    ok: pluginVersion.exitCode === 0,
    detail:
      pluginVersion.exitCode === 0
        ? cleanVersion(pluginVersion)
        : 'AWS Session Manager plugin is unavailable; install session-manager-plugin and retry'
  })

  if (awsVersion.exitCode === 0) {
    try {
      await new AwsClient(dependencies.runner, invocation.config).account()
      checks.push({ name: 'aws-account', ok: true, detail: 'expected AWS identity verified' })
    } catch {
      checks.push({
        name: 'aws-account',
        ok: false,
        detail:
          'AWS identity check failed; run techne auth login and verify the expected account with techne diag --full'
      })
    }
  } else
    checks.push({
      name: 'aws-account',
      ok: true,
      status: 'skipped',
      detail: 'AWS CLI is unavailable; restore it before checking identity'
    })

  const ok = checks.every((check) => check.ok)
  const counts = {
    pass: checks.filter((check) => check.ok && !check.status).length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => !check.ok).length,
    skipped: checks.filter((check) => check.status === 'skipped').length
  }
  const verdict = !ok ? 'unhealthy' : 'healthy'
  const scope = 'read-only local prerequisites and AWS identity (may contact AWS); freshness not checked'
  if (invocation.json) {
    dependencies.io.stdout(
      `${JSON.stringify({ ...diagnosticContext(dependencies), scope, verdict, counts, ok, checks })}\n`
    )
  } else {
    printContext(dependencies)
    dependencies.io.stdout(`Scope: ${scope}\n`)
    for (const check of checks) {
      dependencies.io.stdout(`${check.status ?? (check.ok ? 'ok' : 'fail')} ${check.name}: ${check.detail}\n`)
    }
    dependencies.io.stdout(
      `Verdict: ${verdict}\nChecks: pass=${counts.pass} warn=${counts.warn} fail=${counts.fail} skipped=${counts.skipped}\n`
    )
  }
  return ok ? 0 : 1
}

function diag(invocation: Invocation, dependencies: CliDependencies): number {
  const report = {
    schema: 'techne/diag/v1',
    ...diagnosticContext(dependencies),
    ...(invocation.full
      ? {
          details: {
            executable: dependencies.runtime.executable,
            workingDirectory: dependencies.runtime.workingDirectory,
            profile: invocation.config.profile,
            region: invocation.config.region,
            expectedAccount: invocation.config.expectedAccount,
            controllerStack: invocation.config.controllerStack
          }
        }
      : {})
  }
  if (invocation.json) {
    dependencies.io.stdout(`${JSON.stringify(report)}\n`)
    return 0
  }
  printContext(dependencies)
  if (invocation.full) {
    dependencies.io.stdout(`executable: ${dependencies.runtime.executable}\n`)
    dependencies.io.stdout(`working directory: ${dependencies.runtime.workingDirectory}\n`)
    dependencies.io.stdout(`AWS profile: ${invocation.config.profile}\n`)
    dependencies.io.stdout(`AWS region: ${invocation.config.region}\n`)
    dependencies.io.stdout(`expected AWS account: ${invocation.config.expectedAccount}\n`)
    dependencies.io.stdout(`controller stack: ${invocation.config.controllerStack}\n`)
  } else {
    dependencies.io.stdout('Local paths and identifiers omitted; use diag --full to include them.\n')
  }
  return 0
}

async function authLogin(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  if (invocation.json) {
    throw new TechneError('--json is not supported for interactive authentication', 2)
  }
  if (!dependencies.interactive) {
    throw new TechneError('auth login requires an interactive terminal', 2)
  }

  const results = await loginConfiguredAuth(dependencies.runner, invocation.config)
  for (const result of results) {
    dependencies.io.stdout(`${result.ok ? 'ok' : 'fail'} auth ${result.surface}: ${result.detail}\n`)
  }

  return results.every((result) => result.ok) ? 0 : 1
}

function printControllerStatus(status: ControllerStatus, invocation: Invocation, io: CliIo): void {
  if (invocation.json) {
    io.stdout(`${JSON.stringify(status)}\n`)
    return
  }
  io.stdout(`controller stack: ${status.stackName}\n`)
  io.stdout(`state: ${status.exists ? (status.stackStatus ?? 'unknown') : 'absent'}\n`)
  if (status.instanceId !== null) {
    io.stdout(`instance: ${status.instanceId}\n`)
  }
}

async function controllerStatus(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  const status = await new AwsClient(dependencies.runner, invocation.config).controllerStatus()
  printControllerStatus(status, invocation, dependencies.io)
  return 0
}

async function controllerBootstrap(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  if (invocation.json) {
    throw new TechneError('--json is not supported for an interactive bootstrap', 2)
  }
  const plugin = await dependencies.runner.run('session-manager-plugin', ['--version'])
  if (plugin.exitCode !== 0) {
    throw new TechneError('AWS Session Manager plugin is unavailable')
  }

  const aws = new AwsClient(dependencies.runner, invocation.config)
  const status = await aws.controllerStatus()
  if (!status.exists) {
    throw new TechneError(`controller stack does not exist: ${status.stackName}`)
  }
  if (status.instanceId === null || !status.instanceId.startsWith('i-')) {
    throw new TechneError('controller instance output is missing')
  }

  dependencies.io.stdout(`Opening a private interactive bootstrap session on ${status.instanceId}.\n`)
  dependencies.io.stdout('Credential values are read by the remote process and are not sent as command parameters.\n')
  await aws.startBootstrap(status.instanceId)
  return 0
}

const COMMAND_HANDLERS: Readonly<
  Record<string, (invocation: Invocation, dependencies: CliDependencies) => Promise<number> | number>
> = {
  diag,
  doctor,
  'auth login': authLogin,
  'controller status': controllerStatus,
  'controller bootstrap': controllerBootstrap,
  'completion bash': (_invocation, dependencies) => {
    dependencies.io.stdout(renderCompletion('bash'))
    return 0
  },
  'completion zsh': (_invocation, dependencies) => {
    dependencies.io.stdout(renderCompletion('zsh'))
    return 0
  }
}

export async function runCli(argv: readonly string[], dependencies: CliDependencies): Promise<number> {
  try {
    const invocation = parseInvocation(argv, dependencies.environment)
    const name = commandName(invocation)
    if (invocation.command[0] === 'completion' && name !== 'completion bash' && name !== 'completion zsh') {
      throw new TechneError('completion requires exactly one supported shell: bash or zsh', 2)
    }
    if (invocation.full && invocation.command[0] !== 'diag') {
      throw new TechneError('--full is only supported for diag', 2)
    }
    if (invocation.command[0] === 'help') {
      const topic = invocation.command.slice(1).join(' ')
      const help = topic ? HELP_TOPICS[topic] : HELP
      if (!help) throw new TechneError(`unknown help topic: ${topic}`, 2)
      dependencies.io.stdout(help)
      return 0
    }
    const handler = COMMAND_HANDLERS[name]
    if (name && !handler) {
      throw new TechneError(`unknown command: ${name}`, 2)
    }
    if (invocation.version) {
      dependencies.io.stdout(`${dependencies.runtime.version}\n`)
      return 0
    }
    if (invocation.help || !handler) {
      dependencies.io.stdout(HELP)
      return 0
    }
    return await handler(invocation, dependencies)
  } catch (error) {
    if (error instanceof TechneError) {
      dependencies.io.stderr(`techne: error: ${error.message}\n`)
      if (error.exitCode === 2) dependencies.io.stderr('Usage: techne [global options] <command>\n')
      return error.exitCode
    }
    dependencies.io.stderr(`techne: error: ${String(error)}\n`)
    return 1
  }
}
