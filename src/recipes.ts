import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TechneError } from './errors.ts'
import { isTable, optionalString, optionalTable, readToml, requiredString, scalarText, type TomlTable } from './toml.ts'

export const RECIPE_SCHEMA = 'techne/recipe/v1'
export const HARNESS_SETTING = '--harness-dir or TECHNE_HARNESS_DIR'
const RECIPES = 'recipes'
const MANIFEST = 'recipe.toml'

export interface RecipeParameter {
  summary: string | null
  required: boolean
  default: string | null
  env: string | null
  // The scripts, named by their [paths] key, that receive env.
  scripts: readonly string[]
}

export interface RecipeSection {
  paths: Readonly<Record<string, string>>
  parameters: Readonly<Record<string, RecipeParameter>>
  footprint: readonly string[]
}

export interface RecipeProvider extends RecipeSection {
  summary: string | null
  selectors: Readonly<Record<string, string>>
}

export interface Recipe extends RecipeSection {
  name: string
  summary: string
  runtime: string
  providers: readonly string[]
  provider: Readonly<Record<string, RecipeProvider>>
}

function strings(table: TomlTable, where: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(table)) {
    if (typeof value !== 'string') throw new TechneError(`${where}.${key} must be a string`)
    values[key] = value
  }
  return values
}

function parameters(table: TomlTable, where: string): Record<string, RecipeParameter> {
  const values: Record<string, RecipeParameter> = {}
  for (const [field, value] of Object.entries(table)) {
    const at = `${where}.${field}`
    if (!isTable(value)) throw new TechneError(`${at} must be a table`)
    if (value['required'] !== undefined && typeof value['required'] !== 'boolean') {
      throw new TechneError(`${at}: required must be true or false`)
    }
    const fallback = value['default'] === undefined ? null : scalarText(value['default'])
    if (value['default'] !== undefined && fallback === null) {
      throw new TechneError(`${at}: default must be a string, number, boolean or string list`)
    }
    const scripts = value['scripts'] ?? []
    if (!Array.isArray(scripts) || !scripts.every((script) => typeof script === 'string')) {
      throw new TechneError(`${at}: scripts must be a list of script names`)
    }
    values[field] = {
      summary: optionalString(value, 'summary', at),
      required: value['required'] === true,
      default: fallback,
      env: optionalString(value, 'env', at),
      scripts
    }
  }
  return values
}

function footprint(table: TomlTable, where: string): string[] {
  const value = table['footprint']
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TechneError(`${where}: footprint must be a list`)
  return value.map((item: unknown) => {
    if (typeof item === 'string') return item
    if (isTable(item)) {
      const label = item['description'] ?? item['name']
      if (typeof label === 'string') return label
    }
    throw new TechneError(`${where}: each footprint entry must be a string or a table with a name or description`)
  })
}

function section(table: TomlTable, where: string): RecipeSection {
  return {
    paths: strings(optionalTable(table, 'paths', where), `${where} paths`),
    parameters: parameters(optionalTable(table, 'parameters', where), `${where} parameters`),
    footprint: footprint(table, where)
  }
}

export function parseRecipe(manifest: TomlTable, directoryName: string, where: string): Recipe {
  if (manifest['schema'] !== RECIPE_SCHEMA) {
    throw new TechneError(`${where}: schema must be "${RECIPE_SCHEMA}"`)
  }
  const name = requiredString(manifest, 'name', where)
  if (name !== directoryName) throw new TechneError(`${where}: name ${name} does not match its directory`)
  // Each [providers.<provider>] table names a provider the recipe supports.
  const sections = optionalTable(manifest, 'providers', where)
  const providers = Object.keys(sections)
  if (providers.length === 0) throw new TechneError(`${where}: no [providers.<provider>] table`)
  const provider: Record<string, RecipeProvider> = {}
  for (const providerName of providers) {
    const at = `${where} providers.${providerName}`
    const table = sections[providerName]
    if (!isTable(table)) throw new TechneError(`${at} must be a table`)
    provider[providerName] = {
      ...section(table, at),
      summary: optionalString(table, 'summary', at),
      selectors: strings(optionalTable(table, 'selectors', at), `${at} selectors`)
    }
  }
  return {
    name,
    summary: requiredString(manifest, 'summary', where),
    runtime: requiredString(manifest, 'runtime', where),
    providers,
    provider,
    ...section(manifest, where)
  }
}

// Reads recipe manifests in place from the configured ki-techne-harness checkout,
// which owns them (ADR-TECHNE-003); nothing is fetched or copied.
export class RecipeCatalogue {
  readonly harnessDir: string
  private cache: Recipe[] | null = null

  constructor(harnessDir: string) {
    this.harnessDir = harnessDir
  }

  checkout(): string {
    if (this.harnessDir === '') {
      throw new TechneError(`no ki-techne-harness checkout is configured; set ${HARNESS_SETTING}`)
    }
    if (!existsSync(this.harnessDir)) {
      throw new TechneError(
        `ki-techne-harness checkout not found at ${this.harnessDir}; clone it or set ${HARNESS_SETTING}`
      )
    }
    return this.harnessDir
  }

  list(): readonly Recipe[] {
    if (this.cache !== null) return this.cache
    const root = join(this.checkout(), RECIPES)
    if (!existsSync(root)) {
      throw new TechneError(`${this.harnessDir} has no ${RECIPES}/; update the ki-techne-harness checkout`)
    }
    this.cache = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, MANIFEST)))
      .map((entry) => entry.name)
      .sort()
      .map((name) => {
        const path = join(root, name, MANIFEST)
        return parseRecipe(readToml(path), name, `recipe ${RECIPES}/${name}/${MANIFEST}`)
      })
    return this.cache
  }

  get(name: string): Recipe {
    const recipe = this.list().find((candidate) => candidate.name === name)
    if (recipe === undefined) {
      const names = this.list().map((candidate) => candidate.name)
      throw new TechneError(`unknown recipe ${name}; available: ${names.length > 0 ? names.join(', ') : 'none'}`)
    }
    return recipe
  }
}

const PLACEHOLDER = /\{([^{}]+)\}/g

// Replaces {name}, {<field>} and {<provider>.<field>} placeholders with resolved
// values; null when one has no value.
export function derive(template: string, values: Readonly<Record<string, string>>): string | null {
  let missing = false
  const text = template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = values[key]
    if (value === undefined) missing = true
    return value ?? ''
  })
  return missing ? null : text
}

// The placeholders a template names.
export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string)
}
