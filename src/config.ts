import { TechneError } from './errors.ts'

export type Environment = Record<string, string | undefined>

export interface ProviderOptionValue {
  provider: string
  option: string
  flag: string
  value: string
}

export interface Invocation {
  command: readonly string[]
  harnessDir: string
  host: string | null
  recipe: string | null
  provider: string | null
  providerOptions: readonly ProviderOptionValue[]
  json: boolean
  full: boolean
  dryRun: boolean
  pull: boolean
  all: boolean
  help: boolean
  version: boolean
}

// The provider options the parser recognises, as --<provider>-<option>.
export interface OptionCatalogue {
  readonly name: string
  readonly options: readonly { name: string }[]
}

const HARNESS_CHECKOUT = 'workspaces/kit/knowledgeislands/ki-techne-harness'

type ValueKey = 'harnessDir' | 'host' | 'recipe' | 'provider'

const VALUE_FLAGS: Readonly<Record<string, ValueKey>> = {
  '--harness-dir': 'harnessDir',
  '--host': 'host',
  '--recipe': 'recipe',
  '--provider': 'provider'
}

const SWITCHES: Readonly<Record<string, 'json' | 'full' | 'dryRun' | 'pull' | 'all' | 'help' | 'version'>> = {
  '--json': 'json',
  '--full': 'full',
  '--dry-run': 'dryRun',
  '--pull': 'pull',
  '--all': 'all',
  '--help': 'help',
  '-h': 'help',
  '--version': 'version',
  '-V': 'version'
}

function providerFlags(providers: readonly OptionCatalogue[]): Map<string, { provider: string; option: string }> {
  const flags = new Map<string, { provider: string; option: string }>()
  for (const provider of providers) {
    for (const option of provider.options) {
      flags.set(`--${provider.name}-${option.name}`, { provider: provider.name, option: option.name })
    }
  }
  return flags
}

export function parseInvocation(
  argv: readonly string[],
  environment: Environment,
  providers: readonly OptionCatalogue[]
): Invocation {
  const flags = providerFlags(providers)
  const invocation = {
    command: [] as string[],
    harnessDir:
      environment['TECHNE_HARNESS_DIR'] ?? (environment['HOME'] ? `${environment['HOME']}/${HARNESS_CHECKOUT}` : ''),
    host: null as string | null,
    recipe: null as string | null,
    provider: null as string | null,
    providerOptions: [] as ProviderOptionValue[],
    json: false,
    full: false,
    dryRun: false,
    pull: false,
    all: false,
    help: false,
    version: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string
    const toggle = SWITCHES[argument]
    if (toggle !== undefined) {
      invocation[toggle] = true
      continue
    }
    const key = VALUE_FLAGS[argument]
    const providerFlag = flags.get(argument)
    if (key !== undefined || providerFlag !== undefined) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new TechneError(`${argument} requires a value`, 2)
      }
      index += 1
      if (key !== undefined) {
        invocation[key] = value
      } else {
        const { provider, option } = providerFlag as { provider: string; option: string }
        invocation.providerOptions = [
          ...invocation.providerOptions.filter((given) => given.flag !== argument),
          { provider, option, flag: argument, value }
        ]
      }
      continue
    }
    if (argument.startsWith('-')) {
      throw new TechneError(`unknown option: ${argument}`, 2)
    }
    invocation.command.push(argument)
  }

  return invocation
}
