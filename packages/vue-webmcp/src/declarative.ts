/**
 * The declarative half of WebMCP: a `<form toolname>` the browser turns into
 * a tool. Chrome adds `agentInvoked` and `respondWith()` to `SubmitEvent`,
 * fires `toolactivated` / `toolcancel` on `window` with a `toolName`, and
 * styles the form with `:tool-form-active` while an agent fills it in.
 * https://developer.chrome.com/docs/ai/webmcp/declarative-api
 *
 * None of that is in `webmcp-types` yet, so the types are declared here.
 */
import { computed, getCurrentScope, onMounted, onScopeDispose, readonly, ref, toValue } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import { toError } from './context'
import { toErrorResponse, toToolResponse } from './normalize'

declare global {
  interface SubmitEvent {
    /** True when an agent submitted the form through its WebMCP tool. */
    readonly agentInvoked?: boolean
    /**
     * Hands the agent the tool result: the resolved value is serialized and
     * returned to the model. Call `preventDefault()` first.
     */
    respondWith?(response: Promise<unknown>): void
  }

  /** `toolactivated` / `toolcancel` on `window`; neither bubbles nor cancels. */
  interface ToolActivationEvent extends Event {
    readonly toolName: string
  }

  interface WindowEventMap {
    toolactivated: ToolActivationEvent
    toolcancel: ToolActivationEvent
  }
}

export type FormFields = Record<string, FormDataEntryValue>

export interface UseWebMCPFormOptions<Fields extends FormFields = FormFields, Result = unknown> {
  /** The form's `toolname`. */
  name: MaybeRefOrGetter<string>
  /** The form's `tooldescription`. */
  description: MaybeRefOrGetter<string>
  /** Let the agent submit without a click (`toolautosubmit`). */
  autosubmit?: MaybeRefOrGetter<boolean>
  /**
   * Handles a submission, by a person or by an agent, with the form's fields
   * as `FormData` entries. The return value is normalized like a
   * `useWebMCPTool` result and handed to the agent when one asked.
   */
  execute: (fields: Fields, event: SubmitEvent) => Result | Promise<Result>
  /** Optional shaper applied to the result before normalization. */
  formatOutput?: (result: Result, fields: Fields) => unknown
  /** Side effect when `execute` throws; the failure also lands in `error`. */
  onError?: (error: unknown) => void
}

export interface WebMCPFormAttrs {
  toolname: string
  tooldescription: string
  toolautosubmit?: ''
  onSubmit: (event: Event) => Promise<void>
}

export interface UseWebMCPFormReturn {
  /** Spread onto the form: `<form v-bind="attrs">`. */
  attrs: ComputedRef<WebMCPFormAttrs>
  /** The submit handler on its own, for a form that sets the attributes itself. */
  onSubmit: (event: Event) => Promise<void>
  /** An agent is filling the form in (`toolactivated` until `toolcancel` or submit). */
  isAgentActive: Readonly<Ref<boolean>>
  isSubmitting: Readonly<Ref<boolean>>
  /** What `execute` last threw, until the next submission. */
  error: Readonly<Ref<Error | null>>
}

/**
 * Wires a declarative WebMCP form: sets `toolname` / `tooldescription`,
 * answers an agent's submission through `respondWith()`, and tracks whether
 * an agent is currently filling the form in. The same handler serves a
 * person clicking Submit.
 */
export function useWebMCPForm<Fields extends FormFields = FormFields, Result = unknown>(
  options: UseWebMCPFormOptions<Fields, Result>,
): UseWebMCPFormReturn {
  const isAgentActive = ref(false)
  const isSubmitting = ref(false)
  const error = ref<Error | null>(null)

  async function onSubmit(event: Event): Promise<void> {
    const submit = event as SubmitEvent
    // Required before respondWith(); harmless when @submit.prevent did it.
    event.preventDefault()
    const form = (event.currentTarget ?? event.target) as HTMLFormElement | null
    // forEach rather than Object.fromEntries: the DOM lib without DOM.Iterable
    // does not type FormData as iterable.
    const entries: Record<string, FormDataEntryValue> = {}
    if (form) new FormData(form).forEach((value, key) => (entries[key] = value))
    const fields = entries as Fields

    isSubmitting.value = true
    error.value = null
    const work = (async () => {
      const result = await options.execute(fields, submit)
      const shaped = options.formatOutput ? options.formatOutput(result, fields) : result
      if (shaped instanceof Error) throw shaped
      return toToolResponse(shaped)
    })()

    // The agent gets its answer synchronously, before anything is awaited: a
    // failure becomes an isError result, the same as an imperative tool.
    if (submit.agentInvoked && typeof submit.respondWith === 'function') {
      submit.respondWith(work.catch(err => toErrorResponse(err)))
    }

    try {
      await work
    } catch (err) {
      error.value = toError(err)
      options.onError?.(err)
    } finally {
      isSubmitting.value = false
      isAgentActive.value = false
    }
  }

  const attrs = computed<WebMCPFormAttrs>(() => ({
    toolname: toValue(options.name),
    tooldescription: toValue(options.description),
    ...(toValue(options.autosubmit) ? { toolautosubmit: '' as const } : {}),
    onSubmit,
  }))

  // Activation events fire on window and carry the tool name.
  if (typeof window !== 'undefined') {
    const onActivated = (event: ToolActivationEvent): void => {
      if (event.toolName === toValue(options.name)) isAgentActive.value = true
    }
    const onCancel = (event: ToolActivationEvent): void => {
      if (event.toolName === toValue(options.name)) isAgentActive.value = false
    }
    const listen = (): void => {
      window.addEventListener('toolactivated', onActivated)
      window.addEventListener('toolcancel', onCancel)
    }
    // Inside a component, wait for mount as the other composables do.
    if (getCurrentScope()) {
      onMounted(listen)
      onScopeDispose(() => {
        window.removeEventListener('toolactivated', onActivated)
        window.removeEventListener('toolcancel', onCancel)
      })
    } else {
      listen()
    }
  }

  return {
    attrs,
    onSubmit,
    isAgentActive: readonly(isAgentActive),
    isSubmitting: readonly(isSubmitting),
    error: readonly(error),
  }
}
