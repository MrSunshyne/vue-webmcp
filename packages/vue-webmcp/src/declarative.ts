/**
 * The declarative half of WebMCP: a `<form toolname>` the browser turns into
 * a tool. Chrome adds `agentInvoked` and `respondWith()` to `SubmitEvent`,
 * fires `toolactivated` / `toolcancel` on `window` as `WebMCPEvent`s carrying
 * a `toolName`, and styles the form with `:tool-form-active` while an agent
 * fills it in. https://developer.chrome.com/docs/ai/webmcp/declarative-api
 *
 * None of that is in `webmcp-types` yet. The declarations below use the
 * shapes Chromium implements (`submit_event.idl`, `web_mcp_event.idl`), so
 * they merge cleanly once lib.dom or webmcp-types declare the same.
 */
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
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import { injectWebMCPConfig } from './config'
import type { WebMCPConfig } from './config'
import { emitHook, now, toError } from './context'
import { toErrorResponse, toToolResponse } from './normalize'

declare global {
  interface SubmitEvent {
    /** True when an agent submitted the form through its WebMCP tool. */
    readonly agentInvoked: boolean
    /**
     * Hands the agent the tool result: the resolved value is serialized and
     * returned to the model. Call `preventDefault()` first, and call it while
     * the event is being dispatched.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Chromium's IDL is Promise<any>
    respondWith(agentResponse: Promise<any>): void
  }

  /** `toolactivated` / `toolcancel` on `window`; neither bubbles nor cancels. */
  interface WebMCPEvent extends Event {
    readonly toolName: string
  }

  interface WindowEventMap {
    toolactivated: WebMCPEvent
    toolcancel: WebMCPEvent
  }
}

/** One entry, or every entry when a name repeats (a checkbox group, `<select multiple>`). */
export type FormFieldValue = FormDataEntryValue | FormDataEntryValue[]
export type FormFields = Record<string, FormFieldValue>

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
  /**
   * An agent is filling the form in (`toolactivated` until `toolcancel` or
   * submit). Stays `false` for an autosubmit form, which the browser submits
   * before it activates; `isSubmitting` covers that call.
   */
  isAgentActive: Readonly<Ref<boolean>>
  isSubmitting: Readonly<Ref<boolean>>
  /** What the last submission threw, until the next one. */
  error: Readonly<Ref<Error | null>>
}

// The browser types a repeated name as an array in the synthesized schema
// and an agent submits one, so keep every entry for those.
function readFields(form: HTMLFormElement): FormFields {
  const fields: FormFields = {}
  const data = new FormData(form)
  data.forEach((_value, key) => {
    if (Object.hasOwn(fields, key)) return
    const all = data.getAll(key)
    fields[key] = all.length > 1 ? all : all[0]!
  })
  return fields
}

/**
 * Wires a declarative WebMCP form: sets `toolname` / `tooldescription`,
 * answers an agent's submission through `respondWith()`, and tracks whether
 * an agent is currently filling the form in. The same handler serves a
 * person clicking Submit, so the form's `action` never navigates.
 */
export function useWebMCPForm<Fields extends FormFields = FormFields, Result = unknown>(
  options: UseWebMCPFormOptions<Fields, Result>,
): UseWebMCPFormReturn {
  const isAgentActive = ref(false)
  // Chromium dispatches `submit` before `toolactivated` for a `toolautosubmit`
  // form, and dispatches no `toolcancel` for one, so an activation can arrive
  // after the submission it belongs to has been handled. An agent submission
  // that starts with no activation in progress therefore owes this form one
  // `toolactivated`, which `onActivated` consumes instead of setting the flag.
  // Nothing is owed when the activation arrives first, so the pairing holds if
  // the two events ever swap order. See issue #29.
  let activationOwed = false
  const isSubmitting = ref(false)
  const error = ref<Error | null>(null)

  // The app-level call hooks see form submissions too; the character-budget
  // checks do not apply, the browser derives a form tool's description from
  // its attributes.
  const provided = injectWebMCPConfig()
  const config: WebMCPConfig | null = provided ? { ...provided } : null

  async function onSubmit(event: Event): Promise<void> {
    // A component emitting something other than an Event has nothing to submit.
    if (!(event instanceof Event)) return
    const submit = event as SubmitEvent
    // Required before respondWith(); harmless when @submit.prevent did it.
    event.preventDefault()
    const target = event.currentTarget ?? event.target
    const fields = (target instanceof HTMLFormElement ? readFields(target) : {}) as Fields
    const name = toValue(options.name)
    const argsPayload = config?.includeArgs ? { args: fields } : {}
    emitHook(config?.onToolCall, { name, ...argsPayload })
    const started = now()

    // Synchronously, before any await: for an autosubmit form the activation
    // lands in a later task, which for a slow `execute` is while it still runs.
    if (submit.agentInvoked && !isAgentActive.value) activationOwed = true

    isSubmitting.value = true
    error.value = null
    const work = (async () => {
      const result = await options.execute(fields, submit)
      const shaped = options.formatOutput ? options.formatOutput(result, fields) : result
      if (shaped instanceof Error) throw shaped
      return toToolResponse(shaped)
    })()
    // What the agent gets: a failure becomes an isError result, the same as
    // for an imperative tool. Attached before anything can throw, so no
    // rejection is ever left unhandled.
    const answer = work.catch(err => toErrorResponse(err))

    let failure: unknown
    let failed = false
    try {
      // Synchronously, during dispatch: the browser rejects a later call.
      if (submit.agentInvoked && typeof submit.respondWith === 'function') {
        submit.respondWith(answer)
      }
      await work
    } catch (err) {
      failed = true
      failure = err
      error.value = toError(err)
      options.onError?.(err)
    } finally {
      isSubmitting.value = false
      isAgentActive.value = false
    }

    const response = await answer
    emitHook(config?.onToolResult, {
      name,
      ok: !failed && !response.isError,
      ms: now() - started,
      response,
      ...(failed ? { error: failure } : {}),
      ...argsPayload,
    })
  }

  const attrs = computed<WebMCPFormAttrs>(() => ({
    toolname: toValue(options.name),
    tooldescription: toValue(options.description),
    ...(toValue(options.autosubmit) ? { toolautosubmit: '' as const } : {}),
    onSubmit,
  }))

  // Activation events fire on window and carry the tool name. Inside a
  // component, wait for mount as the other composables do; elsewhere
  // (a store, an effectScope) listen now.
  if (typeof window !== 'undefined') {
    const matches = (event: WebMCPEvent): boolean => event.toolName === toValue(options.name)
    const onActivated = (event: WebMCPEvent): void => {
      if (!matches(event)) return
      // The tail of an autosubmit call this form has already answered.
      if (activationOwed) {
        activationOwed = false
        return
      }
      isAgentActive.value = true
    }
    const onCancel = (event: WebMCPEvent): void => {
      if (!matches(event)) return
      activationOwed = false
      isAgentActive.value = false
    }
    const listen = (): void => {
      window.addEventListener('toolactivated', onActivated)
      window.addEventListener('toolcancel', onCancel)
    }
    if (getCurrentInstance()) {
      onMounted(listen)
    } else {
      listen()
    }
    if (getCurrentScope()) {
      onScopeDispose(() => {
        window.removeEventListener('toolactivated', onActivated)
        window.removeEventListener('toolcancel', onCancel)
      })
      // A renamed form is a different tool to the browser.
      watch(
        () => toValue(options.name),
        () => {
          activationOwed = false
          isAgentActive.value = false
        },
      )
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
