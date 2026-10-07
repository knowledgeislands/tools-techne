#!/usr/bin/env bun

import { createInterface } from 'node:readline/promises'
import { runCli } from './cli.ts'
import { BunCommandRunner } from './process.ts'
import { processRuntime } from './runtime.ts'

const exitCode = await runCli(process.argv.slice(2), {
  runner: new BunCommandRunner(),
  environment: process.env,
  runtime: processRuntime(import.meta.url),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  io: {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    readLine: async (prompt) => {
      const reader = createInterface({ input: process.stdin, output: process.stderr })
      try {
        return await reader.question(prompt)
      } finally {
        reader.close()
      }
    }
  }
})

process.exitCode = exitCode
