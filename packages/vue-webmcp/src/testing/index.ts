/**
 * A test double for `document.modelContext`.
 *
 * `installModelContextStub()` is written to be self-contained: it refers to
 * nothing outside its own body, so `MODEL_CONTEXT_INIT_SCRIPT` can be its
 * source as a string for Playwright's `addInitScript` or Puppeteer's
 * `evaluateOnNewDocument`. Keep it that way when editing.
 */
import type { WebMCPToolResponse } from '../types'

export interface StubTool {
  name: string
  title?: string
  description: string
  inputSchema?: object
  outputSchema?: object
  annotations?: {
    readOnlyHint?: boolean
    untrustedContentHint?: boolean
    consequentialHint?: boolean
    debugging?: boolean
  }
  execute: (args: unknown, options?: { signal: AbortSignal }) => unknown
}

export interface StubRegisteredTool {
  name: string
  title: string
  description: string
  inputSchema?: object
  outputSchema?: object
  annotations?: StubTool['annotations']
  window: unknown
  origin: string
}

export interface ModelContextStub extends EventTarget {
  /** Every currently registered tool, by name. */
  tools: Map<string, StubTool>
  registerTool(
    tool: StubTool,
    options?: { signal?: AbortSignal; exposedTo?: readonly string[] },
  ): Promise<void>
  getTools(options?: { fromOrigins?: readonly string[] }): Promise<StubRegisteredTool[]>
  /**
   * Accepts an object (spec) or a JSON string (Chrome before 155); resolves
   * with the result as JSON text. As in the spec, aborting `options.signal`
   * rejects at once with the abort reason and aborts the tool's own signal,
   * a failing tool rejects with an `OperationError` that does not carry the
   * tool's error, and an input that is not an object with a `DataError`.
   */
  executeTool(
    tool: { name: string },
    args?: object | string,
    options?: { signal?: AbortSignal },
  ): Promise<string>
  /** Sorted registered names. Not part of the spec. */
  names(): string[]
  /**
   * Call a tool the way an agent would and get its result back as the value
   * `execute` produced; through `useWebMCPTool` that is the normalized
   * `{ content, isError }`. Fires `toolactivated` and, if `options.signal`
   * aborts first, `toolcancel`, like `executeTool()`. Not part of the spec.
   */
  call(name: string, args?: object, options?: { signal?: AbortSignal }): Promise<WebMCPToolResponse>
}

interface StubHost {
  document?: object
  window?: unknown
  location?: { origin: string }
}

/**
 * Installs a stub `document.modelContext` on `host` (`globalThis` by default)
 * and returns it. Registrations are recorded, the `AbortSignal` that
 * unregisters is honoured, `getTools()` / `executeTool()` / `toolchange` /
 * `toolactivated` / `toolcancel` behave as the spec describes, and
 * `names()` / `call()` are there for tests.
 */
