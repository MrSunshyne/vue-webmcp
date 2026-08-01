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

export interface WebMCPToolDescriptor {
  name: string
  description: string
  inputSchema?: object
  annotations?: WebMCPToolAnnotations
  execute: (args: unknown) => WebMCPToolResponse | PromiseLike<WebMCPToolResponse>
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
