import { loginAuthSurfaces } from './auth.ts'
import {
  addBinding,
  bindingNames,
  configDirectory,
  type HostBinding,
  loadBindings,
  readSettings,
  scriptEnvironment,
  selectBinding,
  type TechneSettings,
  trySelect
} from './bindings.ts'
import { renderCompletion } from './completion.ts'
import { type Environment, type Invocation, parseInvocation } from './config.ts'
import { TechneError } from './errors.ts'
import { HarnessCheckout, type WorkspaceStatus } from './harness.ts'
import type { CommandRunner } from './process.ts'
import { PROVIDERS } from './providers/index.ts'
import {
  type ControllerAdapter,
  type ControllerStatus,
  type DoctorCheck,
  type HostAdapter,
  type HostInstance,
  type HostReport,
  optionFlag,
  type Provider,
  type TargetKind
} from './providers/provider.ts'
import { derive, type Recipe, RecipeCatalogue, type RecipeProvider } from './recipes.ts'
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
  // Provider adapters; tests add a stub provider beside AWS.
  providers?: readonly Provider[]
}

const USAGE = [
  'diag [--full]',
  'doctor',
  'auth login',
  'controller status',
  'controller bootstrap',
  'recipe list',
  'recipe show [recipe]',
  'host list',
  'host add <name> --recipe <recipe> [--provider <provider>]',
  'host status [--host <name> | --all]',
  'host setup --host <name> [--pull] [--dry-run]',
  'host start --host <name> [--dry-run]',
  'host stop --host <name> [--dry-run]',
  'host teardown --host <name> [--dry-run]',
  'host connect [--host <name>] [--dry-run] [path]'
]

const GLOBAL_OPTIONS = `Global options:
  --host <name>               host binding; setup, start, stop and teardown require it
  --harness-dir <path>        local ki-techne-harness checkout holding recipes and host scripts
  --json                      machine-readable output where supported
  --full                      include local paths and identifiers in diag
  --dry-run                   print host changes without making them
  --pull                      fast-forward clean checkouts on the host during host setup
  --all                       report every host binding, for host status
  --recipe <recipe>           recipe for host add
  --provider <provider>       provider for host add, when the recipe supports several
  -h, --help                  show help
  -V, --version               show version`

const TARGETS: Readonly<Record<string, TargetKind>> = {
  diag: 'controller',
  doctor: 'controller',
  'auth login': 'controller',
  'controller status': 'controller',
  'controller bootstrap': 'controller',
  'host status': 'host',
  'host setup': 'host',
  'host start': 'host',
  'host stop': 'host',
  'host teardown': 'host',
  'host connect': 'host'
}

const SELECTING = new Set(['host status', 'host connect', 'host list', 'recipe list', 'recipe show'])
const HOST_CHANGES = new Set(['host setup', 'host start', 'host stop', 'host teardown'])
const DRY_RUNS = new Set([...HOST_CHANGES, 'host connect'])

const GROUP_COMMANDS: Readonly<Record<string, string>> = {
  auth: 'login',
  controller: 'status or bootstrap',
  recipe: 'list or show',
  host: 'list, add, status, setup, start, stop, teardown or connect'
}

function providerOptionLines(provider: Provider): string {
  const lines = provider.options.map((option) => {
    const flag = `${optionFlag(provider.name, option.name)} ${option.value}`
    return `  ${flag.padEnd(28)}${option.description} (${option.targets.join(', ')})`
  })
  return `${provider.name.toUpperCase()} provider options:\n${lines.join('\n')}`
}

function rootHelp(providers: readonly Provider[]): string {
  return `techne - operate the Techne controller and agent hosts

Usage:
${USAGE.map((line) => `  techne [global options] ${line}`).join('\n')}
  techne completion <bash|zsh>
  techne help [command]

${GLOBAL_OPTIONS}

${providers.map(providerOptionLines).join('\n\n')}

Configuration: \${XDG_CONFIG_HOME:-~/.config}/techne/config.toml and hosts/<name>.toml.
Run 'techne help <command>' or 'techne <command> --help' for command help.
`
}

function accepted(providers: readonly Provider[], kind: TargetKind): string {
  const flags = providers.flatMap((provider) =>
    provider.options
      .filter((option) => option.targets.includes(kind))
      .map((option) => optionFlag(provider.name, option.name))
  )
  return `Provider options: ${flags.join(', ')}, for the target's provider only.\n`
}

