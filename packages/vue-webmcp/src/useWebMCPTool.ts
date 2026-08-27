import {
  computed,
  getCurrentInstance,
  getCurrentScope,
  onMounted,
  onScopeDispose,
  readonly,
  ref,
  toValue,
  watch,
} from 'vue'
import type { MaybeRefOrGetter, Ref } from 'vue'
import { isDev, pollForModelContext, resolveModelContext, toError, warn } from './context'
import { toErrorResponse, toToolResponse } from './normalize'
import type {
  WebMCPToolAnnotations,
  WebMCPToolDescriptor,
  WebMCPToolExecuteOptions,
  WebMCPToolResponse,
} from './types'

export interface UseWebMCPToolOptions<Args = Record<string, unknown>, Result = unknown> {
  /**
   * Tool identifier the agent sees. 1–128 characters of `[a-zA-Z0-9_.-]`;
   * Chrome's guidance is at most 30.
   */
  name: MaybeRefOrGetter<string>
  /** Human-readable label for user-agent UI. Agents reason over `name` and `description`. */
  title?: MaybeRefOrGetter<string | null | undefined>
  /** Natural-language description for the agent. Chrome's guidance: keep under 500 characters. */
  description: MaybeRefOrGetter<string>
  /** JSON Schema for the tool arguments. Compared by content, not identity. */
  inputSchema?: MaybeRefOrGetter<object | undefined>
  annotations?: MaybeRefOrGetter<WebMCPToolAnnotations | undefined>
  /**
   * Secure origins (for example an iframe-hosted agent) that may discover and
   * call the tool, in addition to the registering page, its same-origin
   * frames, and the browser's own agent.
   */
  exposedTo?: MaybeRefOrGetter<readonly string[] | undefined>
  /**
   * Runs when the agent invokes the tool. Reads reactive state live at call
   * time; swapping the function never re-registers the tool.
   *
   * `options.signal` aborts when the caller cancels the execution or goes
   * away: hand it to `fetch` and other cancellable work.
   */
  execute: (args: Args, options: WebMCPToolExecuteOptions) => Result | Promise<Result>
  /** Register only while true. May be a ref or getter — the tool follows it reactively. */
  enabled?: MaybeRefOrGetter<boolean>
  /** Optional shaper applied to the result before MCP normalization. */
  formatOutput?: (result: Result, args: Args) => unknown
  /**
   * Side effect when `execute` throws or returns an `Error`. The agent still
   * receives an `isError` response afterwards.
   */
  onError?: (error: unknown) => void
}

export interface UseWebMCPToolReturn {
  /** A modelContext API exists in this environment. Flips reactively if injected late. */
  isSupported: Readonly<Ref<boolean>>
  /** The tool is currently registered with the browser. */
  isRegistered: Readonly<Ref<boolean>>
  /** Registration failure, e.g. `NotAllowedError` from a `tools` Permissions Policy. */
  error: Readonly<Ref<Error | null>>
}

const TOOL_NAME_PATTERN = /^[\w.-]{1,128}$/
// Chrome's guidance for what a model reads well:
// https://developer.chrome.com/docs/ai/webmcp/secure-tools
const NAME_BUDGET = 30
const DESCRIPTION_BUDGET = 500
const PARAM_DESCRIPTION_BUDGET = 150
const OUTPUT_BUDGET = 1500

