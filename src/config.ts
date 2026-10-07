import { TechneError } from './errors.ts'

export interface TechneConfig {
  profile: string
  region: string
  expectedAccount: string
  controllerStack: string
  hostProfile: string
}

export interface Invocation {
  command: readonly string[]
  config: TechneConfig
  json: boolean
  full: boolean
  dryRun: boolean
  help: boolean
  version: boolean
}

export type Environment = Record<string, string | undefined>

const DEFAULTS: TechneConfig = {
  profile: 'knowledge-islands-techne',
  region: 'eu-west-1',
  expectedAccount: '655383751458',
  controllerStack: 'ki-techne-ops-007-controller',
  hostProfile: 'knowledge-islands-techne-agent-host'
}

type ConfigKey = keyof TechneConfig

const VALUE_FLAGS: Readonly<Record<string, ConfigKey>> = {
  '--profile': 'profile',
  '--region': 'region',
  '--account': 'expectedAccount',
  '--controller-stack': 'controllerStack',
  '--host-profile': 'hostProfile'
}

function environmentConfig(environment: Environment): TechneConfig {
  return {
    profile: environment['AWS_PROFILE'] ?? DEFAULTS.profile,
    region: environment['AWS_REGION'] ?? DEFAULTS.region,
    expectedAccount: environment['EXPECTED_AWS_ACCOUNT'] ?? DEFAULTS.expectedAccount,
    controllerStack: environment['CONTROLLER_STACK_NAME'] ?? DEFAULTS.controllerStack,
    hostProfile: environment['TECHNE_HOST_PROFILE'] ?? DEFAULTS.hostProfile
  }
}

export function parseInvocation(argv: readonly string[], environment: Environment): Invocation {
  const config = environmentConfig(environment)
  const command: string[] = []
  let json = false
  let full = false
  let dryRun = false
  let help = false
  let version = false

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string
    if (argument === '--json') {
      json = true
      continue
    }
    if (argument === '--full') {
      full = true
      continue
    }
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }
    if (argument === '--version' || argument === '-V') {
      version = true
      continue
    }
    const configKey = VALUE_FLAGS[argument]
    if (configKey !== undefined) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        throw new TechneError(`${argument} requires a value`, 2)
      }
      config[configKey] = value
      index += 1
      continue
    }
    if (argument.startsWith('-')) {
      throw new TechneError(`unknown option: ${argument}`, 2)
    }
    command.push(argument)
  }

  return { command, config, json, full, dryRun, help, version }
}