function helpTopics(providers: readonly Provider[]): Readonly<Record<string, string>> {
  const host = accepted(providers, 'host')
  const controller = accepted(providers, 'controller')
  return {
    help: 'Usage: techne help [command]\nShow general help, or help for a command or command group.\n',
    auth: `Usage: techne [global options] auth <command>

Authenticate the controller target's provider.

Commands:
  login         open an interactive authentication session

Run 'techne help auth <command>' for command help.
`,
    controller: `Usage: techne [global options] controller <command>

Inspect and bootstrap the Techne controller configured in config.toml.

Commands:
  status        inspect the configured controller stack
  bootstrap     open a private interactive bootstrap session

Run 'techne help controller <command>' for command help.
`,
    recipe: `Usage: techne [global options] recipe <command>

Read the agent-host recipes in the ki-techne-harness checkout; no remote call.

Commands:
  list          list recipes, marking the selected host's
  show          show a recipe and the providers it supports

Run 'techne help recipe <command>' for command help.
`,
    host: `Usage: techne [global options] host <command>

Operate agent hosts: named bindings of harness recipes, one file each under hosts/.

Commands:
  list          list host bindings, marking the one selection picks
  add           write a new host binding; provisions nothing
  status        report a host and its workspace, read-only
  setup         converge a host's workspace over SSH
  start         start a stopped host
  stop          stop a running host: the kill switch
  teardown      terminate a host after typed confirmation
  connect       open a path on a host in Zed over SSH

Commands that change a host require --host <name>. Others select by --host,
TECHNE_HOST, default_host in config.toml, or the only binding.

Run 'techne help host <command>' for command help.
`,
    diag: `Usage: techne [global options] diag [--full]\nReport share-safe tool, installation, runtime and configuration facts; --full adds paths, identifiers and the controller target.\n${controller}`,
    doctor: `Usage: techne [global options] doctor\nReport diagnostic context, read-only configuration, prerequisite and identity checks for the controller target, verdict, and counts; freshness is not checked.\n${controller}`,
    'auth login': `Usage: techne [global options] auth login\nOpen an interactive authentication session for the controller target.\n${controller}`,
    'controller status': `Usage: techne [global options] controller status\nInspect the configured controller stack.\n${controller}`,
    'controller bootstrap': `Usage: techne [global options] controller bootstrap\nOpen a private interactive bootstrap session.\n${controller}`,
    'recipe list':
      'Usage: techne [global options] recipe list\nList the recipes in the harness checkout and the providers each supports.\n',
    'recipe show':
      "Usage: techne [global options] recipe show [recipe]\nShow a recipe, its providers and parameters; without a name, the selected host's recipe.\n",
    'host list':
      'Usage: techne [global options] host list\nList host bindings with recipe and provider, marking the one selection picks.\n',
    'host add':
      'Usage: techne [global options] host add <name> --recipe <recipe> [--provider <provider>]\nWrite hosts/<name>.toml with one provider table; refuses to overwrite and provisions nothing. --provider may be omitted only when the recipe supports one provider.\n',
    'host status': `Usage: techne [global options] host status [--host <name> | --all]\nReport the selected host, or every host with --all, and when it runs the harness workspace report, read-only.\n${host}`,
    'host setup': `Usage: techne [global options] host setup --host <name> [--pull] [--dry-run]\nConverge the host's workspace by running the recipe's setup script over SSH; --pull fast-forwards clean checkouts.\n${host}`,
    'host start': `Usage: techne [global options] host start --host <name> [--dry-run]\nStart a stopped host and wait until it runs.\n${host}`,
    'host stop': `Usage: techne [global options] host stop --host <name> [--dry-run]\nStop a running host: the kill switch.\n${host}`,
    'host teardown': `Usage: techne [global options] host teardown --host <name> [--dry-run]\nTerminate the host after you type its instance ID; this cannot be undone. Reports the footprint that remains.\n${host}`,
    'host connect': `Usage: techne [global options] host connect [--host <name>] [--dry-run] [path]\nCheck Tailscale reaches the host, then open path (default ~) in Zed over SSH.\n${host}`,
    completion: 'Usage: techne completion <bash|zsh>\nPrint shell completion source.\n'
  }
}

function commandName(command: readonly string[]): string {
  if (command[0] === 'host' && (command[1] === 'connect' || command[1] === 'add')) return `host ${command[1]}`
  if (command[0] === 'recipe' && command[1] === 'show') return 'recipe show'
  return command.join(' ')
}

// Loads configuration, recipes and bindings once, only when a command needs them.
class Context {
  readonly invocation: Invocation
  readonly dependencies: CliDependencies
  readonly providers: readonly Provider[]
  readonly recipes: RecipeCatalogue
  private settingsCache: TechneSettings | null = null
  private bindingsCache: HostBinding[] | null = null

