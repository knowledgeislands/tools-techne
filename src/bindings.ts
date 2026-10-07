import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Environment } from './config.ts'
import { TechneError } from './errors.ts'
import {
  derive,
  placeholders,
  type Recipe,
  type RecipeCatalogue,
  type RecipeParameter,
  type RecipeProvider
} from './recipes.ts'
import { isTable, optionalString, readToml, requiredString, scalarText, type TomlTable } from './toml.ts'

export const BINDING_SCHEMA = 'techne/host-binding/v1'
export const NEUTRAL_FIELDS = ['host_name', 'tailscale_name', 'tailscale_tag', 'repositories', 'workspace'] as const
const BINDING_NAME = /^[a-z0-9][a-z0-9-]*$/
const HOSTS = 'hosts'
const CONFIG = 'config.toml'

// What the binding loader needs from a provider; the full adapter extends it.
export interface ProviderSchema {
  readonly name: string
  readonly bindingFields: readonly string[]
  readonly controllerFields: readonly string[]
  identities(binding: HostBinding): readonly string[]
}

export interface HostBinding {
  name: string
  file: string
  recipe: Recipe
  provider: string
  // Resolved values keyed as the recipe's placeholders name them: name, each
  // provider-neutral <field> and each <provider>.<field>; a field with no
  // value is absent.
  values: Readonly<Record<string, string>>
}

export interface ControllerTarget {
  provider: string
  table: Readonly<TomlTable>
}

export interface TechneSettings {
  directory: string
  defaultHost: string | null
  controller: ControllerTarget | null
}

export function configDirectory(environment: Environment): string {
  const base = environment['XDG_CONFIG_HOME'] || (environment['HOME'] ? join(environment['HOME'], '.config') : '')
  if (base === '') throw new TechneError('cannot locate the techne configuration: set XDG_CONFIG_HOME or HOME')
  return join(base, 'techne')
}

function findProvider<T extends ProviderSchema>(providers: readonly T[], name: string): T | undefined {
  return providers.find((provider) => provider.name === name)
}

function refuseUnknown(table: TomlTable, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(table)) {
    if (!allowed.includes(key)) throw new TechneError(`${where}: unknown field ${key}`)
  }
}

export function readSettings(directory: string, providers: readonly ProviderSchema[]): TechneSettings {
  const path = join(directory, CONFIG)
  if (!existsSync(path)) return { directory, defaultHost: null, controller: null }
  const table = readToml(path)
  refuseUnknown(table, ['default_host', 'controller'], path)
  const controllers = table['controller'] === undefined ? {} : table['controller']
  if (!isTable(controllers)) throw new TechneError(`${path}: controller must hold one [controller.<provider>] table`)
  const entries = Object.entries(controllers)
  if (entries.length > 1) {
    throw new TechneError(`${path}: controller must hold at most one [controller.<provider>] table`)
  }
  let controller: ControllerTarget | null = null
  const entry = entries[0]
  if (entry !== undefined) {
    const [name, value] = entry
    const provider = findProvider(providers, name)
    if (!isTable(value) || provider === undefined) {
      throw new TechneError(`${path}: unknown field controller.${name}; expected one [controller.<provider>] table`)
    }
    refuseUnknown(value, provider.controllerFields, `${path} [controller.${name}]`)
    controller = { provider: name, table: value }
  }
  return { directory, defaultHost: optionalString(table, 'default_host', path), controller }
}

