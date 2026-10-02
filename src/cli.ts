import { loginConfiguredAuth } from './auth.ts'
import { AwsClient, type ControllerStatus } from './aws.ts'
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
}

const HELP = `techne — operate the Techne controller and execution fabric

Usage:
  techne [global options] diag
  techne [global options] doctor
  techne [global options] auth login
  techne [global options] controller status
  techne [global options] controller bootstrap

Global options:
  --profile <name>            AWS profile
  --region <region>           AWS region
  --account <id>              expected AWS account
  --controller-stack <name>   controller CloudFormation stack
  --json                      machine-readable output where supported
  -h, --help                  show help
  -V, --version               show version
`

function commandName(invocation: Invocation): string {
  return invocation.command.join(' ')
}

function cleanVersion(result: { stdout: string; stderr: string }): string {
  return (result.stdout.trim() || result.stderr.trim()).split('\n', 1)[0] as string
}

async function doctor(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  const checks: DoctorCheck[] = [
    {
      name: 'installation',
      ok: true,
      detail: `${dependencies.runtime.installation} (${dependencies.runtime.executable})`
    }
  ]
  if (dependencies.runtime.installation === 'local') {
    checks.push({
      name: 'bun',
      ok: dependencies.runtime.bunVersion === '1.4.1',
      detail:
        dependencies.runtime.bunVersion === '1.4.1'
          ? dependencies.runtime.bunVersion
          : `running Bun ${dependencies.runtime.bunVersion}; expected 1.4.1`
    })
  } else {
    checks.push({ name: 'runtime', ok: true, detail: `embedded Bun ${dependencies.runtime.bunVersion}` })
  }
  const awsVersion = await dependencies.runner.run('aws', ['--version'])
  checks.push({
    name: 'aws',
    ok: awsVersion.exitCode === 0,
    detail: awsVersion.exitCode === 0 ? cleanVersion(awsVersion) : 'AWS CLI is unavailable'
  })

  const pluginVersion = await dependencies.runner.run('session-manager-plugin', ['--version'])
  checks.push({
    name: 'session-manager-plugin',
    ok: pluginVersion.exitCode === 0,
    detail: pluginVersion.exitCode === 0 ? cleanVersion(pluginVersion) : 'AWS Session Manager plugin is unavailable'
  })

  if (awsVersion.exitCode === 0) {
    try {
      const account = await new AwsClient(dependencies.runner, invocation.config).account()
      checks.push({ name: 'aws-account', ok: true, detail: account })
    } catch (error) {
      checks.push({
        name: 'aws-account',
        ok: false,
        detail: String(error)
      })
    }
  }

  const ok = checks.every((check) => check.ok)
  if (invocation.json) {
    dependencies.io.stdout(`${JSON.stringify({ ok, checks })}\n`)
  } else {
    for (const check of checks) {
      dependencies.io.stdout(`${check.ok ? 'ok' : 'fail'} ${check.name}: ${check.detail}\n`)
    }
  }
  return ok ? 0 : 1
}

function diag(invocation: Invocation, dependencies: CliDependencies): number {
  const report = {
    version: dependencies.runtime.version,
    installation: dependencies.runtime.installation,
    executable: dependencies.runtime.executable,
    workingDirectory: dependencies.runtime.workingDirectory,
    runtime: `Bun ${dependencies.runtime.bunVersion}`,
    configuration: {
      profile: invocation.config.profile,
      region: invocation.config.region,
      expectedAccount: invocation.config.expectedAccount,
      controllerStack: invocation.config.controllerStack
    }
  }
  if (invocation.json) {
    dependencies.io.stdout(`${JSON.stringify(report)}\n`)
    return 0
  }
  dependencies.io.stdout(`Techne ${report.version}\n`)
  dependencies.io.stdout(`installation: ${report.installation}\n`)
  dependencies.io.stdout(`executable: ${report.executable}\n`)
  dependencies.io.stdout(`working directory: ${report.workingDirectory}\n`)
  dependencies.io.stdout(`runtime: ${report.runtime}\n`)
  dependencies.io.stdout(`AWS profile: ${report.configuration.profile}\n`)
  dependencies.io.stdout(`AWS region: ${report.configuration.region}\n`)
  dependencies.io.stdout(`expected AWS account: ${report.configuration.expectedAccount}\n`)
  dependencies.io.stdout(`controller stack: ${report.configuration.controllerStack}\n`)
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
  'controller bootstrap': controllerBootstrap
}

export async function runCli(argv: readonly string[], dependencies: CliDependencies): Promise<number> {
  try {
    const invocation = parseInvocation(argv, dependencies.environment)
    const name = commandName(invocation)
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
      dependencies.io.stderr(`error: ${error.message}\n`)
      return error.exitCode
    }
    dependencies.io.stderr(`error: ${String(error)}\n`)
    return 1
  }
}
