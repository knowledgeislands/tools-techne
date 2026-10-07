import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { parseInvocation } from '../config.ts'
import { TechneError } from '../errors.ts'
import { BunCommandRunner, type CommandResult, type CommandRunner } from '../process.ts'
import { AwsClient, type AwsSettings } from '../providers/aws/client.ts'
import { AwsHost } from '../providers/aws/host.ts'
import { PROVIDERS } from '../providers/index.ts'
import { processRuntime } from '../runtime.ts'
import { TECHNE_VERSION } from '../version.ts'

const SETTINGS: AwsSettings = {
  profile: 'profile',
  region: 'region',
  account: '123456789012',
  environment: { AWS_PROFILE: 'profile', AWS_REGION: 'region' }
}

function result(stdout = '', stderr = '', exitCode = 0): CommandResult {
  return { exitCode, stdout, stderr }
}

class QueueRunner implements CommandRunner {
  private readonly responses: CommandResult[]

  constructor(responses: CommandResult[]) {
    this.responses = responses
  }

  async run(): Promise<CommandResult> {
    return this.responses.shift() ?? result()
  }
}

function aws(...responses: CommandResult[]): AwsClient {
  return new AwsClient(new QueueRunner(responses), SETTINGS)
}

function identity(account = SETTINGS.account): CommandResult {
  return result(JSON.stringify({ Account: account }))
}

function operator(): CommandResult {
  return result(
    JSON.stringify({ Account: SETTINGS.account, Arn: `arn:aws:sts::${SETTINGS.account}:assumed-role/role/s` })
  )
}

function stack(value: unknown): CommandResult {
  return result(JSON.stringify({ Stacks: [value] }))
}

describe('invocation parsing', () => {
  test('defaults the harness checkout and recognises short control flags', () => {
    expect(parseInvocation(['-h', '-V'], { HOME: '/home/k' }, PROVIDERS)).toMatchObject({
      help: true,
      version: true,
      json: false,
      command: [],
      harnessDir: '/home/k/workspaces/kit/knowledgeislands/ki-techne-harness',
      providerOptions: []
    })
    expect(parseInvocation([], {}, PROVIDERS).harnessDir).toBe('')
  })

  test('records provider options by provider, keeping the last of each flag', () => {
    const invocation = parseInvocation(
      ['host', 'status', '--aws-profile', 'a', '--aws-region', 'r', '--aws-profile', 'b', '--host', 'h'],
      { TECHNE_HARNESS_DIR: '/harness' },
      PROVIDERS
    )
    expect(invocation).toMatchObject({
      command: ['host', 'status'],
      harnessDir: '/harness',
      host: 'h',
      providerOptions: [
        { provider: 'aws', option: 'region', flag: '--aws-region', value: 'r' },
        { provider: 'aws', option: 'profile', flag: '--aws-profile', value: 'b' }
      ]
    })
  })

  test('rejects missing, option-shaped and unknown option values', () => {
    expect(() => parseInvocation(['--host'], {}, PROVIDERS)).toThrow('--host requires a value')
    expect(() => parseInvocation(['--aws-profile', '--json'], {}, PROVIDERS)).toThrow('--aws-profile requires a value')
    expect(() => parseInvocation(['--profile', 'p'], {}, PROVIDERS)).toThrow('unknown option: --profile')
  })
})

describe('AWS client', () => {
  test('returns the expected account and rejects identity failures', async () => {
    await expect(aws(identity()).account()).resolves.toBe(SETTINGS.account)
    await expect(aws(result('', 'denied', 1)).account()).rejects.toThrow('AWS identity check failed: denied')
    await expect(aws(result('failed', '', 1)).account()).rejects.toThrow('AWS identity check failed: failed')
    await expect(aws(result('', '', 1)).account()).rejects.toThrow('AWS identity check failed')
    await expect(aws(identity('999999999999')).account()).rejects.toThrow('refusing AWS account')
  })

  test('rejects malformed identity objects', async () => {
    await expect(aws(result('{')).account()).rejects.toThrow('AWS identity response is invalid')
    await expect(aws(result('null')).account()).rejects.toThrow('expected a JSON object')
    await expect(aws(result('[]')).account()).rejects.toThrow('expected a JSON object')
    await expect(aws(result('{}')).account()).rejects.toThrow('does not contain an account')
  })

  test('reports absent and failed controller stacks', async () => {
    await expect(aws(identity(), result('', 'Stack does not exist', 255)).controllerStatus('c')).resolves.toMatchObject(
      {
        exists: false,
        instanceId: null
      }
    )
    await expect(aws(identity(), result('', 'access denied', 1)).controllerStatus('c')).rejects.toThrow(
      'controller status check failed: access denied'
    )
  })

  test('rejects malformed controller stack collections and values', async () => {
    await expect(aws(identity(), result('{}')).controllerStatus('c')).rejects.toThrow('does not contain one')
    await expect(aws(identity(), result('{"Stacks":[]}')).controllerStatus('c')).rejects.toThrow('does not contain one')
    await expect(aws(identity(), result('{"Stacks":[{},{}]}')).controllerStatus('c')).rejects.toThrow(
      'does not contain one'
    )
    await expect(aws(identity(), stack(null)).controllerStatus('c')).rejects.toThrow('stack is invalid')
    await expect(aws(identity(), stack([])).controllerStatus('c')).rejects.toThrow('stack is invalid')
    await expect(aws(identity(), stack('invalid')).controllerStatus('c')).rejects.toThrow('stack is invalid')
  })

  test('normalises optional stack outputs', async () => {
    await expect(aws(identity(), stack({})).controllerStatus('c')).resolves.toMatchObject({
      stackStatus: null,
      instanceId: null
    })
    await expect(
      aws(
        identity(),
        stack({
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [
            null,
            [],
            'invalid',
            { OutputKey: 'Other', OutputValue: 'ignored' },
            { OutputKey: 'ControllerInstanceId', OutputValue: 42 }
          ]
        })
      ).controllerStatus('c')
    ).resolves.toMatchObject({ stackStatus: 'CREATE_COMPLETE', instanceId: null })
    await expect(
      aws(
        identity(),
        stack({
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [{ OutputKey: 'ControllerInstanceId', OutputValue: 'i-123' }]
        })
      ).controllerStatus('c')
    ).resolves.toMatchObject({ instanceId: 'i-123' })
  })

  test('reports an interactive bootstrap failure', async () => {
    await expect(aws(result('', '', 1)).startBootstrap('i-123')).rejects.toThrow('interactive controller bootstrap')
  })
})