export function installModelContextStub(host: StubHost = globalThis as StubHost): ModelContextStub {
  const tools = new Map<string, StubTool>()
  const context = new EventTarget() as ModelContextStub
  const changed = (): void => {
    context.dispatchEvent(new Event('toolchange'))
  }
  // A plain Event with the name on it: ToolActivatedEvent and ToolCancelEvent
  // only exist in browsers that implement WebMCP, not in jsdom.
  const fire = (type: 'toolactivated' | 'toolcancel', toolName: string): void => {
    context.dispatchEvent(Object.assign(new Event(type), { toolName }))
  }
  const doc = host.document as (Record<string, unknown> & object) | undefined
  const win = host.window ?? host
  const origin = host.location?.origin ?? 'null'

  context.tools = tools

  context.registerTool = (tool, options = {}) => {
    if (tools.has(tool.name)) {
      return Promise.reject(
        new DOMException(`tool "${tool.name}" is already registered`, 'InvalidStateError'),
      )
    }
    // An already-aborted signal rejects with its reason, as the spec says.
    if (options.signal?.aborted) {
      return Promise.reject(
        options.signal.reason ?? new DOMException('registration aborted', 'AbortError'),
      )
    }
    tools.set(tool.name, tool)
    options.signal?.addEventListener('abort', () => {
      if (tools.get(tool.name) === tool) {
        tools.delete(tool.name)
        changed()
      }
    })
    changed()
    return Promise.resolve()
  }

  // Sorted by name in code-unit order, as the spec says.
  context.getTools = async () =>
    [...tools.values()]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(tool => ({
        name: tool.name,
        title: tool.title ?? '',
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
        annotations: tool.annotations,
        window: win,
        origin,
      }))

  context.executeTool = (tool, args = {}, options = {}) => {
    const { signal } = options
    const fail = (message: string, name: string): Promise<never> =>
      Promise.reject(new DOMException(message, name))
    // The signal comes first, as in the spec and Chromium: an already-aborted
    // call rejects with its reason whether or not the tool exists.
    if (signal?.aborted) return Promise.reject(signal.reason)
    const registered = tools.get(tool.name)
    if (!registered) return fail(`no tool "${tool.name}"`, 'NotFoundError')
    let input: unknown = args
    try {
      if (typeof args === 'string') input = JSON.parse(args)
    } catch {
      input = null
    }
    if (!input || typeof input !== 'object') {
      return fail('Failed to parse tool input arguments.', 'DataError')
    }

    const controller = new AbortController()
    let onAbort = (): void => {}
    // Cancelling settles the call at once with the caller's reason. The tool's
    // own signal aborts without one, so execute sees a plain AbortError as it
    // does in Chromium, and whatever the tool does next is ignored.
    const cancelled = new Promise<never>((_resolve, reject) => {
      if (!signal) return
      onAbort = () => {
        reject(signal.reason)
        controller.abort()
        fire('toolcancel', tool.name)
      }
      signal.addEventListener('abort', onAbort)
    })
    // An async wrapper, so execute runs now and a synchronous throw rejects.
    const run = (async () => registered.execute(input, { signal: controller.signal }))()
    // After invoking execute, which is the order Chromium uses.
    fire('toolactivated', tool.name)
    // Only the exception name reaches the caller, as in the spec; the message
    // is Chromium's. A finished call stops listening to a long-lived signal.
    const result = run
      .then(value => JSON.stringify(value))
      .catch(() => {
        throw new DOMException('Tool execution failed.', 'OperationError')
      })
      .finally(() => signal?.removeEventListener('abort', onAbort))
    return Promise.race([cancelled, result])
  }

  context.names = () => [...tools.keys()].sort()

  context.call = async (name, args = {}, options = {}) => {
    const registered = tools.get(name)
    if (!registered) throw new Error(`no tool "${name}" is registered`)
    const signal = options.signal ?? new AbortController().signal
    const cancelled = (): void => fire('toolcancel', name)
    signal.addEventListener('abort', cancelled, { once: true })
    try {
      const pending = registered.execute(args, { signal })
      fire('toolactivated', name)
      return (await pending) as WebMCPToolResponse
    } finally {
      signal.removeEventListener('abort', cancelled)
    }
  }

  if (doc) {
    Object.defineProperty(doc, 'modelContext', {
      value: context,
      configurable: true,
      writable: true,
    })
  }
  return context
}

/** Removes a stub installed by `installModelContextStub()`. */
export function uninstallModelContextStub(host: StubHost = globalThis as StubHost): void {
  const doc = host.document as Record<string, unknown> | undefined
  if (doc) delete doc.modelContext
}

/**
 * `installModelContextStub` as a script, for Playwright's
 * `context.addInitScript(MODEL_CONTEXT_INIT_SCRIPT)` or Puppeteer's
 * `page.evaluateOnNewDocument(MODEL_CONTEXT_INIT_SCRIPT)`, so the stub is in
 * place before any page script runs. The page can then reach it as
 * `document.modelContext` and its `names()` / `call()` helpers.
 *
 * The string is the function's source as published. Import it from Node
 * (a Playwright fixture, a vitest setup file); a bundler that re-transforms
 * this package with name-keeping helpers (`__name`) would leave those in
 * the string, which a page without them cannot run.
 */
export const MODEL_CONTEXT_INIT_SCRIPT = `(${installModelContextStub.toString()})(globalThis);`
