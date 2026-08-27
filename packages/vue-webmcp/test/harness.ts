/**
 * Fake provider side of `document.modelContext`: registerTool + AbortSignal
 * unregistration, mirroring the explainer and Chrome's implementation.
 *
 * Derived from the use-webmcp-tool test harness
 * (https://github.com/GoogleChromeLabs/use-webmcp-tool),
 * Copyright 2026 Google LLC, Apache-2.0. See NOTICE at the repository root.
 */
import { vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import type { ModelContext, RegisterToolOptions, WebMCPToolDescriptor } from '../src/types'

// The real property is readonly and typed as the full spec interface; the
// fake only implements registerTool and needs to be installed and removed.
// Viewed through the package's own narrow ModelContext, both are assignable.
function host(target: 'document' | 'navigator'): { modelContext?: ModelContext } {
  return target === 'document' ? document : navigator
}

export function installFakeModelContext(target: 'document' | 'navigator' = 'document') {
  const tools = new Map<string, WebMCPToolDescriptor>()
  const registerTool = vi.fn((tool: WebMCPToolDescriptor, options: RegisterToolOptions = {}) => {
    tools.set(tool.name, tool)
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        if (tools.get(tool.name) === tool) tools.delete(tool.name)
      })
    }
  })
  host(target).modelContext = { registerTool }
  return { tools, registerTool }
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
