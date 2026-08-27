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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  /** Every tool in the group is currently registered. */
  isRegistered: Readonly<Ref<boolean>>
  /** The first registration failure in the group, if any. */
  error: Readonly<Ref<Error | null>>
  /** Per-tool state, keyed by each tool's name at setup time. */
  byName: Readonly<Record<Names, UseWebMCPToolReturn>>
}

/**
 * Registers a group of tools from one component or scope, with options
 * shared across the group. Each tool still goes through `useWebMCPTool`, so
 * per-tool `enabled`, `annotations`, `exposedTo` and `onError` win over the
 * shared ones, and the per-tool state stays reachable through `byName`.
 */
export function useWebMCPTools<const T extends readonly AnyToolOptions[]>(
  definitions: T,
  shared: UseWebMCPToolsSharedOptions = {},
): UseWebMCPToolsReturn<ToolNames<T>> {
  const byName = {} as Record<string, UseWebMCPToolReturn>

  for (const definition of definitions) {
    const name = toValue(definition.name)
    if (isDev && name in byName) {
      warn(`useWebMCPTools() received the tool name "${name}" twice; the browser rejects duplicate registrations.`)
    }
    const { onError } = definition
    const merged: AnyToolOptions = {
      ...definition,
      enabled: definition.enabled ?? shared.enabled,
      annotations: definition.annotations ?? shared.annotations,
      exposedTo: definition.exposedTo ?? shared.exposedTo,
      onError:
        onError ?? (shared.onError ? error => shared.onError!(error, toValue(definition.name)) : undefined),
    }
    byName[name] = useWebMCPTool(merged)
  }

  const states = Object.values(byName)
  const isSupported = computed(() => states.some(state => state.isSupported.value))
  const isRegistered = computed(
    () => states.length > 0 && states.every(state => state.isRegistered.value),
  )
  const error = computed(() => states.map(state => state.error.value).find(Boolean) ?? null)

  return {
    isSupported: readonly(isSupported),
    isRegistered: readonly(isRegistered),
    error: readonly(error),
    byName: byName as Readonly<Record<ToolNames<T>, UseWebMCPToolReturn>>,
  }
}
