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
