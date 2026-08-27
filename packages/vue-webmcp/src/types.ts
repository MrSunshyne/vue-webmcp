/// <reference types="webmcp-types" />

/**
 * `document.modelContext` and the spec dictionaries are typed by the spec
 * org's `webmcp-types` package (https://github.com/webmachinelearning/webmcp-types),
 * which this package depends on. The names below stay stable for consumers.
 */

export interface WebMCPContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

export interface WebMCPToolResponse {
  content: WebMCPContentBlock[]
  isError?: boolean
}

export type WebMCPToolAnnotations = WebMCP.ToolAnnotations
export type WebMCPToolExecuteOptions = WebMCP.ToolExecuteCallbackOptions
export type RegisterToolOptions = WebMCP.ModelContextRegisterToolOptions
export type RegisteredTool = WebMCP.RegisteredTool

/**
 * What this package hands to `registerTool`: the spec's `ModelContextTool`,
 * with `execute` typed for the normalized response and tolerant of browsers
 * that predate the execution-signal argument (Chrome 153).
 */
export interface WebMCPToolDescriptor extends Omit<WebMCP.ModelContextTool, 'execute'> {
  execute: (
    args: unknown,
    options?: WebMCPToolExecuteOptions,
  ) => WebMCPToolResponse | PromiseLike<WebMCPToolResponse>
}

/** The part of the spec's `ModelContext` interface this package calls. */
export interface ModelContext {
  registerTool: (tool: WebMCPToolDescriptor, options?: RegisterToolOptions) => unknown
}

declare global {
  interface Navigator {
    /**
     * Pre-Chrome-150 location of the API, kept by Chrome as a deprecated
     * alias of `document.modelContext`.
     */
    readonly modelContext?: WebMCP.ModelContext
  }
}