  constructor(invocation: Invocation, dependencies: CliDependencies, providers: readonly Provider[]) {
    this.invocation = invocation
    this.dependencies = dependencies
    this.providers = providers
    this.recipes = new RecipeCatalogue(invocation.harnessDir)
  }

  get io(): CliIo {
    return this.dependencies.io
  }

  get directory(): string {
    return configDirectory(this.dependencies.environment)
  }

  settings(): TechneSettings {
    this.settingsCache ??= readSettings(this.directory, this.providers)
    return this.settingsCache
  }

  bindings(): HostBinding[] {
    this.bindingsCache ??= loadBindings(this.directory, this.recipes, this.providers)
    return this.bindingsCache
  }

  provider(name: string): Provider {
    return this.providers.find((provider) => provider.name === name) as Provider
  }

  // The provider options given for a target, refused when they do not fit it.
  options(provider: string, kind: TargetKind, subject: string): Record<string, string> {
    const options: Record<string, string> = {}
    for (const given of this.invocation.providerOptions) {
      if (given.provider !== provider) {
        throw new TechneError(`${given.flag} does not apply to ${subject}, whose provider is ${provider}`, 2)
      }
      const option = this.provider(provider).options.find((candidate) => candidate.name === given.option)
      if (!option?.targets.includes(kind)) {
        throw new TechneError(`${given.flag} does not apply to ${kind === 'host' ? 'a host' : 'the controller'}`, 2)
      }
      options[given.option] = given.value
    }
    return options
  }

  selected(): HostBinding {
    return selectBinding(this.bindings(), this.settings(), this.invocation.host, this.dependencies.environment)
  }

  // A command that changes a host acts only on the host named by --host.
  explicit(command: string): HostBinding {
    if (this.invocation.host === null) {
      const names = bindingNames(this.directory)
      throw new TechneError(
        `${command} changes a host and requires --host <name>; ${names.length > 0 ? `available: ${names.join(', ')}` : 'no host binding exists; add one with techne host add'}`,
        2
      )
    }
    return selectBinding(this.bindings(), { ...this.settings(), defaultHost: null }, this.invocation.host, {})
  }

  hostAdapter(binding: HostBinding): HostAdapter {
    const options = this.options(binding.provider, 'host', `host ${binding.name}`)
    return this.provider(binding.provider).host(binding, {
      runner: this.dependencies.runner,
      environment: this.dependencies.environment,
      options
    })
  }

  controller(): ControllerAdapter {
    const target = this.settings().controller
    if (target === null) {
      throw new TechneError(
        `no controller target is configured; add a [controller.<provider>] table to ${this.directory}/config.toml`
      )
    }
    return this.provider(target.provider).controller(target, {
      runner: this.dependencies.runner,
      environment: this.dependencies.environment,
      options: this.options(target.provider, 'controller', 'the controller')
    })
  }

  // What one recipe script receives: its declared binding variables and the provider's.
  hostEnvironment(binding: HostBinding, adapter: HostAdapter, script: string): Record<string, string> {
    return { ...scriptEnvironment(binding.recipe, binding.provider, adapter.values, script), ...adapter.environment }
  }

  tailscaleName(binding: HostBinding): string {
    const name = binding.values['tailscale_name']
    if (name === undefined) {
      throw new TechneError(`host ${binding.name} has no tailscale_name; set it in ${binding.file}`)
    }
    return name
  }
}

function cleanPlatform(runtime: TechneRuntime) {
  return {
    platform: ({ darwin: 'macos', win32: 'windows' } as Record<string, string>)[runtime.platform] ?? runtime.platform,
    architecture:
      ({ x64: 'x86_64', AMD64: 'x86_64' } as Record<string, string>)[runtime.architecture] ?? runtime.architecture
  }
}

function configurationSummary(context: Context): string {
  try {
    const settings = context.settings()
    const count = bindingNames(context.directory).length
    return `${count} host binding${count === 1 ? '' : 's'}; controller ${settings.controller?.provider ?? 'not configured'}`
  } catch {
    return 'invalid; run techne doctor'
  }
}

function diagnosticContext(context: Context) {
  const runtime = context.dependencies.runtime
  return {
    tool: 'techne',
    version: runtime.version,
    installation: runtime.installation,
    ...cleanPlatform(runtime),
    runtime: `Bun ${runtime.bunVersion}`,
    configuration: configurationSummary(context)
  }
}