function host(...responses: CommandResult[]): AwsHost {
  return new AwsHost(
    new QueueRunner(responses),
    { ...SETTINGS, operatorProfile: 'operator', operatorRole: 'role', tagKey: 'k', tagValue: 'v', nameTag: null },
    {}
  )
}

describe('AWS host adapter', () => {
  test('refuses an identity without an operator role ARN', async () => {
    await expect(host(identity()).verifyOperator()).rejects.toThrow('refusing credentials')
  })

  test('rejects failed and malformed instance lookups', async () => {
    await expect(host(operator(), result('', 'denied', 1)).find()).rejects.toThrow('agent host lookup failed: denied')
    await expect(host(operator(), result('{')).find()).rejects.toThrow('agent host lookup response is invalid')
    await expect(host(operator(), result('{}')).find()).rejects.toThrow('agent host lookup response is not a list')
    for (const row of [null, ['i-1'], ['x-1', 'running'], [1, 'running'], ['i-1', 2]]) {
      await expect(host(operator(), result(JSON.stringify([row]))).find()).rejects.toThrow('unexpected instance')
    }
  })

  test('reports failed instance changes', async () => {
    await expect(host(result('', 'denied', 1)).start('i-1')).rejects.toThrow('agent host start failed: denied')
    await expect(host(result(), result('', 'timed out', 255)).start('i-1')).rejects.toThrow(
      'agent host did not reach running: timed out'
    )
    await expect(host(result('', '', 1)).stop('i-1')).rejects.toThrow('agent host stop failed')
    await expect(host(result('', '', 1)).terminate('i-1')).rejects.toThrow('agent host teardown failed')
  })
})

describe('runtime adapters', () => {
  test('does not mistake an unverified source path for a checkout and identifies bundled execution', () => {
    const local = processRuntime('file:///tmp/techne/main.ts')
    expect(local).toMatchObject({
      version: TECHNE_VERSION,
      installation: 'unknown',
      executable: '/tmp/techne/main.ts',
      bunVersion: process.versions.bun ?? 'unavailable'
    })
    expect(processRuntime('file:///$bunfs/root/main.js')).toMatchObject({
      installation: 'release',
      executable: process.execPath
    })
  })

  test('captures subprocess output and launch failures', async () => {
    const runner = new BunCommandRunner()
    await expect(runner.run('bun', ['-e', 'console.log("out"); console.error("err")'])).resolves.toMatchObject({
      exitCode: 0,
      stdout: 'out\n',
      stderr: 'err\n'
    })
    await expect(runner.run(process.execPath, ['-e', ''], { mode: 'interactive' })).resolves.toMatchObject({
      exitCode: 0,
      stdout: '',
      stderr: ''
    })
    const directory = realpathSync(mkdtempSync(`${tmpdir()}/techne-cwd-`))
    await expect(runner.run('pwd', [], { cwd: directory })).resolves.toMatchObject({ stdout: `${directory}\n` })
    await expect(runner.run('__missing_techne_command__', [])).resolves.toMatchObject({ exitCode: 127 })
    await expect(runner.run(process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')"])).resolves.toMatchObject({
      exitCode: 1
    })
  })

  test('constructs the domain error with default and explicit exit codes', () => {
    expect(new TechneError('default')).toMatchObject({ name: 'TechneError', message: 'default', exitCode: 1 })
    expect(new TechneError('usage', 2)).toMatchObject({ exitCode: 2 })
  })
})
