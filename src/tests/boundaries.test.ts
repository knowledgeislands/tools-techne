import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, test } from 'vitest'

const execute = promisify(execFile)
const checker = resolve('tooling/boundaries/node_modules/.bin/depcruise')
const moduleFloor = 14
interface Dependency {
  resolved: string
  couldNotResolve?: boolean
  dependencyTypes?: string[]
}
interface Graph {
  modules: { source: string; dependencies: Dependency[] }[]
  summary: { violations: { from: string; to: string; rule: { name: string } }[] }
}
const cruise = async (cwd = process.cwd()): Promise<Graph> => {
  try {
    const result = await execute(checker, ['--config', '.dependency-cruiser.ts', '--output-type', 'json', 'src'], {
      cwd
    })
    return JSON.parse(result.stdout) as Graph
  } catch (error) {
    const result = error as { stdout?: string }
    if (result.stdout) return JSON.parse(result.stdout) as Graph
    throw error
  }
}

describe('resolved dependency boundaries', () => {
  test('uses a supported transpiler and measures the actual source graph', async () => {
    const transpilers = await execute(
      'node',
      [
        '--input-type=module',
        '-e',
        "import {getAvailableTranspilers} from 'dependency-cruiser'; console.log(JSON.stringify(getAvailableTranspilers()))"
      ],
      { cwd: resolve('tooling/boundaries') }
    )
    expect(JSON.parse(transpilers.stdout)).toContainEqual(
      expect.objectContaining({ name: 'typescript', available: true })
    )
    const graph = await cruise()
    const owned = graph.modules.filter((module) => module.source.startsWith('src/'))
    expect(owned.length).toBeGreaterThanOrEqual(moduleFloor)
    expect(
      owned.flatMap((module) =>
        module.dependencies.filter(
          (dependency) =>
            dependency.resolved.startsWith('src/') &&
            dependency.resolved !== module.source &&
            dependency.dependencyTypes?.includes('type-only')
        )
      ).length
    ).toBeGreaterThan(0)
    const entry = owned.find((module) => module.source === 'src/main.ts')
    expect(entry?.dependencies).toContainEqual(
      expect.objectContaining({ resolved: 'src/cli.ts', couldNotResolve: false })
    )
    expect(graph.summary.violations).toEqual([])
  }, 20000)

  test('rejects a resolved type-only import that crosses the declared domain boundary', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'techne-boundary-'))
    try {
      await writeFile(join(fixture, '.dependency-cruiser.ts'), await readFile('.dependency-cruiser.ts'))
      await writeFile(join(fixture, 'tsconfig.json'), await readFile('tsconfig.json'))
      await mkdir(join(fixture, 'src'), { recursive: true })
      await writeFile(join(fixture, 'src/cli.ts'), 'export interface Probe { value: string }\n')
      await writeFile(
        join(fixture, 'src/aws.ts'),
        "import type { Probe } from './cli.ts'\nexport type Crossing = Probe\n"
      )
      const graph = await cruise(fixture)
      const source = graph.modules.find((module) => module.source === 'src/aws.ts')
      expect(source?.dependencies).toContainEqual(
        expect.objectContaining({
          resolved: 'src/cli.ts',
          couldNotResolve: false,
          dependencyTypes: expect.arrayContaining(['type-only'])
        })
      )
      expect(graph.summary.violations.map((violation) => violation.rule.name)).toContain(
        'providers-do-not-import-the-cli'
      )
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  }, 20000)
})
