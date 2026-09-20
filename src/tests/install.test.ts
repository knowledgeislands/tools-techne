import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

const repository = resolve(import.meta.dirname, '../..')
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function run(
  command: readonly string[],
  environment: Record<string, string>
): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const executable = command[0]
  if (executable === undefined) {
    throw new Error('command cannot be empty')
  }

  return await new Promise((resolveResult) => {
    const child = spawn(executable, command.slice(1), {
      cwd: repository,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (value: string) => {
      stdout += value
    })
    child.stderr.on('data', (value: string) => {
      stderr += value
    })
    child.on('error', (error) => {
      resolveResult({ exitCode: 127, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => {
      resolveResult({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}

describe('local installer', () => {
  test('installs a launcher and manual bound to the checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'techne-install-'))
    temporaryDirectories.push(root)
    const installDirectory = join(root, 'bin')
    const manDirectory = join(root, 'man', 'man1')

    const installation = await run(['bash', 'install.sh', '--link'], {
      TECHNE_INSTALL_DIR: installDirectory,
      TECHNE_MAN_INSTALL_DIR: manDirectory
    })
    expect(installation).toMatchObject({ exitCode: 0, stderr: '' })
    expect(installation.stdout).toContain('linked')

    const launcher = join(installDirectory, 'techne')
    expect(await readFile(launcher, 'utf8')).toContain(resolve(repository, 'src/main.ts'))
    expect(await readFile(join(manDirectory, 'techne.1'), 'utf8')).toContain('.TH TECHNE 1')

    const diagnostic = await run([launcher, 'diag', '--json'], {})
    expect(diagnostic.exitCode).toBe(0)
    expect(JSON.parse(diagnostic.stdout)).toMatchObject({ version: '0.1.0', installation: 'local' })
  })

  test('rejects an implicit installation mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'techne-install-'))
    temporaryDirectories.push(root)

    const result = await run(['bash', 'install.sh'], { TECHNE_INSTALL_DIR: join(root, 'bin') })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('expected --link')
  })
})
