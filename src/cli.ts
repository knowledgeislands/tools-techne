import { AGENT_HOST_NAME, type AgentHost, AgentHostClient, type AgentHostStatus } from './agent-host.ts'
import { loginConfiguredAuth } from './auth.ts'
import { AwsClient, type ControllerStatus } from './aws.ts'
import { renderCompletion } from './completion.ts'
import { type Environment, type Invocation, parseInvocation } from './config.ts'
import { TechneError } from './errors.ts'
import { HarnessCheckout, type WorkspaceStatus } from './harness.ts'
import type { CommandRunner } from './process.ts'
import type { TechneRuntime } from './runtime.ts'
import { TailscaleClient } from './tailscale.ts'

export interface CliIo {
  stdout(value: string): void
  stderr(value: string): void
  readLine(prompt: string): Promise<string | null>
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
  techne [global options] host status
  techne [global options] host setup [--pull] [--dry-run]
  techne [global options] host start [--dry-run]
  techne [global options] host stop [--dry-run]
  techne [global options] host teardown [--dry-run]
  techne [global options] host connect [--dry-run] [path]
  techne completion <bash|zsh>
  techne help [command]

Global options:
  --profile <name>            AWS profile
  --region <region>           AWS region
  --account <id>              expected AWS account
  --controller-stack <name>   controller CloudFormation stack
  --host-profile <name>       AWS profile for the agent host operator role
  --harness-dir <path>        local ki-techne-harness checkout for host setup and status
  --json                      machine-readable output where supported
  --full                      include local paths and identifiers in diag
  --dry-run                   print host changes without making them
  --pull                      fast-forward clean checkouts on the host during host setup
  -h, --help                  show help
  -V, --version               show version

Run 'techne help <command>' or 'techne <command> --help' for command help.
`

const GROUP_COMMANDS: Readonly<Record<string, string>> = {
  auth: 'login',
  controller: 'status or bootstrap',
  host: 'status, setup, start, stop, teardown or connect'
}

const HELP_TOPICS: Readonly<Record<string, string>> = {
  help: 'Usage: techne help [command]\nShow general help, or help for a command or command group.\n',
  auth: `Usage: techne [global options] auth <command>

Authenticate the configured provider surfaces.

Commands:
  login         open an interactive authentication session

Run 'techne help auth <command>' for command help.
`,
  controller: `Usage: techne [global options] controller <command>

Inspect and bootstrap the Techne controller.

Commands:
  status        inspect the configured controller stack
  bootstrap     open a private interactive bootstrap session

Run 'techne help controller <command>' for command help.
`,
  host: `Usage: techne [global options] host <command>

Operate the one agent host tagged ki-agent-host-id=agent-host.

Commands:
  status        report the agent host and its workspace, read-only
  setup         converge the agent host workspace over SSH
  start         start a stopped agent host
  stop          stop a running agent host: the kill switch
  teardown      terminate the agent host after typed confirmation
  connect       open a path on the agent host in Zed over SSH

Run 'techne help host <command>' for command help.
`,
  diag: 'Usage: techne [global options] diag [--full]\nReport share-safe tool, installation, host, runtime, and configuration facts; --full includes paths and identifiers.\n',
  doctor:
    'Usage: techne [global options] doctor\nReport diagnostic context, read-only local prerequisite and AWS identity checks, verdict, and counts; freshness is not checked.\n',
  'auth login': 'Usage: techne [global options] auth login\nOpen an interactive authentication session.\n',
  'controller status': 'Usage: techne [global options] controller status\nInspect the configured controller stack.\n',
  'controller bootstrap':
    'Usage: techne [global options] controller bootstrap\nOpen a private interactive bootstrap session.\n',
  'host status':
    'Usage: techne [global options] host status\nReport the one agent host tagged ki-agent-host-id=agent-host and, when it runs, the harness workspace report, read-only.\n',
  'host setup':
    'Usage: techne [global options] host setup [--pull] [--dry-run]\nConverge the agent host workspace by running the harness setup.sh over SSH; --pull fast-forwards clean checkouts.\n',
  'host start':
    'Usage: techne [global options] host start [--dry-run]\nStart a stopped agent host and wait until it runs.\n',
  'host stop': 'Usage: techne [global options] host stop [--dry-run]\nStop a running agent host: the kill switch.\n',
  'host teardown':
    'Usage: techne [global options] host teardown [--dry-run]\nTerminate the agent host after you type its instance ID; this cannot be undone.\n',
  'host connect':
    'Usage: techne [global options] host connect [--dry-run] [path]\nCheck Tailscale reaches the agent host, then open path (default ~) in Zed over SSH.\n',
  completion: 'Usage: techne completion <bash|zsh>\nPrint shell completion source.\n'
}

const HOST_CHANGES = new Set(['host setup', 'host start', 'host stop', 'host teardown', 'host connect'])

function commandName(command: readonly string[]): string {
  if (command[0] === 'host' && command[1] === 'connect') return 'host connect'
  return command.join(' ')
}

function scopedHelp(command: readonly string[]): string {
  return HELP_TOPICS[commandName(command)] ?? HELP_TOPICS[command[0] ?? ''] ?? HELP
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

function rejectJson(invocation: Invocation, name: string): void {
  if (invocation.json) throw new TechneError(`--json is not supported for ${name}`, 2)
}

async function requireHost(client: AgentHostClient, invocation: Invocation, io: CliIo): Promise<AgentHost> {
  await client.verifyOperator()
  const host = await client.find()
  if (host === null) {
    throw new TechneError(`no agent host tagged ki-agent-host-id=agent-host in ${invocation.config.region}`)
  }
  io.stdout(`agent host: ${host.instanceId} (${host.state})\n`)
  return host
}

function printHostStatus(status: AgentHostStatus, workspace: WorkspaceStatus, invocation: Invocation, io: CliIo): void {
  if (invocation.json) {
    io.stdout(`${JSON.stringify({ schema: 'techne/host-status/v1', ...status, workspace })}\n`)
    return
  }
  io.stdout(`agent host: ${status.instanceId ?? 'absent'}\n`)
  io.stdout(`state: ${status.state}\n`)
  io.stdout(`selector: ${status.selector}\n`)
  io.stdout(`region: ${status.region}\n`)
  if (workspace.state === 'reported') {
    const report = workspace.report as string
    io.stdout(`workspace: reported by ki-techne-harness status.sh\n${report}${report.endsWith('\n') ? '' : '\n'}`)
  } else {
    io.stdout(`workspace: ${workspace.state}${workspace.state === 'skipped' ? ` (${workspace.detail})` : ''}\n`)
  }
}

async function hostStatus(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  const status = await new AgentHostClient(dependencies.runner, invocation.config).status()
  const workspace: WorkspaceStatus =
    status.state === 'running'
      ? await new HarnessCheckout(dependencies.runner, invocation.config.harnessDir).workspaceStatus()
      : { state: 'skipped', report: null, detail: `agent host is ${status.state}` }
  printHostStatus(status, workspace, invocation, dependencies.io)
  if (workspace.state === 'failed') {
    dependencies.io.stderr(`techne: error: workspace report failed: ${workspace.detail}\n`)
    return 1
  }
  return 0
}

async function hostSetup(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  rejectJson(invocation, 'host setup')
  const harness = new HarnessCheckout(dependencies.runner, invocation.config.harnessDir)
  const script = harness.script('setup.sh')
  await new TailscaleClient(dependencies.runner).ensureReachable(AGENT_HOST_NAME)
  const args = invocation.pull ? ['--pull'] : []
  const command = ['bash', script, ...args].join(' ')
  if (invocation.dryRun) {
    dependencies.io.stdout(`dry run: would run ${command}\n`)
    return 0
  }
  dependencies.io.stdout(`running ${command}\n`)
  await harness.setup(script, args)
  return 0
}

async function hostStart(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  rejectJson(invocation, 'host start')
  const client = new AgentHostClient(dependencies.runner, invocation.config)
  const host = await requireHost(client, invocation, dependencies.io)
  if (host.state === 'running') {
    dependencies.io.stdout('already running; nothing to do\n')
    return 0
  }
  if (host.state !== 'stopped') {
    throw new TechneError(`agent host is ${host.state}; try again shortly`)
  }
  if (invocation.dryRun) {
    dependencies.io.stdout(`dry run: would start ${host.instanceId} and wait until it runs\n`)
    return 0
  }
  await client.start(host.instanceId)
  dependencies.io.stdout(`started ${host.instanceId}\n`)
  return 0
}

async function hostStop(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  rejectJson(invocation, 'host stop')
  const client = new AgentHostClient(dependencies.runner, invocation.config)
  const host = await requireHost(client, invocation, dependencies.io)
  if (host.state === 'stopped' || host.state === 'stopping') {
    dependencies.io.stdout(`already ${host.state}; nothing to do\n`)
    return 0
  }
  if (invocation.dryRun) {
    dependencies.io.stdout(`dry run: would stop ${host.instanceId}\n`)
    return 0
  }
  await client.stop(host.instanceId)
  dependencies.io.stdout(`stopping ${host.instanceId}\n`)
  return 0
}

async function hostTeardown(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  rejectJson(invocation, 'host teardown')
  if (!invocation.dryRun && !dependencies.interactive) {
    throw new TechneError('host teardown requires an interactive terminal', 2)
  }
  const client = new AgentHostClient(dependencies.runner, invocation.config)
  const host = await requireHost(client, invocation, dependencies.io)
  dependencies.io.stdout(`will TERMINATE ${host.instanceId}; this cannot be undone\n`)
  if (invocation.dryRun) {
    dependencies.io.stdout(`dry run: would terminate ${host.instanceId}\n`)
    return 0
  }
  const typed = await dependencies.io.readLine('type the instance ID to confirm: ')
  if (typed?.trim() !== host.instanceId) {
    throw new TechneError('confirmation did not match; nothing done')
  }
  await client.terminate(host.instanceId)
  dependencies.io.stdout(`terminated ${host.instanceId}\n`)
  dependencies.io.stdout(
    'teardown still needs: the security group, /ki/techne/agent-host/* parameters, the Tailscale device,\n' +
      'the ki-techne-agent-host-operator IAM role and the AWS profile\n'
  )
  return 0
}

async function hostConnect(invocation: Invocation, dependencies: CliDependencies): Promise<number> {
  rejectJson(invocation, 'host connect')
  if (invocation.command.length > 3) {
    throw new TechneError('host connect accepts at most one path', 2)
  }
  const path = invocation.command[2] ?? '~'
  await new TailscaleClient(dependencies.runner).ensureReachable(AGENT_HOST_NAME)
  const target = `ssh://${AGENT_HOST_NAME}/${path.replace(/^\//, '')}`
  if (invocation.dryRun) {
    dependencies.io.stdout(`dry run: would open ${target} in Zed\n`)
    return 0
  }
  const result = await dependencies.runner.run('zed', [target])
  if (result.exitCode !== 0) {
    throw new TechneError(`Zed could not open ${target}`)
  }
  dependencies.io.stdout(`opened ${target} in Zed\n`)
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
  'host status': hostStatus,
  'host setup': hostSetup,
  'host start': hostStart,
  'host stop': hostStop,
  'host teardown': hostTeardown,
  'host connect': hostConnect,
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
  let usage = HELP
  try {
    const invocation = parseInvocation(argv, dependencies.environment)
    const name = commandName(invocation.command)
    usage = scopedHelp(invocation.command)
    if (
      invocation.command[0] === 'completion' &&
      name !== 'completion bash' &&
      name !== 'completion zsh' &&
      !(invocation.help && name === 'completion')
    ) {
      throw new TechneError('completion requires exactly one supported shell: bash or zsh', 2)
    }
    if (invocation.full && invocation.command[0] !== 'diag') {
      throw new TechneError('--full is only supported for diag', 2)
    }
    if (invocation.dryRun && !HOST_CHANGES.has(name)) {
      throw new TechneError('--dry-run is only supported for host setup, start, stop, teardown and connect', 2)
    }
    if (invocation.pull && name !== 'host setup') {
      throw new TechneError('--pull is only supported for host setup', 2)
    }
    if (invocation.command[0] === 'help') {
      const topic = commandName(invocation.command.slice(1)) || (invocation.help ? 'help' : '')
      const help = topic ? HELP_TOPICS[topic] : HELP
      if (!help) {
        usage = HELP
        throw new TechneError(`unknown help topic: ${topic}`, 2)
      }
      dependencies.io.stdout(help)
      return 0
    }
    const handler = COMMAND_HANDLERS[name]
    if (name && !handler) {
      if (invocation.help && HELP_TOPICS[name]) {
        dependencies.io.stdout(usage)
        return 0
      }
      const commands = GROUP_COMMANDS[name]
      if (commands) throw new TechneError(`${name} requires a command: ${commands}`, 2)
      throw new TechneError(`unknown command: ${name}`, 2)
    }
    if (invocation.version) {
      dependencies.io.stdout(`${dependencies.runtime.version}\n`)
      return 0
    }
    if (invocation.help || !handler) {
      dependencies.io.stdout(usage)
      return 0
    }
    return await handler(invocation, dependencies)
  } catch (error) {
    if (error instanceof TechneError) {
      dependencies.io.stderr(`techne: error: ${error.message}\n`)
      if (error.exitCode === 2) dependencies.io.stderr(usage)
      return error.exitCode
    }
    dependencies.io.stderr(`techne: error: ${String(error)}\n`)
    return 1
  }
}
