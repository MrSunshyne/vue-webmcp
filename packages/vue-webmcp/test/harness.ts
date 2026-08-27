/**
 * Test setup shared by the suite: the published stub from `vue-webmcp/testing`
 * installed with spies on its spec methods, plus a component mount helper.
 *
 * The behavioural contract the suite checks is derived from the
 * use-webmcp-tool test harness (https://github.com/GoogleChromeLabs/use-webmcp-tool),
 * Copyright 2026 Google LLC, Apache-2.0. See NOTICE at the repository root.
 */
import { vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'
import { WEBMCP_CONFIG } from '../src/config'
import type { WebMCPConfig } from '../src/config'
import { installModelContextStub } from '../src/testing'
import type { ModelContext } from '../src/types'

// Where the stub gets installed. `navigator` stands in for the
// pre-Chrome-150 location of the API.
function hostFor(target: 'document' | 'navigator') {
  return { document: target === 'document' ? document : navigator, window, location }
}

// The real property is readonly and typed as the full spec interface; viewed
// through the package's own narrow ModelContext it can be assigned and deleted.
function host(target: 'document' | 'navigator'): { modelContext?: ModelContext } {
  return target === 'document' ? document : navigator
}

export function installFakeModelContext(target: 'document' | 'navigator' = 'document') {
  const stub = installModelContextStub(hostFor(target))
  // Spies over the stub's own implementations, so tests can assert calls
  // and swap behaviour with mockImplementation / mockResolvedValue.
  const registerTool = vi.spyOn(stub, 'registerTool')
  const getTools = vi.spyOn(stub, 'getTools')
  const executeTool = vi.spyOn(stub, 'executeTool')
  const context = stub as typeof stub & {
    registerTool: typeof registerTool
    getTools: typeof getTools
    executeTool: typeof executeTool
  }
  return { context, tools: stub.tools, registerTool }
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

export function mountComposable<T>(setup: () => T, options: { config?: WebMCPConfig } = {}) {
  let result: T | undefined
  const app = createApp(
    defineComponent({
      setup() {
        result = setup()
        return () => h('div')
      },
    }),
  )
  // App-level config, the way a main.ts or a Nuxt plugin would provide it.
  if (options.config) app.provide(WEBMCP_CONFIG, options.config)
  app.mount(document.createElement('div'))
  return { result: result as T, unmount: () => app.unmount() }
}