function readBinding(
  path: string,
  fileName: string,
  recipes: RecipeCatalogue,
  providers: readonly ProviderSchema[]
): HostBinding {
  const table = readToml(path)
  if (table['schema'] !== BINDING_SCHEMA) throw new TechneError(`${path}: schema must be "${BINDING_SCHEMA}"`)
  const name = requiredString(table, 'name', path)
  if (name !== fileName) throw new TechneError(`${path}: name ${name} does not match the file name ${fileName}`)
  const providerTables = Object.keys(table).filter((key) => isTable(table[key]))
  refuseUnknown(
    table,
    ['schema', 'name', 'recipe', ...NEUTRAL_FIELDS, ...providerTables.filter((key) => findProvider(providers, key))],
    path
  )
  if (providerTables.length !== 1) {
    throw new TechneError(
      `${path}: a binding needs exactly one provider table, such as [aws]; found ${providerTables.length}`
    )
  }
  const providerName = providerTables[0] as string
  const provider = findProvider(providers, providerName) as ProviderSchema
  const recipe = recipes.get(requiredString(table, 'recipe', path))
  if (!recipe.providers.includes(providerName)) {
    throw new TechneError(
      `${path}: recipe ${recipe.name} does not support provider ${providerName}; it supports ${recipe.providers.join(', ')}`
    )
  }
  const providerTable = table[providerName] as TomlTable
  refuseUnknown(providerTable, provider.bindingFields, `${path} [${providerName}]`)

  const written: Record<string, string> = {}
  const record = (key: string, value: unknown, where: string): void => {
    if (value === undefined) return
    const text = scalarText(value)
    if (text === null || text === '') throw new TechneError(`${where} must be a non-empty value or string list`)
    written[key] = text
  }
  for (const field of NEUTRAL_FIELDS) record(field, table[field], `${path}: ${field}`)
  for (const [field, value] of Object.entries(providerTable)) {
    record(`${providerName}.${field}`, value, `${path}: ${providerName}.${field}`)
  }
  const values = resolveValues(name, written, recipe, providerName, path)
  for (const field of NEUTRAL_FIELDS) {
    if (values[field] === undefined && recipe.parameters[field]?.required) {
      throw new TechneError(`${path}: ${field} is required by recipe ${recipe.name}`)
    }
  }
  return { name, file: path, recipe, provider: providerName, values }
}

function recipeParameters(recipe: Recipe, provider: string): Record<string, RecipeParameter> {
  const parameters: Record<string, RecipeParameter> = { ...recipe.parameters }
  for (const [field, parameter] of Object.entries((recipe.provider[provider] as RecipeProvider).parameters)) {
    parameters[`${provider}.${field}`] = parameter
  }
  return parameters
}

// Each field is the binding's value, else the recipe default with its
// placeholders resolved the same way; a default naming an absent value is absent.
function resolveValues(
  name: string,
  written: Readonly<Record<string, string>>,
  recipe: Recipe,
  provider: string,
  where: string
): Record<string, string> {
  const parameters = recipeParameters(recipe, provider)
  const values: Record<string, string> = { name, ...written }
  const pending = new Set<string>()
  const lookup = (key: string): string | undefined => {
    if (key in values) return values[key]
    const fallback = parameters[key]?.default
    if (fallback == null) return undefined
    if (pending.has(key))
      throw new TechneError(`${where}: recipe ${recipe.name} defaults refer to each other at ${key}`)
    pending.add(key)
    const known: Record<string, string> = {}
    for (const placeholder of placeholders(fallback)) {
      const value = lookup(placeholder)
      if (value !== undefined) known[placeholder] = value
    }
    pending.delete(key)
    const text = derive(fallback, known)
    if (text === null) return undefined
    values[key] = text
    return text
  }
  for (const key of Object.keys(parameters)) lookup(key)
  return values
}

function refuseDuplicates(bindings: readonly HostBinding[], keysOf: (binding: HostBinding) => readonly string[]) {
  const seen = new Map<string, string>()
  for (const binding of bindings) {
    for (const key of keysOf(binding)) {
      const other = seen.get(key)
      if (other !== undefined && other !== binding.name) {
        throw new TechneError(`bindings ${other} and ${binding.name} share ${key}; each host needs its own`)
      }
      seen.set(key, binding.name)
    }
  }
}

export function bindingNames(directory: string): string[] {
  const hosts = join(directory, HOSTS)
  if (!existsSync(hosts)) return []
  return readdirSync(hosts)
    .filter((file) => file.endsWith('.toml'))
    .map((file) => file.slice(0, -'.toml'.length))
    .sort()
}

