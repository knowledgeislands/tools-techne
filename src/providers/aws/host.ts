import { TechneError } from '../../errors.ts'
import { type CommandResult, type CommandRunner, failureMessage } from '../../process.ts'
import type { HostAdapter, HostInstance, HostReport } from '../provider.ts'
import { AwsClient, type AwsSettings } from './client.ts'

const NON_TERMINATED_STATES = 'pending,running,stopping,stopped'

// What the recipe's AWS selectors and the binding resolve to for one host.
export interface AwsHostSettings extends AwsSettings {
  operatorProfile: string
  operatorRole: string
  tagKey: string
  tagValue: string
  // The Name tag an instance must carry, when the recipe selects on it.
  nameTag: string | null
}

function parseHosts(value: string): HostInstance[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new TechneError(`agent host lookup response is invalid: ${String(error)}`)
  }
  if (!Array.isArray(parsed)) {
    throw new TechneError('agent host lookup response is not a list')
  }
  return parsed.map((row: unknown) => {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      typeof row[0] !== 'string' ||
      !row[0].startsWith('i-') ||
      typeof row[1] !== 'string'
    ) {
      throw new TechneError('agent host lookup returned an unexpected instance')
    }
    return { instanceId: row[0], state: row[1] }
  })
}

export class AwsHost implements HostAdapter {
  readonly values: Readonly<Record<string, string>>
  private readonly settings: AwsHostSettings
  private readonly operator: AwsClient

  constructor(runner: CommandRunner, settings: AwsHostSettings, values: Readonly<Record<string, string>>) {
    this.settings = settings
    this.values = values
    this.operator = new AwsClient(runner, { ...settings, profile: settings.operatorProfile })
  }

  get environment(): Readonly<Record<string, string>> {
    return this.settings.environment
  }

  private get selector(): string {
    const name = this.settings.nameTag === null ? '' : `, Name=${this.settings.nameTag}`
    return `${this.settings.tagKey}=${this.settings.tagValue}${name}`
  }

  async verifyOperator(): Promise<void> {
    const identity = await this.operator.identity()
    const role = this.settings.operatorRole
    if (!identity.arn.startsWith(`arn:aws:sts::${identity.account}:assumed-role/${role}/`)) {
      throw new TechneError(`refusing credentials that are not the ${role} role in the expected account`)
    }
  }

  async find(): Promise<HostInstance | null> {
    await this.verifyOperator()
    const result = await this.ec2([
      'describe-instances',
      '--filters',
      `Name=tag:${this.settings.tagKey},Values=${this.settings.tagValue}`,
      ...(this.settings.nameTag === null ? [] : [`Name=tag:Name,Values=${this.settings.nameTag}`]),
      `Name=instance-state-name,Values=${NON_TERMINATED_STATES}`,
      '--query',
      'Reservations[].Instances[].[InstanceId,State.Name]',
      '--output',
      'json'
    ])
    if (result.exitCode !== 0) {
      throw new TechneError(failureMessage('agent host lookup failed', result))
    }
    const hosts = parseHosts(result.stdout)
    if (hosts.length > 1) {
      throw new TechneError(
        `refusing: more than one instance tagged ${this.selector}: ${hosts.map((host) => host.instanceId).join(', ')}`
      )
    }
    if (hosts[0] === undefined) return null
    return hosts[0]
  }

  async status(): Promise<HostReport> {
    const host = await this.find()
    return {
      exists: host !== null,
      instanceId: host?.instanceId ?? null,
      state: host?.state ?? 'absent',
      details: { region: this.settings.region, selector: this.selector }
    }
  }

  async start(instanceId: string): Promise<void> {
    await this.mutate(['start-instances', '--instance-ids', instanceId], 'agent host start failed')
    await this.mutate(['wait', 'instance-running', '--instance-ids', instanceId], 'agent host did not reach running')
  }

  async stop(instanceId: string): Promise<void> {
    await this.mutate(['stop-instances', '--instance-ids', instanceId], 'agent host stop failed')
  }

  async terminate(instanceId: string): Promise<void> {
    await this.mutate(['terminate-instances', '--instance-ids', instanceId], 'agent host teardown failed')
  }

  private async mutate(args: readonly string[], summary: string): Promise<void> {
    const result = await this.ec2(args)
    if (result.exitCode !== 0) {
      throw new TechneError(failureMessage(summary, result))
    }
  }

  private async ec2(args: readonly string[]): Promise<CommandResult> {
    return await this.operator.run([
      'ec2',
      ...args,
      '--profile',
      this.settings.operatorProfile,
      '--region',
      this.settings.region
    ])
  }
}
