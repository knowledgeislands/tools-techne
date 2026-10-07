import { describe, expect, test } from 'vitest'
import { type AuthSurface, loginAuthSurfaces } from '../auth.ts'

describe('authentication surfaces', () => {
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
