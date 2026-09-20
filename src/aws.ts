import type { TechneConfig } from './config.ts'
import { TechneError } from './errors.ts'
import type { CommandResult, CommandRunner } from './process.ts'

export interface ControllerStatus {
  exists: boolean
  stackName: string
  stackStatus: string | null
  instanceId: string | null
}

function failureMessage(summary: string, result: CommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim()
  return detail.length > 0 ? `${summary}: ${detail}` : summary
}

function parseObject(value: string, summary: string): Record<string, unknown> {
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
  private readonly config: TechneConfig

  constructor(runner: CommandRunner, config: TechneConfig) {
    this.runner = runner
    this.config = config
  }

  async account(): Promise<string> {
    const result = await this.runner.run('aws', [
      'sts',
      'get-caller-identity',
      '--profile',
      this.config.profile,
      '--output',
      'json'
    ])
    if (result.exitCode !== 0) {
      throw new TechneError(failureMessage('AWS identity check failed', result))
    }
    const identity = parseObject(result.stdout, 'AWS identity response is invalid')
    if (typeof identity['Account'] !== 'string') {
      throw new TechneError('AWS identity response does not contain an account')
    }
    if (identity['Account'] !== this.config.expectedAccount) {
      throw new TechneError(`refusing AWS account ${identity['Account']}; expected ${this.config.expectedAccount}`)
    }
    return identity['Account']
  }

  async controllerStatus(): Promise<ControllerStatus> {
    await this.account()
    const result = await this.runner.run('aws', [
      'cloudformation',
      'describe-stacks',
      '--profile',
      this.config.profile,
      '--region',
      this.config.region,
      '--stack-name',
      this.config.controllerStack,
      '--output',
      'json'
    ])
    if (result.exitCode !== 0) {
      if (result.stderr.includes('does not exist')) {
        return {
          exists: false,
          stackName: this.config.controllerStack,
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
      stackName: this.config.controllerStack,
      stackStatus: typeof stack['StackStatus'] === 'string' ? stack['StackStatus'] : null,
      instanceId: outputValue(stack, 'ControllerInstanceId')
    }
  }

  async startBootstrap(instanceId: string): Promise<void> {
    const result = await this.runner.run(
      'aws',
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
      { mode: 'interactive' }
    )
    if (result.exitCode !== 0) {
      throw new TechneError('interactive controller bootstrap session failed')
    }
  }
}