function printContext(context: Context): void {
  for (const [label, value] of Object.entries(diagnosticContext(context))) {
    context.io.stdout(`${label.charAt(0).toUpperCase()}${label.slice(1)}: ${value}\n`)
  }
}

function errorText(error: unknown): string {
  if (error instanceof TechneError) return error.message
  throw error
}

async function doctor(context: Context): Promise<number> {
  const runtime = context.dependencies.runtime
  const checks: DoctorCheck[] = [
    {
      name: 'installation',
      ok: true,
      detail: runtime.installation,
      ...(runtime.installation === 'unknown' ? { status: 'warn' as const } : {})
    }
  ]
  if (runtime.installation === 'local') {
    checks.push({
      name: 'bun',
      ok: runtime.bunVersion === '1.4.2',
      detail: runtime.bunVersion === '1.4.2' ? runtime.bunVersion : `running Bun ${runtime.bunVersion}; expected 1.4.2`
    })
  } else {
    checks.push({
      name: 'runtime',
      ok: runtime.bunVersion !== 'unavailable',
      detail: `${runtime.installation === 'release' ? 'embedded ' : ''}Bun ${runtime.bunVersion}`
    })
  }

  let controller: ControllerAdapter | null = null
  try {
    const settings = context.settings()
    if (settings.controller === null) {
      checks.push({
        name: 'controller',
        ok: true,
        status: 'skipped',
        detail: 'no [controller.<provider>] table in config.toml; controller checks skipped'
      })
    } else {
      controller = context.controller()
      checks.push({ name: 'controller', ok: true, detail: `${settings.controller.provider} target configured` })
    }
  } catch (error) {
    const message = errorText(error)
    if (error instanceof TechneError && error.exitCode === 2) throw error
    checks.push({ name: 'controller', ok: false, detail: message })
  }
  if (controller !== null) checks.push(...(await controller.doctorChecks()))

  const ok = checks.every((check) => check.ok)
  const counts = {
    pass: checks.filter((check) => check.ok && !check.status).length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => !check.ok).length,
    skipped: checks.filter((check) => check.status === 'skipped').length
  }
  const verdict = !ok ? 'unhealthy' : 'healthy'
  const scope =
    'read-only local configuration, prerequisites and controller identity (may contact the provider); freshness not checked'
  if (context.invocation.json) {
    context.io.stdout(`${JSON.stringify({ ...diagnosticContext(context), scope, verdict, counts, ok, checks })}\n`)
  } else {
    printContext(context)
    context.io.stdout(`Scope: ${scope}\n`)
    for (const check of checks) {
      context.io.stdout(`${check.status ?? (check.ok ? 'ok' : 'fail')} ${check.name}: ${check.detail}\n`)
    }
    context.io.stdout(
      `Verdict: ${verdict}\nChecks: pass=${counts.pass} warn=${counts.warn} fail=${counts.fail} skipped=${counts.skipped}\n`
    )
  }
  return ok ? 0 : 1
}

function controllerFacts(context: Context): Record<string, string> {
  let target: TechneSettings['controller']
  try {
    target = context.settings().controller
  } catch (error) {
    return { error: errorText(error) }
  }
  if (target === null) return { provider: 'not configured' }
  try {
    return { provider: target.provider, ...context.controller().facts() }
  } catch (error) {
    if (error instanceof TechneError && error.exitCode === 2) throw error
    return { provider: target.provider, error: errorText(error) }
  }
}

function diag(context: Context): number {
  const { invocation, dependencies } = context
  const controller = invocation.full ? controllerFacts(context) : {}
  const report = {
    schema: 'techne/diag/v1',
    ...diagnosticContext(context),
    ...(invocation.full
      ? {
          details: {
            executable: dependencies.runtime.executable,
            workingDirectory: dependencies.runtime.workingDirectory,
            configurationDirectory: context.directory,
            harnessDirectory: invocation.harnessDir,
            controller
          }
        }
      : {})
  }
  if (invocation.json) {
    context.io.stdout(`${JSON.stringify(report)}\n`)
    return 0
  }
  printContext(context)
  if (invocation.full) {
    context.io.stdout(`executable: ${dependencies.runtime.executable}\n`)
    context.io.stdout(`working directory: ${dependencies.runtime.workingDirectory}\n`)
    context.io.stdout(`configuration directory: ${context.directory}\n`)
    context.io.stdout(`harness directory: ${invocation.harnessDir}\n`)
    for (const [field, value] of Object.entries(controller)) {
      context.io.stdout(`controller ${field}: ${value}\n`)
    }
  } else {
    context.io.stdout('Local paths and identifiers omitted; use diag --full to include them.\n')
  }
  return 0
}

