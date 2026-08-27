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
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
  execute: (args: unknown, options?: { signal: AbortSignal }) => unknown
}

export interface StubRegisteredTool {
  name: string
  title: string
  description: string
  inputSchema?: object
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
  /** Accepts an object (spec) or a JSON string (older Chrome); resolves with the result as JSON text. */
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
   * `{ content, isError }`. Not part of the spec.
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
 * unregisters is honoured, `getTools()` / `executeTool()` / `toolchange`
 * behave as the spec describes, and `names()` / `call()` are there for tests.
 */
export function installModelContextStub(host: StubHost = globalThis as StubHost): ModelContextStub {
  const tools = new Map<string, StubTool>()
  const context = new EventTarget() as ModelContextStub
  const changed = (): void => {
    context.dispatchEvent(new Event('toolchange'))
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
        annotations: tool.annotations,
        window: win,
        origin,
      }))

  context.executeTool = async (tool, args = {}, options = {}) => {
    const registered = tools.get(tool.name)
    if (!registered) throw new DOMException(`no tool "${tool.name}"`, 'NotFoundError')
    // A call made with an already-aborted signal never runs the tool.
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new DOMException('execution aborted', 'AbortError')
    }
    const input: unknown = typeof args === 'string' ? JSON.parse(args) : args
    const controller = new AbortController()
    options.signal?.addEventListener('abort', () => controller.abort(options.signal?.reason))
    const result = await registered.execute(input, { signal: controller.signal })
    return JSON.stringify(result)
  }

  context.names = () => [...tools.keys()].sort()

  context.call = async (name, args = {}, options = {}) => {
    const registered = tools.get(name)
    if (!registered) throw new Error(`no tool "${name}" is registered`)
    const signal = options.signal ?? new AbortController().signal
    return (await registered.execute(args, { signal })) as WebMCPToolResponse
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
