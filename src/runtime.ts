import { fileURLToPath } from 'node:url'
import { installationProvenance } from './installation-provenance.ts'
import { TECHNE_VERSION } from './version.ts'

export type InstallationMode = 'local' | 'release' | 'unknown'

export interface TechneRuntime {
  version: string
  installation: InstallationMode
  executable: string
  workingDirectory: string
  bunVersion: string
  platform: string
  architecture: string
}

export function processRuntime(metaUrl: string): TechneRuntime {
  const bundled = metaUrl.startsWith('file:///$bunfs/')
  return {
    version: TECHNE_VERSION,
    installation: installationProvenance(metaUrl),
    executable: bundled ? process.execPath : fileURLToPath(metaUrl),
    workingDirectory: process.cwd(),
    bunVersion: process.versions.bun ?? 'unavailable',
    platform: process.platform,
    architecture: process.arch
  }
}
