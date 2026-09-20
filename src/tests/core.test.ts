import { describe, expect, test } from 'vitest'
import { AwsClient } from '../aws.ts'
import { parseInvocation, type TechneConfig } from '../config.ts'
import { TechneError } from '../errors.ts'
import { BunCommandRunner, type CommandResult, type CommandRunner } from '../process.ts'
import { processRuntime } from '../runtime.ts'
import { TECHNE_VERSION } from '../version.ts'

const CONFIG: TechneConfig = {
  profile: 'profile',
  region: 'region',
  expectedAccount: '123456789012',
  controllerStack: 'controller'
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
  return new AwsClient(new QueueRunner(responses), CONFIG)
}

function identity(account = CONFIG.expectedAccount): CommandResult {
  return result(JSON.stringify({ Account: account }))
}

function stack(value: unknown): CommandResult {
  return result(JSON.stringify({ Stacks: [value] }))
}

describe('invocation parsing', () => {
  test('uses defaults and recognises short control flags', () => {
    const invocation = parseInvocation(['-h', '-V'], {})
    expect(invocation).toMatchObject({
      help: true,
      version: true,
      json: false,
      command: [],
      config: {
        profile: 'knowledge-islands-techne',
        region: 'eu-west-1',
        expectedAccount: '655383751458',
        controllerStack: 'ki-techne-ops-007-controller'
      }
    })
  })

  test('applies environment then flag precedence for every value option', () => {
    const invocation = parseInvocation(
      [
        'controller',
        'status',
        '--json',
        '--profile',
        'flag-profile',
        '--region',
        'flag-region',
        '--account',
        '222222222222',
        '--controller-stack',
        'flag-stack'
      ],
      {
        AWS_PROFILE: 'env-profile',
        AWS_REGION: 'env-region',
        EXPECTED_AWS_ACCOUNT: '111111111111',
        CONTROLLER_STACK_NAME: 'env-stack'
      }
    )
    expect(invocation).toMatchObject({
      command: ['controller', 'status'],
      json: true,
      config: {
        profile: 'flag-profile',
        region: 'flag-region',
        expectedAccount: '222222222222',
        controllerStack: 'flag-stack'
      }
    })
  })

  test('rejects missing, option-shaped and unknown option values', () => {
    expect(() => parseInvocation(['--profile'], {})).toThrow('--profile requires a value')
    expect(() => parseInvocation(['--profile', '--json'], {})).toThrow('--profile requires a value')
    expect(() => parseInvocation(['--unknown'], {})).toThrow('unknown option')
  })
})

describe('AWS client', () => {
  test('returns the expected account and rejects identity failures', async () => {
    await expect(aws(identity()).account()).resolves.toBe(CONFIG.expectedAccount)
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
    await expect(aws(identity(), result('', 'Stack does not exist', 255)).controllerStatus()).resolves.toMatchObject({
      exists: false,
      instanceId: null
    })
    await expect(aws(identity(), result('', 'access denied', 1)).controllerStatus()).rejects.toThrow(
      'controller status check failed: access denied'
    )
  })

  test('rejects malformed controller stack collections and values', async () => {
    await expect(aws(identity(), result('{}')).controllerStatus()).rejects.toThrow('does not contain one')
    await expect(aws(identity(), result('{"Stacks":[]}')).controllerStatus()).rejects.toThrow('does not contain one')
    await expect(aws(identity(), result('{"Stacks":[{},{}]}')).controllerStatus()).rejects.toThrow(
      'does not contain one'
    )
    await expect(aws(identity(), stack(null)).controllerStatus()).rejects.toThrow('stack is invalid')
    await expect(aws(identity(), stack([])).controllerStatus()).rejects.toThrow('stack is invalid')
    await expect(aws(identity(), stack('invalid')).controllerStatus()).rejects.toThrow('stack is invalid')
  })

  test('normalises optional stack outputs', async () => {
    await expect(aws(identity(), stack({})).controllerStatus()).resolves.toMatchObject({
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
      ).controllerStatus()
    ).resolves.toMatchObject({ stackStatus: 'CREATE_COMPLETE', instanceId: null })
    await expect(
      aws(
        identity(),
        stack({
          StackStatus: 'CREATE_COMPLETE',
          Outputs: [{ OutputKey: 'ControllerInstanceId', OutputValue: 'i-123' }]
        })
      ).controllerStatus()
    ).resolves.toMatchObject({ instanceId: 'i-123' })
  })

  test('reports an interactive bootstrap failure', async () => {
    await expect(aws(result('', '', 1)).startBootstrap('i-123')).rejects.toThrow('interactive controller bootstrap')
  })
})

describe('runtime adapters', () => {
  test('reports local and bundled execution provenance', () => {
    const local = processRuntime('file:///tmp/techne/main.ts')
    expect(local).toMatchObject({
      version: TECHNE_VERSION,
      installation: 'local',
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