async function authLogin(context: Context): Promise<number> {
  if (context.invocation.json) {
    throw new TechneError('--json is not supported for interactive authentication', 2)
  }
  if (!context.dependencies.interactive) {
    throw new TechneError('auth login requires an interactive terminal', 2)
  }
  const results = await loginAuthSurfaces([context.controller().authSurface()])
  for (const result of results) {
    context.io.stdout(`${result.ok ? 'ok' : 'fail'} auth ${result.surface}: ${result.detail}\n`)
  }
  return results.every((result) => result.ok) ? 0 : 1
}

function printControllerStatus(status: ControllerStatus, context: Context): void {
  if (context.invocation.json) {
    context.io.stdout(`${JSON.stringify(status)}\n`)
    return
  }
  context.io.stdout(`controller stack: ${status.stackName}\n`)
  context.io.stdout(`state: ${status.exists ? (status.stackStatus ?? 'unknown') : 'absent'}\n`)
  if (status.instanceId !== null) {
    context.io.stdout(`instance: ${status.instanceId}\n`)
  }
}

async function controllerStatus(context: Context): Promise<number> {
  printControllerStatus(await context.controller().status(), context)
  return 0
}

async function controllerBootstrap(context: Context): Promise<number> {
  if (context.invocation.json) {
    throw new TechneError('--json is not supported for an interactive bootstrap', 2)
  }
  await context.controller().bootstrap((line) => context.io.stdout(`${line}\n`))
  return 0
}

function rejectJson(context: Context, name: string): void {
  if (context.invocation.json) throw new TechneError(`--json is not supported for ${name}`, 2)
}

function selectedRecipe(context: Context): string | null {
  const bindings = context.bindings()
  const selection = trySelect(bindings, context.settings(), context.invocation.host, context.dependencies.environment)
  return bindings.find((binding) => binding.name === selection?.name)?.recipe.name ?? null
}

function recipeList(context: Context): number {
  const recipes = context.recipes.list()
  const selected = bindingNames(context.directory).length > 0 ? selectedRecipe(context) : null
  if (context.invocation.json) {
    context.io.stdout(
      `${JSON.stringify({
        schema: 'techne/recipe-list/v1',
        recipes: recipes.map((recipe) => ({
          name: recipe.name,
          summary: recipe.summary,
          runtime: recipe.runtime,
          providers: recipe.providers,
          selected: recipe.name === selected
        }))
      })}\n`
    )
    return 0
  }
  if (recipes.length === 0) context.io.stdout('no recipes in the harness checkout\n')
  for (const recipe of recipes) {
    context.io.stdout(
      `${recipe.name === selected ? '*' : ' '} ${recipe.name} (${recipe.providers.join(', ')}): ${recipe.summary}\n`
    )
  }
  return 0
}

function recipeShow(context: Context): number {
  const { command } = context.invocation
  if (command.length > 3) throw new TechneError('recipe show accepts at most one recipe', 2)
  const recipe: Recipe = context.recipes.get(command[2] ?? context.selected().recipe.name)
  if (context.invocation.json) {
    context.io.stdout(`${JSON.stringify({ schema: 'techne/recipe/v1', ...recipe })}\n`)
    return 0
  }
  context.io.stdout(`recipe: ${recipe.name}\nsummary: ${recipe.summary}\nruntime: ${recipe.runtime}\n`)
  context.io.stdout(`providers: ${recipe.providers.join(', ')}\n`)
  context.io.stdout(`parameters: ${Object.keys(recipe.parameters).join(', ') || 'none'}\n`)
  for (const provider of recipe.providers) {
    const parameters = Object.keys((recipe.provider[provider] as RecipeProvider).parameters)
    context.io.stdout(`${provider} parameters: ${parameters.join(', ') || 'none'}\n`)
  }
  return 0
}

function hostList(context: Context): number {
  const bindings = context.bindings()
  if (bindings.length === 0) {
    throw new TechneError('no host binding is configured; add one with techne host add <name> --recipe <recipe>')
  }
  const selection = trySelect(bindings, context.settings(), context.invocation.host, context.dependencies.environment)
  if (context.invocation.json) {
    context.io.stdout(
      `${JSON.stringify({
        schema: 'techne/host-list/v1',
        selection,
        hosts: bindings.map((binding) => ({
          name: binding.name,
          recipe: binding.recipe.name,
          provider: binding.provider,
          selected: binding.name === selection?.name
        }))
      })}\n`
    )
    return 0
  }
  for (const binding of bindings) {
    const mark = binding.name === selection?.name ? `*` : ' '
    const why = binding.name === selection?.name ? ` (selected by ${selection.source})` : ''
    context.io.stdout(`${mark} ${binding.name}: recipe ${binding.recipe.name}, provider ${binding.provider}${why}\n`)
  }
  if (selection === null) {
    context.io.stdout('no host selected; choose one with --host <name>, TECHNE_HOST or default_host in config.toml\n')
  }
  return 0
}

