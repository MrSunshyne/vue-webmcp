/**
 * MCP result normalization.
 *
 * Derived from use-webmcp-tool (https://github.com/GoogleChromeLabs/use-webmcp-tool),
 * Copyright 2026 Google LLC, Apache-2.0. See the NOTICE file at the repository root.
 * The normalization matrix is kept in behavioral lockstep with that project so
 * agents observe identical results from the React and Vue integrations.
 */
import type { WebMCPToolResponse } from './types'

// Stringify for error reporting without ever throwing itself
// (JSON.stringify throws on circular references and BigInt).
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// Normalizes whatever `execute` returns into an MCP tool result so callers can
// return a plain string/object and still hand the agent a valid response.
export function toToolResponse(value: unknown): WebMCPToolResponse {
  // Already a well-formed MCP tool result — pass it through untouched.
  if (
    value &&
    typeof value === 'object' &&
    Array.isArray((value as WebMCPToolResponse).content)
  ) {
    return value as WebMCPToolResponse
  }

  // `execute` returned nothing — report a successful, empty result.
  if (value === undefined || value === null) {
    return { content: [] }
  }

  // Strings map directly to a single text block.
  if (typeof value === 'string') {
    return { content: [{ type: 'text', text: value }] }
  }

  // Anything else (objects, arrays, numbers) is serialized to JSON text.
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

// Anything carrying a string `message` reads as an error: a DOMException in
// some test environments or an error thrown in another realm fails
// `instanceof Error` but still has the message the agent should see.
function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return null
}

// Every failure becomes an explicit `isError` result, whatever was thrown —
// a thrown string or plain object must not read as success to the agent.
export function toErrorResponse(error: unknown): WebMCPToolResponse {
  const message = errorMessage(error)
  const text =
    message !== null ? message : typeof error === 'string' ? error : safeStringify(error)
  return { content: [{ type: 'text', text }], isError: true }
}
