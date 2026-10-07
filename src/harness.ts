import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { TechneError } from './errors.ts'
import { type CommandRunner, failureMessage } from './process.ts'
import type { Recipe, RecipeCatalogue } from './recipes.ts'

// The provider-neutral scripts a recipe names under [paths].
export type HarnessScript = 'setup' | 'status'

export type WorkspaceState = 'reported' | 'skipped' | 'failed'

export interface WorkspaceStatus {
  state: WorkspaceState
  report: string | null
  detail: string | null
}

// Runs a recipe's scripts in place from a local ki-techne-harness checkout,
// which stays their only copy (ADR-TECHNE-003). Binding values reach them only
// through the environment variables the recipe declares.
export class HarnessCheckout {
  private readonly runner: CommandRunner
  private readonly recipes: RecipeCatalogue

  constructor(runner: CommandRunner, recipes: RecipeCatalogue) {
    this.runner = runner
    this.recipes = recipes
  }

  script(recipe: Recipe, name: HarnessScript): string {
    const relative = recipe.paths[name]
    if (relative === undefined) {
      throw new TechneError(`recipe ${recipe.name} declares no ${name} script under [paths]`)
    }
    const path = join(this.recipes.checkout(), relative)
    if (!existsSync(path)) {
      throw new TechneError(`${this.recipes.harnessDir} has no ${relative}; update the ki-techne-harness checkout`)
    }
    return path
  }

  async setup(script: string, args: readonly string[], env: Readonly<Record<string, string>>): Promise<void> {
    const result = await this.runner.run('bash', [script, ...args], {
      mode: 'interactive',
      env,
      cwd: this.recipes.harnessDir
    })
    if (result.exitCode !== 0) {
      throw new TechneError(`harness setup failed with exit status ${result.exitCode}`)
    }
  }

  async workspaceStatus(recipe: Recipe, env: Readonly<Record<string, string>>): Promise<WorkspaceStatus> {
    let script: string
    try {
      script = this.script(recipe, 'status')
    } catch (error) {
      return { state: 'failed', report: null, detail: (error as TechneError).message }
    }
    const result = await this.runner.run('bash', [script], { env, cwd: this.recipes.harnessDir })
    if (result.exitCode !== 0) {
      return { state: 'failed', report: null, detail: failureMessage('harness status script failed', result) }
    }
    return { state: 'reported', report: result.stdout, detail: null }
  }
}
