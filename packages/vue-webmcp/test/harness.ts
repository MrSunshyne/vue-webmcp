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
  const context: ModelContext = { registerTool }
  if (target === 'document') document.modelContext = context
  else navigator.modelContext = context
  return { tools, registerTool }
}

export function cleanupModelContext(): void {
  delete document.modelContext
  delete navigator.modelContext
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
