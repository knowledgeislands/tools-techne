import { TechneError } from './errors.ts'
import type { CommandRunner } from './process.ts'

const PING_ARGUMENTS = ['ping', '-c', '1', '--timeout=10s', '--until-direct=false']

export class TailscaleClient {
  private readonly runner: CommandRunner

  constructor(runner: CommandRunner) {
    this.runner = runner
  }

  async ensureReachable(host: string): Promise<void> {
    const status = await this.runner.run('tailscale', ['status'])
    if (status.exitCode !== 0) {
      throw new TechneError('Tailscale is not up on this machine; start it and log in')
    }
    // A pong relayed through DERP proves the host answers; without --until-direct=false,
    // `tailscale ping` exits non-zero until a direct path exists, as it often does not after a rebuild.
    const ping = await this.runner.run('tailscale', PING_ARGUMENTS.concat(host))
    if (ping.exitCode !== 0) {
      throw new TechneError(`${host} does not answer over Tailscale`)
    }
  }
}
