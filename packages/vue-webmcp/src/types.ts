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

export type GetToolsOptions = WebMCP.ModelContextGetToolOptions

/** Options for `executeTool()`; the spec's `ModelContextExecuteToolOptions`. */
export interface ExecuteToolOptions {
  signal?: AbortSignal
}

/**
 * The part of the spec's `ModelContext` interface this package calls. The
 * consumer-side members are optional because a registerTool-only build or
 * polyfill may lack them.
 */
export interface ModelContext {
  registerTool: (tool: WebMCPToolDescriptor, options?: RegisterToolOptions) => unknown
  getTools?: (options?: GetToolsOptions) => Promise<RegisteredTool[]>
  /**
   * The spec takes the arguments as an object; Chrome builds that predate
   * spec PR #246 take a JSON string. The result is the tool's return value
   * serialized to JSON.
   */
  executeTool?: (
    tool: RegisteredTool,
    args?: object | string,
    options?: ExecuteToolOptions,
  ) => Promise<unknown>
  addEventListener?: (type: 'toolchange', listener: (event: Event) => void) => void
  removeEventListener?: (type: 'toolchange', listener: (event: Event) => void) => void
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
