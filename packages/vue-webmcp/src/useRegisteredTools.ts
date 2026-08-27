import {
  computed,
  getCurrentInstance,
  getCurrentScope,
  onMounted,
  onScopeDispose,
  readonly,
  ref,
  shallowReadonly,
  shallowRef,
  toValue,
  watch,
} from 'vue'
import type { MaybeRefOrGetter, Ref, ShallowRef } from 'vue'
import { isDev, pollForModelContext, resolveModelContext, toError, warn } from './context'
import type { ModelContext, RegisteredTool } from './types'

export interface UseRegisteredToolsOptions {
  /**
   * Origins whose tools to include on top of the same-origin default. Each
   * must be a secure origin whose document listed this page in `exposedTo`.
   */
  fromOrigins?: MaybeRefOrGetter<readonly string[] | undefined>
  /**
   * How to hand arguments to `executeTool()`. The spec takes an object;
   * Chrome builds that predate spec PR #246 (2026-08-17) take a JSON string.
   * Default `'object'`.
   */
  argumentFormat?: 'object' | 'json'
}

export interface ExecuteRegisteredToolOptions {
  /** Aborts the execution; the tool's `execute` sees it through its own signal. */
  signal?: AbortSignal
}

export interface UseRegisteredToolsReturn {
  /** `getTools()` and `executeTool()` exist here. Flips reactively if injected late. */
  isSupported: Readonly<Ref<boolean>>
  /** Tools this document may call, in the browser's order, refreshed on `toolchange`. */
  tools: Readonly<ShallowRef<readonly RegisteredTool[]>>
  /** Failure of the last `getTools()` call. */
  error: Readonly<Ref<Error | null>>
  /** Query `getTools()` again. Runs by itself on every `toolchange` event. */
  refresh: () => Promise<void>
  /**
   * Run a discovered tool in its owner's document. Resolves with the tool's
   * result parsed from the JSON the browser returns, so an MCP-shaped result
   * comes back as `{ content: [...] }`.
   */
  execute: (
    tool: RegisteredTool,
    args?: object,
    options?: ExecuteRegisteredToolOptions,
  ) => Promise<unknown>
}

// `getTools()` returned a stringified schema before spec PR #241 (2026-08-14).
function normalizeTool(tool: RegisteredTool): RegisteredTool {
  const schema: unknown = tool.inputSchema
  if (typeof schema !== 'string') return tool
  try {
    return { ...tool, inputSchema: JSON.parse(schema) as object }
  } catch {
    return tool
  }
}

// The spec resolves `executeTool()` with the tool's result serialized to
// JSON; polyfills tend to resolve with the value itself.
function parseResult(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function hasConsumerApi(
  context: ModelContext,
): context is ModelContext & Required<Pick<ModelContext, 'getTools' | 'executeTool'>> {
  return typeof context.getTools === 'function' && typeof context.executeTool === 'function'
}

/**
 * Lists the WebMCP tools this document may call and lets it run them, for
 * in-page agents, dev panels, or an iframe-hosted agent reading a partner
 * page's tools. Follows the `toolchange` event, so the list stays current as
 * components register and unregister tools.
 *
 * Feature-detects `document.modelContext.getTools` and stays empty where the
 * consumer side of the API is absent, including during SSR.
 */
export function useRegisteredTools(options: UseRegisteredToolsOptions = {}): UseRegisteredToolsReturn {
  const isSupported = ref(false)
  const tools = shallowRef<readonly RegisteredTool[]>([])
  const error = ref<Error | null>(null)

  const state: UseRegisteredToolsReturn = {
    isSupported: readonly(isSupported),
    tools: shallowReadonly(tools),
    error: readonly(error),
    refresh,
    execute,
  }

  // Server render: stay inert, like useWebMCPTool.
  if (typeof window === 'undefined') {
    return state
  }

  let context: (ModelContext & Required<Pick<ModelContext, 'getTools' | 'executeTool'>>) | null =
    null
  let stopPoll: (() => void) | null = null
  let started = false
  let listening = false
  // Bumped per query so a slow older response cannot overwrite a newer one.
  let requestId = 0

  const fromOriginsKey = computed(() => JSON.stringify(toValue(options.fromOrigins) ?? null))

  async function refresh(): Promise<void> {
    if (!context) return
    const id = ++requestId
    const fromOrigins = toValue(options.fromOrigins)
    try {
      // Copy so the browser gets a plain array, not a reactive proxy.
      const list = await context.getTools(
        fromOrigins !== undefined ? { fromOrigins: [...fromOrigins] } : {},
      )
      if (id !== requestId) return
      tools.value = list.map(normalizeTool)
      error.value = null
    } catch (err) {
      if (id !== requestId) return
      error.value = toError(err)
    }
  }

  async function execute(
    tool: RegisteredTool,
    args: object = {},
    executeOptions: ExecuteRegisteredToolOptions = {},
  ): Promise<unknown> {
    if (!context) {
      throw new Error('[vue-webmcp] executeTool() is not available in this environment.')
    }
    const payload = options.argumentFormat === 'json' ? JSON.stringify(args) : args
    const raw = await context.executeTool(
      tool,
      payload,
      executeOptions.signal ? { signal: executeOptions.signal } : {},
    )
    return parseResult(raw)
  }

  const onToolChange = (): void => {
    void refresh()
  }

  function connect(): void {
    const resolved = resolveModelContext()
    if (!resolved) {
      isSupported.value = false
      stopPoll ??= pollForModelContext(() => {
        stopPoll = null
        connect()
      })
      return
    }
    if (!hasConsumerApi(resolved.context)) {
      // A provider-only build or polyfill: registration works, discovery does not.
      isSupported.value = false
      if (isDev) {
        warn('this modelContext has no getTools()/executeTool(); useRegisteredTools() stays empty.')
      }
      return
    }
    context = resolved.context
    isSupported.value = true
    if (!listening && typeof context.addEventListener === 'function') {
      context.addEventListener('toolchange', onToolChange)
      listening = true
    }
    void refresh()
  }

  function disconnect(): void {
    stopPoll?.()
    stopPoll = null
    if (listening) context?.removeEventListener?.('toolchange', onToolChange)
    listening = false
    // Drop any in-flight query so it cannot land after disposal.
    requestId++
  }

  function start(): void {
    if (started) return
    started = true
    connect()
  }

  watch(fromOriginsKey, () => {
    if (started) void refresh()
  })

  // Inside a component, wait for mount so server-rendered markup hydrates
  // against identical state. Elsewhere (Pinia store, effectScope) start now.
  if (getCurrentInstance()) {
    onMounted(start)
  } else {
    start()
  }

  if (getCurrentScope()) {
    onScopeDispose(disconnect)
  }

  return state
}
