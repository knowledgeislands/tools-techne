import { TechneError } from '../../errors.ts'
import { type CommandResult, type CommandRunner, failureMessage } from '../../process.ts'
import type { ControllerStatus } from '../provider.ts'

const EXPIRED_SSO_MARKERS = [
  'unauthorizedssotoken',
  'error loading sso token',
  'sso session associated with this profile has expired',
  'sso session associated with this profile is invalid',
  'token has expired and refresh failed'
] as const

export class AwsAuthenticationExpiredError extends TechneError {
  constructor(profile: string) {
    super(`AWS session expired for profile ${profile}; run techne auth login`)
  }
}

export interface AwsIdentity {
  account: string
  arn: string
}

// The profile, region and account one AWS call uses, and the variables it runs with.
export interface AwsSettings {
  profile: string
  region: string
  account: string
  environment: Readonly<Record<string, string>>
}

function isExpiredSsoSession(result: CommandResult): boolean {
  const detail = `${result.stderr}\n${result.stdout}`.toLowerCase()
  return EXPIRED_SSO_MARKERS.some((marker) => detail.includes(marker))
}

export function parseObject(value: string, summary: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new TechneError(`${summary}: ${String(error)}`)
  }
}

function outputValue(stack: Record<string, unknown>, key: string): string | null {
  const outputs = stack['Outputs']
  if (!Array.isArray(outputs)) {
    return null
  }
  for (const output of outputs) {
    if (typeof output !== 'object' || output === null || Array.isArray(output)) {
      continue
    }
    const record = output as Record<string, unknown>
    if (record['OutputKey'] === key && typeof record['OutputValue'] === 'string') {
      return record['OutputValue']
    }
  }
  return null
}

export class AwsClient {
  private readonly runner: CommandRunner
  private readonly config: AwsSettings

  constructor(runner: CommandRunner, config: AwsSettings) {
    this.runner = runner
    this.config = config
  }

  async run(args: readonly string[], interactive = false): Promise<CommandResult> {
    return await this.runner.run('aws', args, {
      env: this.config.environment,
      ...(interactive ? { mode: 'interactive' as const } : {})
    })
  }

  async account(): Promise<string> {
    return (await this.identity()).account
  }

  async identity(): Promise<AwsIdentity> {
    const result = await this.run(['sts', 'get-caller-identity', '--profile', this.config.profile, '--output', 'json'])
    if (result.exitCode !== 0) {
      if (isExpiredSsoSession(result)) {
        throw new AwsAuthenticationExpiredError(this.config.profile)
      }
      throw new TechneError(failureMessage('AWS identity check failed', result))
    }
    const identity = parseObject(result.stdout, 'AWS identity response is invalid')
    if (typeof identity['Account'] !== 'string') {
      throw new TechneError('AWS identity response does not contain an account')
    }
    if (identity['Account'] !== this.config.account) {
      throw new TechneError(`refusing AWS account ${identity['Account']}; expected ${this.config.account}`)
    }
    return { account: identity['Account'], arn: typeof identity['Arn'] === 'string' ? identity['Arn'] : '' }
  }

  async login(): Promise<string> {
    const session = await this.run(['configure', 'get', 'sso_session', '--profile', this.config.profile])
    if (session.exitCode !== 0 || session.stdout.trim().length === 0) {
      throw new TechneError(`AWS profile ${this.config.profile} is not configured for IAM Identity Center`)
    }

    const result = await this.run(['sso', 'login', '--profile', this.config.profile], true)
    if (result.exitCode !== 0) {
      throw new TechneError(`AWS login failed for profile ${this.config.profile}`)
    }

    return await this.account()
  }

  async controllerStatus(stackName: string): Promise<ControllerStatus> {
    await this.account()
    const result = await this.run([
      'cloudformation',
      'describe-stacks',
      '--profile',
      this.config.profile,
      '--region',
      this.config.region,
      '--stack-name',
      stackName,
      '--output',
      'json'
    ])
    if (result.exitCode !== 0) {
      if (result.stderr.includes('does not exist')) {
        return {
          exists: false,
          stackName,
          stackStatus: null,
          instanceId: null
        }
      }
      throw new TechneError(failureMessage('controller status check failed', result))
    }

    const response = parseObject(result.stdout, 'CloudFormation response is invalid')
    if (!Array.isArray(response['Stacks']) || response['Stacks'].length !== 1) {
      throw new TechneError('CloudFormation response does not contain one controller stack')
    }
    const value = response['Stacks'][0]
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TechneError('CloudFormation controller stack is invalid')
    }
    const stack = value as Record<string, unknown>
    return {
      exists: true,
      stackName,
      stackStatus: typeof stack['StackStatus'] === 'string' ? stack['StackStatus'] : null,
      instanceId: outputValue(stack, 'ControllerInstanceId')
    }
  }

  async startBootstrap(instanceId: string): Promise<void> {
    const result = await this.run(
      [
        'ssm',
        'start-session',
        '--profile',
        this.config.profile,
        '--region',
        this.config.region,
        '--target',
        instanceId,
        '--document-name',
        'AWS-StartInteractiveCommand',
        '--parameters',
        'command=["sudo /opt/ki-techne-harness/deploy/runtime/controller/bootstrap.sh"]'
      ],
      true
    )
    if (result.exitCode !== 0) {
      throw new TechneError('interactive controller bootstrap session failed')
    }
  }
}