function hostAdd(context: Context): number {
  rejectJson(context, 'host add')
  const { command, recipe, provider } = context.invocation
  const name = command[2]
  if (name === undefined || command.length > 3) throw new TechneError('host add requires exactly one name', 2)
  if (recipe === null) throw new TechneError('host add requires --recipe <recipe>', 2)
  if (provider !== null && !context.providers.some((candidate) => candidate.name === provider)) {
    throw new TechneError(`unknown provider ${provider}`, 2)
  }
  const path = addBinding(context.directory, name, context.recipes.get(recipe), provider)
  context.io.stdout(`wrote ${path}\nset its provider values before use; nothing was provisioned\n`)
  return 0
}

interface HostStatusReport {
  binding: HostBinding
  report: HostReport
  workspace: WorkspaceStatus
}

async function statusOf(context: Context, binding: HostBinding): Promise<HostStatusReport> {
  const adapter = context.hostAdapter(binding)
  const report = await adapter.status()
  const workspace: WorkspaceStatus =
    report.state === 'running'
      ? await new HarnessCheckout(context.dependencies.runner, context.recipes).workspaceStatus(
          binding.recipe,
          context.hostEnvironment(binding, adapter, 'status')
        )
      : { state: 'skipped', report: null, detail: `host is ${report.state}` }
  return { binding, report, workspace }
}

function statusJson({ binding, report, workspace }: HostStatusReport) {
  return {
    host: binding.name,
    recipe: binding.recipe.name,
    provider: binding.provider,
    exists: report.exists,
    instanceId: report.instanceId,
    state: report.state,
    ...report.details,
    workspace
  }
}

function printHostStatus({ binding, report, workspace }: HostStatusReport, io: CliIo): void {
  io.stdout(`host: ${binding.name} (recipe ${binding.recipe.name}, provider ${binding.provider})\n`)
  io.stdout(`instance: ${report.instanceId ?? 'absent'}\n`)
  io.stdout(`state: ${report.state}\n`)
  for (const [label, value] of Object.entries(report.details)) io.stdout(`${label}: ${value}\n`)
  if (workspace.state === 'reported') {
    const text = workspace.report as string
    io.stdout(`workspace: reported by the recipe's status script\n${text}${text.endsWith('\n') ? '' : '\n'}`)
  } else {
    io.stdout(`workspace: ${workspace.state}${workspace.state === 'skipped' ? ` (${workspace.detail})` : ''}\n`)
  }
}

async function hostStatusAll(context: Context): Promise<number> {
  if (context.invocation.host !== null) throw new TechneError('--all and --host cannot be combined', 2)
  if (context.invocation.providerOptions.length > 0) {
    throw new TechneError(
      `${(context.invocation.providerOptions[0] as { flag: string }).flag} would apply to every host; provider options are not supported with --all`,
      2
    )
  }
  const bindings = context.bindings()
  if (bindings.length === 0) {
    throw new TechneError('no host binding is configured; add one with techne host add <name> --recipe <recipe>')
  }
  const results: (HostStatusReport | { binding: HostBinding; error: string })[] = []
  for (const binding of bindings) {
    try {
      results.push(await statusOf(context, binding))
    } catch (error) {
      results.push({ binding, error: errorText(error) })
    }
  }
  const failed = results.some((result) => 'error' in result || result.workspace.state === 'failed')
  if (context.invocation.json) {
    const hosts = results.map((result) =>
      'error' in result ? { host: result.binding.name, error: result.error } : statusJson(result)
    )
    context.io.stdout(`${JSON.stringify({ schema: 'techne/host-status-list/v1', hosts })}\n`)
  } else {
    results.forEach((result, index) => {
      if (index > 0) context.io.stdout('\n')
      if ('error' in result) {
        context.io.stdout(`host: ${result.binding.name}\nerror: ${result.error}\n`)
      } else {
        printHostStatus(result, context.io)
      }
    })
  }
  return failed ? 1 : 0
}

