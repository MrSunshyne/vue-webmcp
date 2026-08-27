/**
 * Shared plumbing for the composables: locating `document.modelContext`,
 * waiting for a late-injected one, and dev-only diagnostics.
 */
import { safeStringify } from './normalize'
import type { ModelContext } from './types'

// No dependency on node types: bundlers statically replace
// `process.env.NODE_ENV`, and the typeof guard keeps bundler-less browsers safe.
declare const process: undefined | { env?: { NODE_ENV?: string } }

export const isDev =
  typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production'

export function warn(message: string): void {
  console.warn(`[vue-webmcp] ${message}`)
}

// DOMException inherits from Error in browsers but not in every test
// environment; keep it intact either way so `error.name` checks (e.g.
// "NotAllowedError") work as users expect.
export function toError(err: unknown): Error {
  if (err instanceof Error) return err
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    return err as unknown as Error
  }
  return new Error(safeStringify(err))
}

export interface ResolvedModelContext {
  context: ModelContext
  /** Found on `navigator.modelContext`, the pre-Chrome-150 location. */
  legacy: boolean
}

export function resolveModelContext(): ResolvedModelContext | null {
  if (typeof document !== 'undefined' && document.modelContext) {
    return { context: document.modelContext, legacy: false }
  }
  if (typeof navigator !== 'undefined' && navigator.modelContext) {
    return { context: navigator.modelContext, legacy: true }
  }
  return null
}

// The modelContext API is often injected by an extension content script that
// runs after the app mounts, so absence now doesn't mean absence forever.
const LATE_INJECTION_INTERVAL_MS = 500
const LATE_INJECTION_MAX_ATTEMPTS = 20

/**
 * Rechecks for a modelContext every 500 ms for 10 s and calls `onFound` once
 * it appears. Returns a function that stops waiting.
 */
export function pollForModelContext(onFound: () => void): () => void {
  let attempts = 0
  const timer = setInterval(() => {
    if (resolveModelContext()) {
      clearInterval(timer)
      onFound()
    } else if (++attempts >= LATE_INJECTION_MAX_ATTEMPTS) {
      clearInterval(timer)
    }
  }, LATE_INJECTION_INTERVAL_MS)
  return () => clearInterval(timer)
}
