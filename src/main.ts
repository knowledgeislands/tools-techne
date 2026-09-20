#!/usr/bin/env bun

import { runCli } from './cli.ts'
import { BunCommandRunner } from './process.ts'
import { processRuntime } from './runtime.ts'

const exitCode = await runCli(process.argv.slice(2), {
  runner: new BunCommandRunner(),
  environment: process.env,
  runtime: processRuntime(import.meta.url),
  io: {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value)
  }
})

process.exitCode = exitCode
