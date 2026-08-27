import { hasInjectionContext, inject, provide } from 'vue'
import type { InjectionKey } from 'vue'
import type { WebMCPToolResponse } from './types'

export interface WebMCPToolCallEvent {
  name: string
  /** Present only with `includeArgs: true`. The same object `execute` receives; do not mutate it. */
  args?: unknown
}

export interface WebMCPToolResultEvent {
  name: string
  /** `false` when `execute` threw or returned an `isError` result. */
  ok: boolean
  /** Wall-clock duration of the call in milliseconds. */
  ms: number
  /** What the agent receives, after normalization. */
  response: WebMCPToolResponse
  /**
   * What `execute` threw or returned as an `Error`, when `ok` is false for
   * that reason; in `'error'` budget mode also the oversized-result failure.
   */
  error?: unknown
  /** Present only with `includeArgs: true`. */
  args?: unknown
}

/**
 * App-level settings for every `useWebMCPTool` call below the provider,
 * read once when each tool is set up. Provide it once at the root:
 * `app.provide(WEBMCP_CONFIG, ...)` reaches everything, including tools
 * registered from Pinia stores or under `app.runWithContext`;
 * `provideWebMCPConfig()` in a root component's setup reaches that
 * component's subtree only.
 */
export interface WebMCPConfig {
  /**
   * What happens when a name, description, parameter or result is over
   * Chrome's character budgets. `'warn'` logs (the default in development).
   * `'error'` fails setup for an over-budget initial definition (a thrown
   * error in a dev or test build; the server never validates), records a
   * later over-budget change in `error` without registering, and turns an
   * oversized result into an `isError` response. `false` skips the checks
   * (the default in production). An explicit `'warn'` is honoured in
   * production too, so leave it unset outside test runs.
   */
  budgets?: 'warn' | 'error' | false
  /**
   * Include the call arguments in hook payloads. Off by default: arguments
   * often carry personal data that should not reach an analytics tool.
   */
  includeArgs?: boolean
  /** Runs before `execute`. */
  onToolCall?: (event: WebMCPToolCallEvent) => void
  /** Runs after the result is normalized, for success and failure alike. */
  onToolResult?: (event: WebMCPToolResultEvent) => void
}

// Symbol.for, so an app that ends up with two copies of this package (its own
// pin next to the one nuxt-webmcp depends on) still shares the key.
export const WEBMCP_CONFIG: InjectionKey<WebMCPConfig> = Symbol.for('vue-webmcp:config')

/**
 * Call in a component's `setup()` to configure its subtree. For the whole
 * app, including Pinia stores, use `app.provide(WEBMCP_CONFIG, config)`.
 */
export function provideWebMCPConfig(config: WebMCPConfig): void {
  provide(WEBMCP_CONFIG, config)
}

/** The nearest provided config, or null outside an injection context. */
export function injectWebMCPConfig(): WebMCPConfig | null {
  return hasInjectionContext() ? inject(WEBMCP_CONFIG, null) : null
}
