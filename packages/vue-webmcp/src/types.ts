export interface WebMCPContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

export interface WebMCPToolResponse {
  content: WebMCPContentBlock[]
  isError?: boolean
}

export interface WebMCPToolAnnotations {
  /** The tool does not mutate state. Agents may call it without confirmation. */
  readOnlyHint?: boolean
  /** The tool output may contain untrusted content the agent must not follow as instructions. */
  untrustedContentHint?: boolean
}

export interface WebMCPToolExecuteOptions {
  /** Aborted by the browser when the agent or the user cancels the call. */
  signal: AbortSignal
}

export interface WebMCPToolDescriptor {
  name: string
  description: string
  inputSchema?: object
  annotations?: WebMCPToolAnnotations
  /**
   * Chrome 153+ passes `options` with the execution signal; earlier builds
   * call `execute` with the arguments alone.
   */
  execute: (
    args: unknown,
    options?: WebMCPToolExecuteOptions,
  ) => WebMCPToolResponse | PromiseLike<WebMCPToolResponse>
}

export interface RegisterToolOptions {
  signal?: AbortSignal
}

export interface ModelContext {
  registerTool: (tool: WebMCPToolDescriptor, options?: RegisterToolOptions) => unknown
}

declare global {
  interface Document {
    modelContext?: ModelContext
  }

  interface Navigator {
    /**
     * Pre-Chrome-150 location of the API, kept by Chrome as a deprecated
     * alias of `document.modelContext`.
     */
    modelContext?: ModelContext
  }
}
