import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { failureMessage } from './aws.ts'
import { TechneError } from './errors.ts'
import type { CommandRunner } from './process.ts'

const AGENT_HOST_SCRIPTS = 'operations/aws/agent-host'
export const HARNESS_SETTING = '--harness-dir or TECHNE_HARNESS_DIR'

export type HarnessScript = 'setup.sh' | 'status.sh'

export type WorkspaceState = 'reported' | 'skipped' | 'failed'

export interface WorkspaceStatus {
  state: WorkspaceState
  report: string | null
  detail: string | null
}

// Runs the agent-host scripts in place from a local ki-techne-harness checkout,
// which stays their only copy (ADR-TECHNE-003).
export class HarnessCheckout {
  private readonly runner: CommandRunner
  private readonly directory: string

  constructor(runner: CommandRunner, directory: string) {
    this.runner = runner
    this.directory = directory
  }

  script(name: HarnessScript): string {
    if (this.directory === '') {
      throw new TechneError(`no ki-techne-harness checkout is configured; set ${HARNESS_SETTING}`)
    }
    if (!existsSync(this.directory)) {
      throw new TechneError(
        `ki-techne-harness checkout not found at ${this.directory}; clone it or set ${HARNESS_SETTING}`
      )
    }
    const path = join(this.directory, AGENT_HOST_SCRIPTS, name)
    if (!existsSync(path)) {
      throw new TechneError(
        `${this.directory} has no ${AGENT_HOST_SCRIPTS}/${name}; update the ki-techne-harness checkout`
      )
    }
    return path
  }

  async setup(script: string, args: readonly string[]): Promise<void> {
    const result = await this.runner.run('bash', [script, ...args], { mode: 'interactive' })
    if (result.exitCode !== 0) {
      throw new TechneError(`harness setup failed with exit status ${result.exitCode}`)
    }
  }

  async workspaceStatus(): Promise<WorkspaceStatus> {
    let script: string
    try {
      script = this.script('status.sh')
    } catch (error) {
      return { state: 'failed', report: null, detail: (error as TechneError).message }
    }
    const result = await this.runner.run('bash', [script])
    if (result.exitCode !== 0) {
      return { state: 'failed', report: null, detail: failureMessage('harness status.sh failed', result) }
    }
    return { state: 'reported', report: result.stdout, detail: null }
  }
}