async function hostStatus(context: Context): Promise<number> {
  if (context.invocation.all) return await hostStatusAll(context)
  const status = await statusOf(context, context.selected())
  if (context.invocation.json) {
    context.io.stdout(`${JSON.stringify({ schema: 'techne/host-status/v2', ...statusJson(status) })}\n`)
  } else {
    printHostStatus(status, context.io)
  }
  if (status.workspace.state === 'failed') {
    context.io.stderr(`techne: error: workspace report failed: ${status.workspace.detail}\n`)
    return 1
  }
  return 0
}

async function hostSetup(context: Context): Promise<number> {
  rejectJson(context, 'host setup')
  const binding = context.explicit('host setup')
  const adapter = context.hostAdapter(binding)
  const harness = new HarnessCheckout(context.dependencies.runner, context.recipes)
  const script = harness.script(binding.recipe, 'setup')
  await new TailscaleClient(context.dependencies.runner).ensureReachable(context.tailscaleName(binding))
  const args = context.invocation.pull ? ['--pull'] : []
  const command = ['bash', script, ...args].join(' ')
  if (context.invocation.dryRun) {
    context.io.stdout(`dry run: would run ${command} for host ${binding.name}\n`)
    return 0
  }
  context.io.stdout(`running ${command} for host ${binding.name}\n`)
  await harness.setup(script, args, context.hostEnvironment(binding, adapter, 'setup'))
  return 0
}

async function requireInstance(context: Context, binding: HostBinding, adapter: HostAdapter): Promise<HostInstance> {
  const host = await adapter.find()
  if (host === null) {
    throw new TechneError(`host ${binding.name} has no instance`)
  }
  context.io.stdout(`host ${binding.name}: ${host.instanceId} (${host.state})\n`)
  return host
}

async function hostStart(context: Context): Promise<number> {
  rejectJson(context, 'host start')
  const binding = context.explicit('host start')
  const adapter = context.hostAdapter(binding)
  const host = await requireInstance(context, binding, adapter)
  if (host.state === 'running') {
    context.io.stdout('already running; nothing to do\n')
    return 0
  }
  if (host.state !== 'stopped') {
    throw new TechneError(`host ${binding.name} is ${host.state}; try again shortly`)
  }
  if (context.invocation.dryRun) {
    context.io.stdout(`dry run: would start ${host.instanceId} and wait until it runs\n`)
    return 0
  }
  await adapter.start(host.instanceId)
  context.io.stdout(`started ${host.instanceId}\n`)
  return 0
}

async function hostStop(context: Context): Promise<number> {
  rejectJson(context, 'host stop')
  const binding = context.explicit('host stop')
  const adapter = context.hostAdapter(binding)
  const host = await requireInstance(context, binding, adapter)
  if (host.state === 'stopped' || host.state === 'stopping') {
    context.io.stdout(`already ${host.state}; nothing to do\n`)
    return 0
  }
  if (context.invocation.dryRun) {
    context.io.stdout(`dry run: would stop ${host.instanceId}\n`)
    return 0
  }
  await adapter.stop(host.instanceId)
  context.io.stdout(`stopping ${host.instanceId}\n`)
  return 0
}

// The recipe's footprint that outlives the instance, provider first; an entry naming an absent value keeps its template.
function footprint(binding: HostBinding, adapter: HostAdapter): string[] {
  const section = binding.recipe.provider[binding.provider] as RecipeProvider
  return [...section.footprint, ...binding.recipe.footprint].map((item) => derive(item, adapter.values) ?? item)
}

async function hostTeardown(context: Context): Promise<number> {
  rejectJson(context, 'host teardown')
  const binding = context.explicit('host teardown')
  if (!context.invocation.dryRun && !context.dependencies.interactive) {
    throw new TechneError('host teardown requires an interactive terminal', 2)
  }
  const adapter = context.hostAdapter(binding)
  const host = await requireInstance(context, binding, adapter)
  context.io.stdout(`will TERMINATE ${host.instanceId}; this cannot be undone\n`)
  if (context.invocation.dryRun) {
    context.io.stdout(`dry run: would terminate ${host.instanceId}\n`)
    return 0
  }
  const typed = await context.io.readLine('type the instance ID to confirm: ')
  if (typed?.trim() !== host.instanceId) {
    throw new TechneError('confirmation did not match; nothing done')
  }
  await adapter.terminate(host.instanceId)
  context.io.stdout(`terminated ${host.instanceId}\n`)
  const remaining = footprint(binding, adapter)
  context.io.stdout(
    remaining.length > 0
      ? `teardown still needs, from recipe ${binding.recipe.name}:\n${remaining.map((item) => `  - ${item}\n`).join('')}`
      : `recipe ${binding.recipe.name} lists no remaining footprint\n`
  )
  return 0
}