export function loadBindings(
  directory: string,
  recipes: RecipeCatalogue,
  providers: readonly ProviderSchema[]
): HostBinding[] {
  const bindings = bindingNames(directory).map((name) =>
    readBinding(join(directory, HOSTS, `${name}.toml`), name, recipes, providers)
  )
  refuseDuplicates(bindings, (binding) =>
    (['host_name', 'tailscale_name'] as const).flatMap((field) =>
      binding.values[field] === undefined ? [] : [`${field.replace('_', ' ')} ${binding.values[field]}`]
    )
  )
  refuseDuplicates(bindings, (binding) =>
    (findProvider(providers, binding.provider) as ProviderSchema).identities(binding)
  )
  return bindings
}

export type SelectionSource = '--host' | 'TECHNE_HOST' | 'default_host' | 'sole binding'

export interface Selection {
  name: string
  source: SelectionSource
}

function availability(bindings: readonly HostBinding[]): string {
  return `available: ${bindings.map((binding) => binding.name).join(', ')}`
}

function noBindings(bindings: readonly HostBinding[]): void {
  if (bindings.length === 0) {
    throw new TechneError('no host binding is configured; add one with techne host add <name> --recipe <recipe>')
  }
}

// Steps 1 to 4 of host selection; null when nothing selects a binding.
export function trySelect(
  bindings: readonly HostBinding[],
  settings: TechneSettings,
  flag: string | null,
  environment: Environment
): Selection | null {
  const named: [string | null | undefined, SelectionSource][] = [
    [flag, '--host'],
    [environment['TECHNE_HOST'] || null, 'TECHNE_HOST'],
    [settings.defaultHost, 'default_host']
  ]
  for (const [name, source] of named) {
    if (name == null) continue
    if (!bindings.some((binding) => binding.name === name)) {
      throw new TechneError(`${source} names ${name}, which is not a host binding; ${availability(bindings)}`)
    }
    return { name, source }
  }
  const sole = bindings.length === 1 ? (bindings[0] as HostBinding) : null
  return sole === null ? null : { name: sole.name, source: 'sole binding' }
}

export function selectBinding(
  bindings: readonly HostBinding[],
  settings: TechneSettings,
  flag: string | null,
  environment: Environment
): HostBinding {
  noBindings(bindings)
  const selection = trySelect(bindings, settings, flag, environment)
  if (selection === null) {
    throw new TechneError(
      `several host bindings and none selected; ${availability(bindings)}; choose one with --host <name>, TECHNE_HOST or default_host in config.toml`,
      2
    )
  }
  return bindings.find((binding) => binding.name === selection.name) as HostBinding
}

export function addBinding(directory: string, name: string, recipe: Recipe, provider: string | null): string {
  if (!BINDING_NAME.test(name)) {
    throw new TechneError(
      `invalid binding name ${name}; use lower-case letters, digits and hyphens, starting with a letter or digit`,
      2
    )
  }
  if (provider === null && recipe.providers.length !== 1) {
    throw new TechneError(
      `recipe ${recipe.name} supports several providers; choose one with --provider <${recipe.providers.join('|')}>`,
      2
    )
  }
  const chosen = provider ?? (recipe.providers[0] as string)
  if (!recipe.providers.includes(chosen)) {
    throw new TechneError(
      `recipe ${recipe.name} does not support provider ${chosen}; it supports ${recipe.providers.join(', ')}`,
      2
    )
  }
  const path = join(directory, HOSTS, `${name}.toml`)
  if (existsSync(path)) throw new TechneError(`refusing to overwrite the existing binding ${path}`)
  mkdirSync(join(directory, HOSTS), { recursive: true })
  writeFileSync(path, `schema = "${BINDING_SCHEMA}"\nname = "${name}"\nrecipe = "${recipe.name}"\n\n[${chosen}]\n`, {
    flag: 'wx'
  })
  return path
}

// The variables one script reads: each parameter that lists the script and declares an env, with a value.
export function scriptEnvironment(
  recipe: Recipe,
  provider: string,
  values: Readonly<Record<string, string>>,
  script: string
): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, parameter] of Object.entries(recipeParameters(recipe, provider))) {
    const value = values[key]
    if (parameter.env !== null && parameter.scripts.includes(script) && value !== undefined) {
      environment[parameter.env] = value
    }
  }
  return environment
}
