import { spawn } from 'node:child_process'

export type RunMode = 'capture' | 'interactive'

export interface RunOptions {
  mode?: RunMode
  // Variables added to the inherited environment, as the harness script contract requires.
  env?: Readonly<Record<string, string>>
  // Working directory; recipe paths in values are relative to the harness checkout.
  cwd?: string
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface CommandCall {
  command: string
  args: readonly string[]
  mode: RunMode
  env?: Readonly<Record<string, string>>
  cwd?: string
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options?: RunOptions): Promise<CommandResult>
}

function commandError(error: unknown): CommandResult {
  return { exitCode: 127, stdout: '', stderr: String(error) }
}

export class BunCommandRunner implements CommandRunner {
  async run(command: string, args: readonly string[], options: RunOptions = {}): Promise<CommandResult> {
    const mode = options.mode ?? 'capture'

    return await new Promise((resolve) => {
      const child = spawn(command, [...args], {
        env: { ...process.env, ...options.env },
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        stdio: mode === 'interactive' ? 'inherit' : ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''

      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.once('error', (error) => resolve(commandError(error)))
      child.once('close', (exitCode) => {
        resolve({ exitCode: exitCode ?? 1, stdout, stderr })
      })
    })
  }
}

export function failureMessage(summary: string, result: CommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim()
  return detail.length > 0 ? `${summary}: ${detail}` : summary
}
