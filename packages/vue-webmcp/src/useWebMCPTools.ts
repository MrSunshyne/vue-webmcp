import { computed, readonly, toValue } from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import { isDev, warn } from './context'
import type { WebMCPToolAnnotations } from './types'
import { useWebMCPTool } from './useWebMCPTool'
import type { UseWebMCPToolOptions, UseWebMCPToolReturn } from './useWebMCPTool'

/**
 * Typed identity helper, so a tool definition can live in a plain module
 * (importable, testable, no component needed to write it) and keep the
 * inferred `Args` and `Result` types, and its literal name, when it is
 * registered later.
 */
export function defineWebMCPTool<
  Args = Record<string, unknown>,
  Result = unknown,
  const Name extends MaybeRefOrGetter<string> = string,
>(
  definition: Omit<UseWebMCPToolOptions<Args, Result>, 'name'> & { name: Name },
): Omit<UseWebMCPToolOptions<Args, Result>, 'name'> & { name: Name } {
  return definition
}

// `any` on purpose: one list holds tools with different Args and Result
// types, and `unknown` would reject every typed `execute` under
// strictFunctionTypes.
type AnyToolOptions = UseWebMCPToolOptions<any, any>

/** Options applied to every tool in the group unless the tool sets its own. */
export interface UseWebMCPToolsSharedOptions {
  enabled?: MaybeRefOrGetter<boolean>
  annotations?: MaybeRefOrGetter<WebMCPToolAnnotations | undefined>
  exposedTo?: MaybeRefOrGetter<readonly string[] | undefined>
  /** Receives the failing tool's name as well, since one handler serves the group. */
  onError?: (error: unknown, name: string) => void
}

/** Static tool names in a definitions tuple; reactive names fall back to `string`. */
type ToolNames<T extends readonly AnyToolOptions[]> = T[number]['name'] extends string
  ? T[number]['name']
  : string

export interface UseWebMCPToolsReturn<Names extends string = string> {
  /** A modelContext API exists in this environment. */
  isSupported: Readonly<Ref<boolean>>
  /**
   * Every enabled tool in the group is registered. Tools switched off through
   * `enabled` are left out, so a group with its read tools on and its write
   * tools off still counts as registered; `false` while no tool is enabled.
   */
  isRegistered: Readonly<Ref<boolean>>
  /** The first registration failure in the group, if any. */
  error: Readonly<Ref<Error | null>>
  /** Per-tool state, keyed by each tool's name at setup time. */
  byName: Readonly<Record<Names, UseWebMCPToolReturn>>
}

interface Entry {
  enabled: MaybeRefOrGetter<boolean> | undefined
  state: UseWebMCPToolReturn
}

/**
 * Registers a group of tools from one component or scope, with options
 * shared across the group. Each tool still goes through `useWebMCPTool`, so
 * per-tool `enabled`, `annotations`, `exposedTo` and `onError` win over the
 * shared ones, the per-tool state stays reachable through `byName`, and one
 * tool failing to register leaves the others registered.
 */
export function useWebMCPTools<const T extends readonly AnyToolOptions[]>(
  definitions: T,
  shared: UseWebMCPToolsSharedOptions = {},
): UseWebMCPToolsReturn<ToolNames<T>> {
  // No prototype: a tool may legitimately be named "constructor" or "__proto__".
  const byName: Record<string, UseWebMCPToolReturn> = Object.create(null)
  const entries: Entry[] = []

  for (const definition of definitions) {
    const name = toValue(definition.name)
    if (isDev && name in byName) {
      warn(`useWebMCPTools() received the tool name "${name}" twice; the browser rejects duplicate registrations.`)
    }
    const enabled = definition.enabled ?? shared.enabled
    const { onError } = definition
    const merged: AnyToolOptions = {
      ...definition,
      enabled,
      annotations: definition.annotations ?? shared.annotations,
      exposedTo: definition.exposedTo ?? shared.exposedTo,
      onError:
        onError ?? (shared.onError ? error => shared.onError!(error, toValue(definition.name)) : undefined),
    }
    const state = useWebMCPTool(merged)
    byName[name] = state
    entries.push({ enabled, state })
  }

  const isSupported = computed(() => entries.some(entry => entry.state.isSupported.value))
  const isRegistered = computed(() => {
    const active = entries.filter(entry => toValue(entry.enabled ?? true))
    return active.length > 0 && active.every(entry => entry.state.isRegistered.value)
  })
  const error = computed(() => entries.map(entry => entry.state.error.value).find(Boolean) ?? null)

  return {
    isSupported: readonly(isSupported),
    isRegistered: readonly(isRegistered),
    error: readonly(error),
    byName: byName as Readonly<Record<ToolNames<T>, UseWebMCPToolReturn>>,
  }
}
