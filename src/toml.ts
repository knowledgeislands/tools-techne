import { readFileSync } from 'node:fs'
import { parse } from 'smol-toml'
import { TechneError } from './errors.ts'

export type TomlTable = Record<string, unknown>

export function isTable(value: unknown): value is TomlTable {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

export function readToml(path: string): TomlTable {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new TechneError(`cannot read ${path}: ${(error as Error).message}`)
  }
  try {
    return parse(text) as TomlTable
  } catch (error) {
    throw new TechneError(`${path} is not valid TOML: ${(error as Error).message.split('\n', 1)[0]}`)
  }
}

export function optionalString(table: TomlTable, key: string, where: string): string | null {
  const value = table[key]
  if (value === undefined) return null
  if (typeof value !== 'string' || value.length === 0) {
    throw new TechneError(`${where}: ${key} must be a non-empty string`)
  }
  return value
}

export function requiredString(table: TomlTable, key: string, where: string): string {
  const value = optionalString(table, key, where)
  if (value === null) throw new TechneError(`${where}: ${key} is required`)
  return value
}

export function optionalTable(table: TomlTable, key: string, where: string): TomlTable {
  const value = table[key]
  if (value === undefined) return {}
  if (!isTable(value)) throw new TechneError(`${where}: ${key} must be a table`)
  return value
}

// A scalar or string list as one environment-variable value: lists join with newlines.
export function scalarText(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join('\n')
  return null
}
