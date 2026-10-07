import { TechneError } from './errors.ts'
import type { CommandRunner } from './process.ts'

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
    const ping = await this.runner.run('tailscale', ['ping', '-c', '1', '--timeout=10s', host])
    if (ping.exitCode !== 0) {
      throw new TechneError(`${host} does not answer over Tailscale`)
    }
  }
}
