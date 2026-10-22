import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { TechneError } from './errors.ts'
import type { CommandResult, CommandRunner } from './process.ts'
import type { Recipe, RecipeCatalogue } from './recipes.ts'
import { isTable, type TomlTable } from './toml.ts'

// The provider-neutral scripts a recipe names under [paths].
export type HarnessScript = string

export type WorkspaceState = 'reported' | 'skipped' | 'failed' | 'unreachable'

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

export type SafetyOutcome = 'clean' | 'at-risk' | 'unknown' | 'failed' | 'unreachable'
export const SAFETY_EXITS: Readonly<Record<SafetyOutcome, number>> = {
  clean: 0,
  failed: 1,
  'at-risk': 3,
  unknown: 4,
  unreachable: 255
}

export interface WorkspaceStatus {
  outcome: SafetyOutcome
  safety: TomlTable | null
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

  script(recipe: Recipe, name: HarnessScript, provider?: string): string {
    const relative = provider === undefined ? recipe.paths[name] : recipe.provider[provider]?.paths[name]
    if (relative === undefined) {
      throw new TechneError(`recipe ${recipe.name} declares no ${name} script under [paths]`)
    }
    const path = join(this.recipes.checkout(), relative)
    if (!existsSync(path)) {
      throw new TechneError(`${this.recipes.harnessDir} has no ${relative}; update the ki-techne-harness checkout`)
    }
    return path
  }

  async execute(
    script: string,
    args: readonly string[],
    env: Readonly<Record<string, string>>,
    operation = 'setup'
  ): Promise<void> {
    let result: CommandResult
    try {
      result = await this.runner.run('bash', [script, ...args], {
        mode: 'interactive',
        env,
        cwd: this.recipes.harnessDir
      })
    } catch {
      throw new TechneError(`harness ${operation} could not run`)
    }
    if (result.exitCode !== 0) {
      throw new TechneError(`harness ${operation} failed with exit status ${result.exitCode}`)
    }
  }

  async workspaceStatus(
    recipe: Recipe,
    env: Readonly<Record<string, string>>,
    text: boolean
  ): Promise<WorkspaceStatus> {
    const failure = (outcome: 'failed' | 'unreachable', detail: string): WorkspaceStatus => ({
      state: outcome,
      outcome,
      safety: null,
      report: null,
      detail
    })
    try {
      const script = this.script(recipe, 'status')
      if (recipe.status === null) {
        const result = await this.runner.run('bash', [script], { env, cwd: this.recipes.harnessDir })
        if (result.exitCode !== 0)
          return failure(result.exitCode === 255 ? 'unreachable' : 'failed', 'legacy workspace report failed')
        return {
          state: 'reported',
          outcome: 'unknown',
          safety: null,
          report: result.stdout,
          detail: 'recipe declares no structured safety contract'
        }
      }
      const contract = recipe.status
      if (
        contract.schema !== WORKSPACE_SCHEMA ||
        Object.entries(SAFETY_EXITS).some(([key, code]) => contract.exit[key] !== code)
      ) {
        return failure('failed', 'unsupported workspace safety contract')
      }
      const result = await this.runner.run('bash', [script, '--json'], { env, cwd: this.recipes.harnessDir })
      const document = parseDocument(result.stdout)
      if (result.exitCode === 255 && document === null) return failure('unreachable', 'workspace host is unreachable')
      if (!validSafety(document) || SAFETY_EXITS[document['outcome'] as SafetyOutcome] !== result.exitCode) {
        return failure('failed', 'invalid workspace safety report or outcome/exit mismatch')
      }
      const outcome = document['outcome'] as SafetyOutcome
      const workspace: WorkspaceStatus = {
        state: REPORTING_OUTCOMES.includes(outcome) ? 'reported' : outcome === 'unreachable' ? 'unreachable' : 'failed',
        outcome,
        safety: { ...document },
        report: null,
        detail: null
      }
      if ('updates' in document) {
        const updates = updatesOf(document['updates'])
        if (updates !== undefined) workspace.updates = updates
        else delete (workspace.safety as TomlTable)['updates']
      }
      if (text && workspace.state === 'reported') {
        try {
          const advisory = await this.runner.run('bash', [script, '--connect-timeout', '5'], {
            env,
            cwd: this.recipes.harnessDir
          })
          if ([0, 3, 4].includes(advisory.exitCode)) workspace.report = advisory.stdout
          else workspace.detail = 'advisory text report unavailable'
        } catch {
          workspace.detail = 'advisory text report unavailable'
        }
      }
      return workspace
    } catch {
      return failure('failed', 'workspace safety report unavailable; check the recipe status script')
    }
  }
}

function validSafety(document: TomlTable | null): document is TomlTable {
  if (
    document === null ||
    document['schema'] !== WORKSPACE_SCHEMA ||
    typeof document['outcome'] !== 'string' ||
    !Object.hasOwn(SAFETY_EXITS, document['outcome']) ||
    typeof document['generated_at'] !== 'string' ||
    typeof document['workspace'] !== 'string' ||
    typeof document['fetched'] !== 'boolean'
  )
    return false
  const host = document['host']
  if (!isTable(host) || typeof host['hostname'] !== 'string' || !nullable(isString)(host['id'])) return false
  const repositories = document['repositories']
  if (!Array.isArray(repositories) || !repositories.every(validRepository) || !isStrings(document['problems']))
    return false
  if (REPORTING_OUTCOMES.includes(document['outcome'])) {
    const expected =
      (document['problems'] as string[]).length > 0 ||
      repositories.some((entry) => (entry as TomlTable)['state'] === 'unknown')
        ? 'unknown'
        : repositories.some((entry) => (entry as TomlTable)['state'] === 'at-risk')
          ? 'at-risk'
          : 'clean'
    // An at-risk/unknown verdict may also reflect missing expected repositories;
    // reject any claim safer than the evidence already present.
    if (document['outcome'] === 'clean' && expected !== 'clean') return false
    if (document['outcome'] === 'at-risk' && expected === 'unknown') return false
  }
  return true
}

function validRepository(value: unknown): boolean {
  if (
    !isTable(value) ||
    !isString(value['path']) ||
    !isString(value['branch']) ||
    !['clean', 'at-risk', 'unknown'].includes(value['state'] as string) ||
    !isCount(value['dirty']) ||
    !isCount(value['unpushed']) ||
    !isCount(value['stashes']) ||
    !nullable(isString)(value['problem'])
  )
    return false
  const upstream = value['upstream']
  if (upstream !== null && !(isTable(upstream) && isCount(upstream['ahead']) && isCount(upstream['behind'])))
    return false
  if (value['problem'] !== null && value['state'] !== 'unknown') return false
  // Labels cannot erase risk or incomplete inspection in the same repository.
  if (value['state'] === 'clean' && (value['dirty'] > 0 || value['unpushed'] > 0 || value['stashes'] > 0)) return false
  return true
}
