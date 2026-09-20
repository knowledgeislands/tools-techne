import { fileURLToPath } from 'node:url'
import { TECHNE_VERSION } from './version.ts'

export type InstallationMode = 'local' | 'release'

export interface TechneRuntime {
  version: string
  installation: InstallationMode
  executable: string
  workingDirectory: string
  bunVersion: string
}

export function processRuntime(metaUrl: string): TechneRuntime {
  const bundled = metaUrl.startsWith('file:///$bunfs/')
  return {
    version: TECHNE_VERSION,
    installation: bundled ? 'release' : 'local',
    executable: bundled ? process.execPath : fileURLToPath(metaUrl),
    workingDirectory: process.cwd(),
    bunVersion: process.versions.bun ?? 'unavailable'
  }
}
