import type { AuthSurface } from '../auth.ts'
import type { ControllerTarget, HostBinding, ProviderSchema } from '../bindings.ts'
import type { Environment } from '../config.ts'
import type { CommandRunner } from '../process.ts'

export type TargetKind = 'host' | 'controller'

// A provider-specific option, spelt --<provider>-<name> on the command line.
export interface ProviderOption {
  name: string
  value: string
  description: string
  targets: readonly TargetKind[]
}

export interface ProviderContext {
  runner: CommandRunner
  environment: Environment
  // This provider's option values from the command line, keyed by option name.
  options: Readonly<Record<string, string>>
}

export interface HostInstance {
  instanceId: string
  state: string
}

export interface HostReport {
  exists: boolean
  instanceId: string | null
  state: string
  // Provider facts shown with the state, such as where the provider looked.
  details: Readonly<Record<string, string>>
}

// The thin operator-scoped calls a host command makes on a provider's compute.
export interface HostAdapter {
  // Provider variables every harness script receives for this host.
  readonly environment: Readonly<Record<string, string>>
  // The binding's values with command-line and environment overrides applied.
  readonly values: Readonly<Record<string, string>>
  status(): Promise<HostReport>
  find(): Promise<HostInstance | null>
  start(instanceId: string): Promise<void>
  stop(instanceId: string): Promise<void>
  terminate(instanceId: string): Promise<void>
}

export interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
  status?: 'warn' | 'skipped'
}

export interface ControllerStatus {
  exists: boolean
  stackName: string
  stackStatus: string | null
  instanceId: string | null
}

export interface ControllerAdapter {
  // Non-secret target facts for diag --full, keyed by field.
  facts(): Readonly<Record<string, string>>
  doctorChecks(): Promise<DoctorCheck[]>
  authSurface(): AuthSurface
  status(): Promise<ControllerStatus>
  bootstrap(announce: (line: string) => void): Promise<void>
}

export interface Provider extends ProviderSchema {
  readonly options: readonly ProviderOption[]
  host(binding: HostBinding, context: ProviderContext): HostAdapter
  controller(target: ControllerTarget, context: ProviderContext): ControllerAdapter
}

export function optionFlag(provider: string, option: string): string {
  return `--${provider}-${option}`
}
