import type { AuthSurface, AuthSurfaceSuccessStatus } from '../../auth.ts'
import type { ControllerTarget, HostBinding } from '../../bindings.ts'
import { TechneError } from '../../errors.ts'
import type { CommandResult, CommandRunner } from '../../process.ts'
import { derive } from '../../recipes.ts'
import { scalarText } from '../../toml.ts'
import type {
  ControllerAdapter,
  ControllerStatus,
  DoctorCheck,
  Provider,
  ProviderContext,
  ProviderOption
} from '../provider.ts'
import { AwsAuthenticationExpiredError, AwsClient, type AwsSettings } from './client.ts'
import { AwsHost } from './host.ts'

const NAME = 'aws'

const OPTIONS: readonly ProviderOption[] = [
  { name: 'profile', value: '<name>', description: 'AWS profile', targets: ['host', 'controller'] },
  { name: 'region', value: '<region>', description: 'AWS region', targets: ['host', 'controller'] },
  { name: 'account', value: '<id>', description: 'expected AWS account', targets: ['host', 'controller'] },
  {
    name: 'controller-stack',
    value: '<name>',
    description: 'controller CloudFormation stack',
    targets: ['controller']
  },
  {
    name: 'operator-profile',
    value: '<name>',
    description: 'AWS profile for the host operator role',
    targets: ['host']
  }
]

const BINDING_FIELDS = [
  'account',
  'region',
  'admin_profile',
  'operator_profile',
  'tag',
  'stack_name',
  'parameter_prefix',
  'operator_role',
  'instance_type',
  'volume_size'
] as const

const CONTROLLER_FIELDS = ['account', 'region', 'profile', 'stack'] as const

function ambient(context: ProviderContext, variable: string): string | null {
  return context.environment[variable] || null
}

function refuse(what: string, sources: string): never {
  throw new TechneError(`no ${what} is configured; set ${sources}`)
}

function cleanVersion(result: CommandResult): string {
  return (result.stdout.trim() || result.stderr.trim()).split('\n', 1)[0] as string
}

async function prerequisite(runner: CommandRunner, command: string): Promise<CommandResult> {
  try {
    return await runner.run(command, ['--version'])
  } catch {
    return { stdout: '', stderr: '', exitCode: 1 }
  }
}

class AwsAuthSurface implements AuthSurface {
  readonly name = NAME
  private readonly runner: CommandRunner
  private readonly client: AwsClient

  constructor(runner: CommandRunner, settings: AwsSettings) {
    this.runner = runner
    this.client = new AwsClient(runner, settings)
  }

  async login(): Promise<{ status: AuthSurfaceSuccessStatus; detail: string }> {
    const version = await this.runner.run('aws', ['--version'])
    if (version.exitCode !== 0) {
      throw new Error('AWS CLI is unavailable')
    }

    try {
      const account = await this.client.account()
      return { status: 'already-authenticated', detail: `account ${account}` }
    } catch (error) {
      if (!(error instanceof AwsAuthenticationExpiredError)) {
        throw error
      }
    }

    const account = await this.client.login()
    return { status: 'authenticated', detail: `account ${account}` }
  }
}

class AwsController implements ControllerAdapter {
  private readonly runner: CommandRunner
  private readonly settings: AwsSettings
  private readonly stack: string

  constructor(runner: CommandRunner, settings: AwsSettings, stack: string) {
    this.runner = runner
    this.settings = settings
    this.stack = stack
  }

  facts(): Readonly<Record<string, string>> {
    return {
      profile: this.settings.profile,
      region: this.settings.region,
      account: this.settings.account,
      stack: this.stack
    }
  }

  async doctorChecks(): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = []
    const awsVersion = await prerequisite(this.runner, 'aws')
    checks.push({
      name: 'aws',
      ok: awsVersion.exitCode === 0,
      detail: awsVersion.exitCode === 0 ? cleanVersion(awsVersion) : 'AWS CLI is unavailable; install awscli and retry'
    })
    const pluginVersion = await prerequisite(this.runner, 'session-manager-plugin')
    checks.push({
      name: 'session-manager-plugin',
      ok: pluginVersion.exitCode === 0,
      detail:
        pluginVersion.exitCode === 0
          ? cleanVersion(pluginVersion)
          : 'AWS Session Manager plugin is unavailable; install session-manager-plugin and retry'
    })
    if (awsVersion.exitCode !== 0) {
      checks.push({
        name: 'aws-account',
        ok: true,
        status: 'skipped',
        detail: 'AWS CLI is unavailable; restore it before checking identity'
      })
      return checks
    }
    try {
      await new AwsClient(this.runner, this.settings).account()
      checks.push({ name: 'aws-account', ok: true, detail: 'expected AWS identity verified' })
    } catch {
      checks.push({
        name: 'aws-account',
        ok: false,
        detail:
          'AWS identity check failed; run techne auth login and verify the expected account with techne diag --full'
      })
    }
    return checks
  }

  authSurface(): AuthSurface {
    return new AwsAuthSurface(this.runner, this.settings)
  }

  async status(): Promise<ControllerStatus> {
    return await new AwsClient(this.runner, this.settings).controllerStatus(this.stack)
  }

  async bootstrap(announce: (line: string) => void): Promise<void> {
    const plugin = await this.runner.run('session-manager-plugin', ['--version'])
    if (plugin.exitCode !== 0) {
      throw new TechneError('AWS Session Manager plugin is unavailable')
    }
    const client = new AwsClient(this.runner, this.settings)
    const status = await client.controllerStatus(this.stack)
    if (!status.exists) {
      throw new TechneError(`controller stack does not exist: ${status.stackName}`)
    }
    if (status.instanceId === null || !status.instanceId.startsWith('i-')) {
      throw new TechneError('controller instance output is missing')
    }
    announce(`Opening a private interactive bootstrap session on ${status.instanceId}.`)
    announce('Credential values are read by the remote process and are not sent as command parameters.')
    await client.startBootstrap(status.instanceId)
  }
}