// Advisory only (dev builds): mirrors the spec's name grammar and Chrome's
// character budgets for descriptions. Never blocks registration.
function validateDescriptor(descriptor: WebMCPToolDescriptor): void {
  if (!TOOL_NAME_PATTERN.test(descriptor.name)) {
    warn(
      `tool name "${descriptor.name}" is outside the spec grammar (1-128 characters of [a-zA-Z0-9_.-]); browsers may reject it.`,
    )
  } else if (descriptor.name.length > NAME_BUDGET) {
    warn(
      `tool name "${descriptor.name}" is ${descriptor.name.length} characters; Chrome's guidance is <= ${NAME_BUDGET}.`,
    )
  }
  if (descriptor.description.length > DESCRIPTION_BUDGET) {
    warn(
      `tool "${descriptor.name}" has a ${descriptor.description.length}-character description; Chrome's guidance is <= ${DESCRIPTION_BUDGET}.`,
    )
  }
  const properties = (descriptor.inputSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties
  if (!properties) return
  for (const [param, schema] of Object.entries(properties)) {
    if (param.length > NAME_BUDGET) {
      warn(
        `tool "${descriptor.name}" param "${param}" has a ${param.length}-character name; Chrome's guidance is <= ${NAME_BUDGET}.`,
      )
    }
    const description = (schema as { description?: unknown } | null)?.description
    if (typeof description === 'string' && description.length > PARAM_DESCRIPTION_BUDGET) {
      warn(
        `tool "${descriptor.name}" param "${param}" has a ${description.length}-character description; Chrome's guidance is <= ${PARAM_DESCRIPTION_BUDGET}.`,
      )
    }
  }
}

/**
 * Registers a WebMCP tool with the browser and ties its lifetime to the
 * current component or effect scope, so the set of tools an agent sees stays
 * in lockstep with what is actually on screen.
 *
 * Feature-detects `document.modelContext` and degrades to a no-op everywhere
 * the API is absent, including during SSR.
 */
export function useWebMCPTool<Args = Record<string, unknown>, Result = unknown>(
  options: UseWebMCPToolOptions<Args, Result>,
): UseWebMCPToolReturn {
  const isSupported = ref(false)
  const isRegistered = ref(false)
  const error = ref<Error | null>(null)

  const state: UseWebMCPToolReturn = {
    isSupported: readonly(isSupported),
    isRegistered: readonly(isRegistered),
    error: readonly(error),
  }

  // Server render: stay inert. The same call in the client app registers the
  // tool after mount, so no hydration mismatch and no `document` access here.
  if (typeof window === 'undefined') {
    return state
  }

  let controller: AbortController | null = null
  let stopPoll: (() => void) | null = null
  let started = false
  let warnedLegacy = false
  let warnedOutput = false

  // Advisory, dev only, once per composable instance (a rename does not reset
  // it; the output comes from the same execute). Chrome's guidance caps a
  // successful tool result at 1.5K characters of text. Like the descriptor
  // checks this counts UTF-16 code units, so astral characters count twice.
  // A pass-through result is not validated, hence the optional chaining: the
  // check must never turn a result the browser would accept into an error.
  function checkOutputBudget(response: WebMCPToolResponse): void {
    if (warnedOutput) return
    const size = response.content.reduce(
      (total, block) => total + (typeof block?.text === 'string' ? block.text.length : 0),
      0,
    )
    if (size > OUTPUT_BUDGET) {
      warnedOutput = true
      warn(
        `tool "${toValue(options.name)}" returned ${size} characters of text; Chrome's guidance is <= ${OUTPUT_BUDGET} per call.`,
      )
    }
  }

  // Only what the browser receives at registration re-registers the tool,
  // compared by content so inline object literals and reactive sources don't
  // churn on every change that serializes identically.
  const registrationKey = computed(() =>
    JSON.stringify([
      toValue(options.name),
      toValue(options.title) ?? null,
      toValue(options.description),
      toValue(options.inputSchema) ?? null,
      toValue(options.annotations) ?? null,
      toValue(options.exposedTo) ?? null,
      toValue(options.enabled ?? true),
    ]),
  )

  async function runTool(args: unknown, callOptions?: WebMCPToolExecuteOptions) {
    // Browsers before Chrome 153 call execute without options. Supply a signal
    // that never aborts so user code can rely on the spec signature everywhere.
    const executeOptions = callOptions?.signal
      ? callOptions
      : { signal: new AbortController().signal }
    try {
      const result = await options.execute(args as Args, executeOptions)
      const shaped = options.formatOutput ? options.formatOutput(result, args as Args) : result
      // A returned Error gets the same treatment as a thrown one:
      // `onError`, then an `isError` result.
      if (shaped instanceof Error) throw shaped
      const response = toToolResponse(shaped)
      if (isDev) checkOutputBudget(response)
      return response
    } catch (err) {
      options.onError?.(err)
      return toErrorResponse(err)
    }
  }

  function stopPolling(): void {
    stopPoll?.()
    stopPoll = null
  }

  function startPolling(): void {
    stopPoll ??= pollForModelContext(() => {
      stopPoll = null
      register()
    })
  }

  // Aborting the signal is how WebMCP unregisters a tool.
  function unregister(): void {
    if (controller) {
      controller.abort()
      controller = null
    }
    isRegistered.value = false
  }

  function register(): void {
    unregister()

    const resolved = resolveModelContext()
    if (!resolved) {
      isSupported.value = false
      error.value = null
      startPolling()
      return
    }

    stopPolling()
    isSupported.value = true

    if (isDev && resolved.legacy && !warnedLegacy) {
      warnedLegacy = true
      warn(
        'using the deprecated navigator.modelContext (pre-Chrome-150); this environment predates the document.modelContext rename.',
      )
    }

    if (!toValue(options.enabled ?? true)) {
      error.value = null
      return
    }

    // `null` from a JS caller must not reach the browser: WebIDL would turn
    // it into the label "null". The key above already treats it as unset.
    const title = toValue(options.title)
    const descriptor: WebMCPToolDescriptor = {
      name: toValue(options.name),
      ...(title != null ? { title } : {}),
      description: toValue(options.description),
      inputSchema: toValue(options.inputSchema),
      annotations: toValue(options.annotations),
      execute: runTool,
    }
    if (isDev) validateDescriptor(descriptor)

    const exposedTo = toValue(options.exposedTo)
    const own = new AbortController()
    controller = own
    try {
      // Copy so the browser gets a plain array, not a reactive proxy.
      const result = resolved.context.registerTool(descriptor, {
        signal: own.signal,
        ...(exposedTo !== undefined ? { exposedTo: [...exposedTo] } : {}),
      })
      // The spec makes registerTool promise-returning; surface an async
      // rejection instead of leaving it unhandled.
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        ;(result as Promise<unknown>).then(undefined, (err: unknown) => {
          if (controller !== own) return
          isRegistered.value = false
          error.value = toError(err)
        })
      }
      isRegistered.value = true
      error.value = null
    } catch (err) {
      // e.g. NotAllowedError when the `tools` permissions policy is disabled.
      controller = null
      isRegistered.value = false
      error.value = toError(err)
    }
  }

  function start(): void {
    if (started) return
    started = true
    register()
  }

  watch(registrationKey, () => {
    if (started) register()
  })

  // Inside a component, wait for mount so server-rendered markup hydrates
  // against identical state. Elsewhere (Pinia store, effectScope) start now.
  if (getCurrentInstance()) {
    onMounted(start)
  } else {
    start()
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      stopPolling()
      unregister()
    })
  }

  return state
}
