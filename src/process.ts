import { spawn } from 'node:child_process'

export type RunMode = 'capture' | 'interactive'

export interface RunOptions {
  mode?: RunMode
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