function settings(profile: string, region: string, account: string): AwsSettings {
  return { profile, region, account, environment: { AWS_PROFILE: profile, AWS_REGION: region } }
}

export const awsProvider: Provider = {
  name: NAME,
  options: OPTIONS,
  bindingFields: BINDING_FIELDS,
  controllerFields: CONTROLLER_FIELDS,

  identities(binding: HostBinding): readonly string[] {
    const value = (field: string): string => binding.values[`${NAME}.${field}`] ?? '?'
    const place = `in ${value('account')}/${value('region')}`
    return (['tag', 'stack_name', 'parameter_prefix'] as const).flatMap((field) => {
      const resolved = binding.values[`${NAME}.${field}`]
      return resolved === undefined ? [] : [`AWS ${field.replace('_', ' ')} ${resolved} ${place}`]
    })
  },

  host(binding: HostBinding, context: ProviderContext): AwsHost {
    const section = binding.recipe.provider[NAME] as NonNullable<(typeof binding.recipe.provider)[string]>
    const value = (field: string): string | null => binding.values[`${NAME}.${field}`] ?? null
    const options = context.options
    const profile =
      options['profile'] ??
      value('admin_profile') ??
      ambient(context, 'AWS_PROFILE') ??
      refuse(
        `AWS profile for host ${binding.name}`,
        `--aws-profile, aws.admin_profile in ${binding.file} or AWS_PROFILE`
      )
    const region =
      options['region'] ??
      value('region') ??
      ambient(context, 'AWS_REGION') ??
      refuse(`AWS region for host ${binding.name}`, `--aws-region, aws.region in ${binding.file} or AWS_REGION`)
    const account =
      options['account'] ??
      value('account') ??
      refuse(`AWS account for host ${binding.name}`, `--aws-account or aws.account in ${binding.file}`)
    const operatorProfile =
      options['operator-profile'] ??
      value('operator_profile') ??
      refuse(
        `AWS operator profile for host ${binding.name}`,
        `--aws-operator-profile or aws.operator_profile in ${binding.file}`
      )
    const values: Record<string, string> = {
      ...binding.values,
      [`${NAME}.account`]: account,
      [`${NAME}.region`]: region,
      [`${NAME}.admin_profile`]: profile,
      [`${NAME}.operator_profile`]: operatorProfile
    }
    // Selectors are recipe templates over the resolved values.
    const selector = (key: string): string | null => {
      const template = section.selectors[key]
      return template === undefined ? null : derive(template, values)
    }
    const required = (key: string): string =>
      selector(key) ??
      refuse(
        `AWS selector ${key} for host ${binding.name}`,
        `providers.aws.selectors.${key} in recipe ${binding.recipe.name} and the values it names in ${binding.file}`
      )
    const resolved = settings(profile, region, account)
    return new AwsHost(
      context.runner,
      {
        ...resolved,
        operatorProfile,
        operatorRole: required('operator_role'),
        tagKey: required('tag_key'),
        tagValue: required('tag_value'),
        nameTag: selector('name_tag')
      },
      values
    )
  },

  controller(target: ControllerTarget, context: ProviderContext): ControllerAdapter {
    const where = `config.toml [controller.${NAME}]`
    const value = (field: string): string | null => {
      if (target.table[field] === undefined) return null
      const text = scalarText(target.table[field])
      if (text === null || text === '') throw new TechneError(`${where}: ${field} must be a non-empty value`)
      return text
    }
    const options = context.options
    const profile =
      options['profile'] ??
      value('profile') ??
      ambient(context, 'AWS_PROFILE') ??
      refuse('AWS profile for the controller', `--aws-profile, controller.aws.profile in config.toml or AWS_PROFILE`)
    const region =
      options['region'] ??
      value('region') ??
      ambient(context, 'AWS_REGION') ??
      refuse('AWS region for the controller', `--aws-region, controller.aws.region in config.toml or AWS_REGION`)
    const account =
      options['account'] ??
      value('account') ??
      refuse('AWS account for the controller', '--aws-account or controller.aws.account in config.toml')
    const stack =
      options['controller-stack'] ??
      value('stack') ??
      refuse('controller stack', '--aws-controller-stack or controller.aws.stack in config.toml')
    return new AwsController(context.runner, settings(profile, region, account), stack)
  }
}