async function hostConnect(context: Context): Promise<number> {
  rejectJson(context, 'host connect')
  if (context.invocation.command.length > 3) {
    throw new TechneError('host connect accepts at most one path', 2)
  }
  const binding = context.selected()
  context.options(binding.provider, 'host', `host ${binding.name}`)
  const name = context.tailscaleName(binding)
  const path = context.invocation.command[2] ?? '~'
  await new TailscaleClient(context.dependencies.runner).ensureReachable(name)
  const target = `ssh://${name}/${path.replace(/^\//, '')}`
  if (context.invocation.dryRun) {
    context.io.stdout(`dry run: would open ${target} in Zed\n`)
    return 0
  }
  const result = await context.dependencies.runner.run('zed', [target])
  if (result.exitCode !== 0) {
    throw new TechneError(`Zed could not open ${target}`)
  }
  context.io.stdout(`opened ${target} in Zed\n`)
  return 0
}

const COMMAND_HANDLERS: Readonly<Record<string, (context: Context) => Promise<number> | number>> = {
  diag,
  doctor,
  'auth login': authLogin,
  'controller status': controllerStatus,
  'controller bootstrap': controllerBootstrap,
  'recipe list': recipeList,
  'recipe show': recipeShow,
  'host list': hostList,
  'host add': hostAdd,
  'host status': hostStatus,
  'host setup': hostSetup,
  'host start': hostStart,
  'host stop': hostStop,
  'host teardown': hostTeardown,
  'host connect': hostConnect,
  'completion bash': (context) => {
    context.io.stdout(renderCompletion('bash', providerFlags(context.providers)))
    return 0
  },
  'completion zsh': (context) => {
    context.io.stdout(renderCompletion('zsh', providerFlags(context.providers)))
    return 0
  }
}

function providerFlags(providers: readonly Provider[]): string[] {
  return providers.flatMap((provider) => provider.options.map((option) => optionFlag(provider.name, option.name)))
}

// Options that only some commands accept, refused before anything runs.
function checkOptions(invocation: Invocation, name: string): void {
  if (invocation.full && invocation.command[0] !== 'diag') {
    throw new TechneError('--full is only supported for diag', 2)
  }
  if (invocation.dryRun && !DRY_RUNS.has(name)) {
    throw new TechneError('--dry-run is only supported for host setup, start, stop, teardown and connect', 2)
  }
  if (invocation.pull && name !== 'host setup') {
    throw new TechneError('--pull is only supported for host setup', 2)
  }
  if (invocation.all && name !== 'host status') {
    throw new TechneError('--all is only supported for host status', 2)
  }
  if ((invocation.recipe !== null || invocation.provider !== null) && name !== 'host add') {
    throw new TechneError('--recipe and --provider are only supported for host add', 2)
  }
  if (invocation.host !== null && !SELECTING.has(name) && !HOST_CHANGES.has(name)) {
    throw new TechneError('--host is only supported for host and recipe commands other than host add', 2)
  }
  const given = invocation.providerOptions[0]
  if (given !== undefined && TARGETS[name] === undefined) {
    throw new TechneError(`${given.flag} is not supported for ${name}; it has no host or controller target`, 2)
  }
}

export async function runCli(argv: readonly string[], dependencies: CliDependencies): Promise<number> {
  const providers = dependencies.providers ?? PROVIDERS
  const topics = helpTopics(providers)
  const help = rootHelp(providers)
  let usage = help
  try {
    const invocation = parseInvocation(argv, dependencies.environment, providers)
    const name = commandName(invocation.command)
    usage = topics[name] ?? topics[invocation.command[0] ?? ''] ?? help
    if (
      invocation.command[0] === 'completion' &&
      name !== 'completion bash' &&
      name !== 'completion zsh' &&
      !(invocation.help && name === 'completion')
    ) {
      throw new TechneError('completion requires exactly one supported shell: bash or zsh', 2)
    }
    if (invocation.command[0] === 'help') {
      const topic = commandName(invocation.command.slice(1)) || (invocation.help ? 'help' : '')
      const text = topic ? topics[topic] : help
      if (!text) {
        usage = help
        throw new TechneError(`unknown help topic: ${topic}`, 2)
      }
      dependencies.io.stdout(text)
      return 0
    }
    const handler = COMMAND_HANDLERS[name]
    if (name && !handler) {
      if (invocation.help && topics[name]) {
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
    checkOptions(invocation, name)
    return await handler(new Context(invocation, dependencies, providers))
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
