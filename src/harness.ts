import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { TechneError } from './errors.ts'
import { type CommandRunner, failureMessage } from './process.ts'
import type { Recipe, RecipeCatalogue } from './recipes.ts'
import { isTable, type TomlTable } from './toml.ts'

// The provider-neutral scripts a recipe names under [paths].
export type HarnessScript = 'setup' | 'status'

export type WorkspaceState = 'reported' | 'skipped' | 'failed'

// The status document's optional updates member; each null is unknown.
export interface HostUpdates {
  os: string | null
  pending: number | null
  security: number | null
  reboot_required: boolean | null
  reboot_required_since: string | null
  reboot_packages: string[] | null
  livepatch: string | null
}

export interface WorkspaceStatus {
  state: WorkspaceState
  report: string | null
  detail: string | null
  // Present only when a JSON status document supplied it; null when it said so.
  updates?: HostUpdates | null
}

export const WORKSPACE_SCHEMA = 'techne/host-workspace/v1'
// Outcomes whose document may carry updates; failed and unreachable carry none.
const REPORTING_OUTCOMES = ['clean', 'at-risk', 'unknown']

const nullable =
  <T>(check: (value: unknown) => value is T) =>
  (value: unknown): value is T | null =>
    value === null || check(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)

const UPDATE_FIELDS: Readonly<Record<keyof HostUpdates, (value: unknown) => boolean>> = {
  os: nullable(isString),
  pending: nullable(isCount),
  security: nullable(isCount),
  reboot_required: nullable(isBoolean),
  reboot_required_since: nullable(isString),
  reboot_packages: nullable(isStrings),
  livepatch: nullable(isString)
}

// The known update fields, or undefined when any is missing or malformed;
// unknown additive fields are dropped, never coerced or shown.
function updatesOf(member: unknown): HostUpdates | null | undefined {
  if (member === null) return null
  if (!isTable(member)) return undefined
  const updates: Record<string, unknown> = {}
  for (const [field, valid] of Object.entries(UPDATE_FIELDS)) {
    if (!(field in member) || !valid(member[field])) return undefined
    updates[field] = member[field]
  }
  return updates as unknown as HostUpdates
}

function parseDocument(text: string): TomlTable | null {
  try {
    const document: unknown = JSON.parse(text)
    return isTable(document) ? document : null
  } catch {
    return null
  }
}

// Runs a recipe's scripts in place from a local ki-techne-harness checkout,
// which stays their only copy (ADR-KI-PRINCIPAL-006). Binding values reach them only
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

  // An advisory read of the updates member from the recipe's JSON status
  // report; undefined when the recipe declares none or the read does not
  // yield a valid one. It never decides the workspace state or the exit status.
  async workspaceUpdates(
    recipe: Recipe,
    env: Readonly<Record<string, string>>
  ): Promise<HostUpdates | null | undefined> {
    const declared = recipe.status
    if (declared === null || declared.schema !== WORKSPACE_SCHEMA) return undefined
    try {
      const result = await this.runner.run('bash', [this.script(recipe, 'status'), '--json'], {
        env,
        cwd: this.recipes.harnessDir
      })
      const document = parseDocument(result.stdout)
      if (document === null || document['schema'] !== declared.schema) return undefined
      const outcome = document['outcome']
      if (typeof outcome !== 'string' || !REPORTING_OUTCOMES.includes(outcome)) return undefined
      if (declared.exit[outcome] !== result.exitCode) return undefined
      return 'updates' in document ? updatesOf(document['updates']) : undefined
    } catch {
      return undefined
    }
  }
}
