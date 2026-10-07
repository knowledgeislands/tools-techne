import { AwsClient, failureMessage } from './aws.ts'
import type { TechneConfig } from './config.ts'
import { TechneError } from './errors.ts'
import type { CommandResult, CommandRunner } from './process.ts'

const TAG_KEY = 'ki-agent-host-id'
const TAG_VALUE = 'agent-host'
export const AGENT_HOST_SELECTOR = `${TAG_KEY}=${TAG_VALUE}`
export const AGENT_HOST_NAME = 'ki-techne-agent-host'

const OPERATOR_ROLE = 'ki-techne-agent-host-operator'
const NON_TERMINATED_STATES = 'pending,running,stopping,stopped'

export interface AgentHost {
  instanceId: string
  state: string
}

export interface AgentHostStatus {
  exists: boolean
  instanceId: string | null
  state: string
  region: string
  selector: string
}

function parseHosts(value: string): AgentHost[] {
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

export class AgentHostClient {
  private readonly runner: CommandRunner
  private readonly config: TechneConfig

  constructor(runner: CommandRunner, config: TechneConfig) {
    this.runner = runner
    this.config = config
  }

  async verifyOperator(): Promise<void> {
    const identity = await new AwsClient(this.runner, { ...this.config, profile: this.config.hostProfile }).identity()
    if (!identity.arn.startsWith(`arn:aws:sts::${identity.account}:assumed-role/${OPERATOR_ROLE}/`)) {
      throw new TechneError(`refusing credentials that are not the ${OPERATOR_ROLE} role in the expected account`)
    }
  }

  async find(): Promise<AgentHost | null> {
    const result = await this.ec2([
      'describe-instances',
      '--filters',
      `Name=tag:${TAG_KEY},Values=${TAG_VALUE}`,
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
        `refusing: more than one instance tagged ${AGENT_HOST_SELECTOR}: ${hosts.map((host) => host.instanceId).join(', ')}`
      )
    }
    return hosts[0] ?? null
  }

  async status(): Promise<AgentHostStatus> {
    await this.verifyOperator()
    const host = await this.find()
    return {
      exists: host !== null,
      instanceId: host?.instanceId ?? null,
      state: host?.state ?? 'absent',
      region: this.config.region,
      selector: AGENT_HOST_SELECTOR
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
    return await this.runner.run('aws', [
      'ec2',
      ...args,
      '--profile',
      this.config.hostProfile,
      '--region',
      this.config.region
    ])
  }
}
