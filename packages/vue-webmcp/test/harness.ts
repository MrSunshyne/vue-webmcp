/**
 * Fake `document.modelContext`, mirroring the explainer and Chrome's
 * implementation: registerTool + AbortSignal unregistration on the provider
 * side, getTools / executeTool / the toolchange event on the consumer side.
 *
 * Derived from the use-webmcp-tool test harness
 * (https://github.com/GoogleChromeLabs/use-webmcp-tool),
 * Copyright 2026 Google LLC, Apache-2.0. See NOTICE at the repository root.
 */
import { vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import type {
  ExecuteToolOptions,
  GetToolsOptions,
  ModelContext,
  RegisteredTool,
  RegisterToolOptions,
  WebMCPToolDescriptor,
} from '../src/types'

export class FakeModelContext extends EventTarget implements ModelContext {
  readonly tools = new Map<string, WebMCPToolDescriptor>()

  readonly registerTool = vi.fn((tool: WebMCPToolDescriptor, options: RegisterToolOptions = {}) => {
    this.tools.set(tool.name, tool)
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        if (this.tools.get(tool.name) === tool) {
          this.tools.delete(tool.name)
          this.dispatchEvent(new Event('toolchange'))
        }
      })
    }
    this.dispatchEvent(new Event('toolchange'))
  })

  // Alphabetical, like Chrome. `window` and `origin` are this document's.
  readonly getTools = vi.fn(async (_options: GetToolsOptions = {}): Promise<RegisteredTool[]> =>
    [...this.tools.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(tool => ({
        name: tool.name,
        title: tool.title ?? '',
        description: tool.description,
        inputSchema: tool.inputSchema,
        window,
        origin: location.origin,
        annotations: tool.annotations,
      })),
  )

  // Accepts an object (spec) or a JSON string (older Chrome) and returns the
  // tool's result serialized to JSON, as the spec does.
  readonly executeTool = vi.fn(
    async (tool: RegisteredTool, args: object | string = {}, options: ExecuteToolOptions = {}) => {
      const registered = this.tools.get(tool.name)
      if (!registered) throw new DOMException(`no tool "${tool.name}"`, 'NotFoundError')
      const input = typeof args === 'string' ? JSON.parse(args) : args
      const controller = new AbortController()
      options.signal?.addEventListener('abort', () => controller.abort(options.signal?.reason))
      const result = await registered.execute(input, { signal: controller.signal })
      return JSON.stringify(result)
    },
  )
}

// The real property is readonly and typed as the full spec interface; the
// fake needs to be installed and removed. Viewed through the package's own
// narrow ModelContext, both are assignable.
function host(target: 'document' | 'navigator'): { modelContext?: ModelContext } {
  return target === 'document' ? document : navigator
}

export function installFakeModelContext(target: 'document' | 'navigator' = 'document') {
  const context = new FakeModelContext()
  host(target).modelContext = context
  return { context, tools: context.tools, registerTool: context.registerTool }
}

/** A provider-only context, like a polyfill that lacks the consumer side. */
export function installRegisterOnlyModelContext() {
  const { context } = installFakeModelContext()
  host('document').modelContext = { registerTool: context.registerTool }
  return { tools: context.tools, registerTool: context.registerTool }
}

export function cleanupModelContext(): void {
  delete host('document').modelContext
  delete host('navigator').modelContext
}

export function mountComposable<T>(setup: () => T) {
  let result: T | undefined
  const app = createApp(
    defineComponent({
      setup() {
        result = setup()
        return () => h('div')
      },
    }),
  )
  app.mount(document.createElement('div'))
  return { result: result as T, unmount: () => app.unmount() }
}
