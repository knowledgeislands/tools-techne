import { describe, expect, test } from 'vitest'
import { type AuthSurface, configuredAuthSurfaces, loginAuthSurfaces, loginConfiguredAuth } from '../auth.ts'
import type { TechneConfig } from '../config.ts'
import type { CommandCall, CommandResult, CommandRunner, RunOptions } from '../process.ts'

const CONFIG: TechneConfig = {
  profile: 'profile',
  region: 'region',
  expectedAccount: '123456789012',
  controllerStack: 'controller',
  hostProfile: 'host-profile'
}

function result(stdout = '', stderr = '', exitCode = 0): CommandResult {
  return { exitCode, stdout, stderr }
}

function identity(account = CONFIG.expectedAccount): CommandResult {
  return result(JSON.stringify({ Account: account }))
}

class QueueRunner implements CommandRunner {
  readonly calls: CommandCall[] = []
  private readonly responses: CommandResult[]

  constructor(responses: CommandResult[]) {
    this.responses = responses
  }

  async run(command: string, args: readonly string[], options: RunOptions = {}): Promise<CommandResult> {
    this.calls.push({ command, args: [...args], mode: options.mode ?? 'capture' })
    return this.responses.shift() ?? result()
  }
}

const expired = result(
  '',
  'The SSO session associated with this profile has expired. To refresh this SSO session run aws sso login.',
  1
)

describe('configured authentication', () => {
  test('derives the current AWS surface from Techne configuration', () => {
    expect(configuredAuthSurfaces(new QueueRunner([]), CONFIG).map((surface) => surface.name)).toEqual(['aws'])
  })

  test('skips login when the configured identity is already valid', async () => {
    const runner = new QueueRunner([result('', 'aws-cli/2.36.49'), identity()])

    await expect(loginConfiguredAuth(runner, CONFIG)).resolves.toEqual([
      { surface: 'aws', status: 'already-authenticated', ok: true, detail: `account ${CONFIG.expectedAccount}` }
    ])
    expect(runner.calls).toHaveLength(2)
  })

  test('recovers an expired SSO session and revalidates the account', async () => {
    const runner = new QueueRunner([
      result('', 'aws-cli/2.36.49'),
      expired,
      result('humansnotrobots\n'),
      result(),
      identity()
    ])

    await expect(loginConfiguredAuth(runner, CONFIG)).resolves.toEqual([
      { surface: 'aws', status: 'authenticated', ok: true, detail: `account ${CONFIG.expectedAccount}` }
    ])
    expect(runner.calls[3]).toMatchObject({
      command: 'aws',
      args: ['sso', 'login', '--profile', CONFIG.profile],
      mode: 'interactive'
    })
  })

  test('does not convert generic provider errors into login attempts', async () => {
    const runner = new QueueRunner([result('', 'aws-cli/2.36.49'), result('', 'AccessDenied', 1)])

    await expect(loginConfiguredAuth(runner, CONFIG)).resolves.toEqual([
      {
        surface: 'aws',
        status: 'failed',
        ok: false,
        detail: 'AWS identity check failed: AccessDenied'
      }
    ])
    expect(runner.calls).toHaveLength(2)
  })

  test('reports missing clients, unsupported profiles and failed logins', async () => {
    const missing = new QueueRunner([result('', '', 127)])
    await expect(loginConfiguredAuth(missing, CONFIG)).resolves.toMatchObject([
      { surface: 'aws', status: 'failed', detail: 'AWS CLI is unavailable' }
    ])

    const unsupported = new QueueRunner([result('', 'aws-cli/2.36.49'), expired, result('', '', 1)])
    await expect(loginConfiguredAuth(unsupported, CONFIG)).resolves.toMatchObject([
      {
        surface: 'aws',
        status: 'failed',
        detail: `AWS profile ${CONFIG.profile} is not configured for IAM Identity Center`
      }
    ])

    const failed = new QueueRunner([result('', 'aws-cli/2.36.49'), expired, result('session\n'), result('', '', 1)])
    await expect(loginConfiguredAuth(failed, CONFIG)).resolves.toMatchObject([
      { surface: 'aws', status: 'failed', detail: `AWS login failed for profile ${CONFIG.profile}` }
    ])
  })

  test('refuses the wrong account after login and retries identity only once', async () => {
    const runner = new QueueRunner([
      result('', 'aws-cli/2.36.49'),
      expired,
      result('session\n'),
      result(),
      identity('999999999999')
    ])

    await expect(loginConfiguredAuth(runner, CONFIG)).resolves.toMatchObject([
      { surface: 'aws', status: 'failed', detail: 'refusing AWS account 999999999999; expected 123456789012' }
    ])
    expect(runner.calls.filter((call) => call.args.includes('get-caller-identity'))).toHaveLength(2)
  })

  test('retains ordered partial results without stopping later surfaces', async () => {
    const surfaces: AuthSurface[] = [
      {
        name: 'first',
        async login() {
          throw new Error('expired')
        }
      },
      {
        name: 'second',
        async login() {
          return { status: 'authenticated', detail: 'account safe' }
        }
      },
      {
        name: 'third',
        async login() {
          throw 'unavailable'
        }
      }
    ]

    await expect(loginAuthSurfaces(surfaces)).resolves.toEqual([
      { surface: 'first', status: 'failed', ok: false, detail: 'expired' },
      { surface: 'second', status: 'authenticated', ok: true, detail: 'account safe' },
      { surface: 'third', status: 'failed', ok: false, detail: 'unavailable' }
    ])
  })
})
