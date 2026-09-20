import { AwsAuthenticationExpiredError, AwsClient } from './aws.ts'
import type { TechneConfig } from './config.ts'
import type { CommandRunner } from './process.ts'

export type AuthSurfaceStatus = 'already-authenticated' | 'authenticated' | 'failed'
export type AuthSurfaceSuccessStatus = Exclude<AuthSurfaceStatus, 'failed'>

export interface AuthSurfaceResult {
  surface: string
  status: AuthSurfaceStatus
  ok: boolean
  detail: string
}

export interface AuthSurface {
  readonly name: string
  login(): Promise<{ status: AuthSurfaceSuccessStatus; detail: string }>
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class AwsAuthSurface implements AuthSurface {
  readonly name = 'aws'
  private readonly runner: CommandRunner
  private readonly client: AwsClient

  constructor(runner: CommandRunner, config: TechneConfig) {
    this.runner = runner
    this.client = new AwsClient(runner, config)
  }

  async login(): Promise<{ status: AuthSurfaceSuccessStatus; detail: string }> {
    const version = await this.runner.run('aws', ['--version'])
    if (version.exitCode !== 0) {
      throw new Error('AWS CLI is unavailable')
    }

    try {
      const account = await this.client.account()
      return { status: 'already-authenticated', detail: `account ${account}` }
    } catch (error) {
      if (!(error instanceof AwsAuthenticationExpiredError)) {
        throw error
      }
    }

    const account = await this.client.login()
    return { status: 'authenticated', detail: `account ${account}` }
  }
}

export function configuredAuthSurfaces(runner: CommandRunner, config: TechneConfig): readonly AuthSurface[] {
  return [new AwsAuthSurface(runner, config)]
}

export async function loginAuthSurfaces(surfaces: readonly AuthSurface[]): Promise<readonly AuthSurfaceResult[]> {
  const results: AuthSurfaceResult[] = []

  for (const surface of surfaces) {
    try {
      const result = await surface.login()
      results.push({ surface: surface.name, ok: true, ...result })
    } catch (error) {
      results.push({ surface: surface.name, status: 'failed', ok: false, detail: errorDetail(error) })
    }
  }

  return results
}

export async function loginConfiguredAuth(
  runner: CommandRunner,
  config: TechneConfig
): Promise<readonly AuthSurfaceResult[]> {
  return await loginAuthSurfaces(configuredAuthSurfaces(runner, config))
}
