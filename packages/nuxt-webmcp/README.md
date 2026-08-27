# nuxt-webmcp

Nuxt module for [WebMCP](https://github.com/webmachinelearning/webmcp). Wraps [`vue-webmcp`](../vue-webmcp) with the Nuxt-specific plumbing:

- **Auto-imports** `useWebMCPTool`, `useWebMCPTools`, `defineWebMCPTool` and `useRegisteredTools` in components, composables, and stores.
- **Origin-trial token injection** — WebMCP is in origin trial in Chrome (149→156) and Edge (from 150); without a token on your origin (or the local `chrome://flags/#enable-webmcp-testing` flag) the API simply doesn't exist. The module injects your tokens as `<meta http-equiv="origin-trial">`, from the build config or from runtime config at deploy time.
- **SSR-safe by construction** — the composable is inert during server rendering and registers tools after mount on the client. No `import.meta.client` guards needed in your code.

> Same experimental-status caveats as [`vue-webmcp`](../vue-webmcp#readme) (2026-08-27): origin-trial API in Chrome and Edge, WebKit opposed, Mozilla neutral. ChatGPT Desktop's built-in browser calls WebMCP tools ([Site tools](https://learn.chatgpt.com/docs/webmcp)). Everything degrades to a no-op where the API is absent.

## Install

```sh
npm install nuxt-webmcp
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-webmcp'],
})
```

### Origin-trial tokens

Register your origin at [developer.chrome.com/docs/ai/webmcp](https://developer.chrome.com/docs/ai/webmcp) and hand the token to the module in one of two ways.

At deploy time, through runtime config, so one server build can serve staging and production with different tokens (a prerendered site reads the value when `nuxt generate` runs):

```sh
NUXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN="token-for-this-origin"   # several: comma-separated
```

```ts
// or in nuxt.config.ts, overridable by the env var the usual Nuxt way
runtimeConfig: {
  public: {
    webmcp: { originTrialToken: '' },
  },
},
```

At build time, baked into the bundle:

```ts
webmcp: {
  originTrialToken: process.env.WEBMCP_OT_TOKEN?.split(','), // one or several
},
```

Both can be set; every token ends up in the head, build-time ones first. Each tag gets its own head key, because unhead otherwise keeps only the last `<meta http-equiv="origin-trial">` and silently drops the rest.

## Usage

```vue
<script setup lang="ts">
// useWebMCPTool is auto-imported
const { isSupported, isRegistered } = useWebMCPTool({
  name: 'search-posts',
  description: 'Search blog posts by keyword and return matching titles with URLs',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Search keyword' } },
    required: ['query'],
  },
  annotations: { readOnlyHint: true },
  async execute({ query }) {
    const results = await searchContent(query)
    return results.map(post => `${post.title} — ${post.url}`).join('\n')
  },
})
</script>

<template>
  <ClientOnly>
    <p v-if="isSupported && isRegistered">search-posts is available to agents</p>
  </ClientOnly>
</template>
```

Wrap status badges in `<ClientOnly>`: registration happens after hydration, so server markup would otherwise briefly disagree with client state.

### Permissions Policy

WebMCP is gated by the `tools` Permissions Policy (default `self`). To disable it for a route, or extend it to a trusted iframe, set headers via nitro route rules:

```ts
routeRules: {
  '/embed/**': { headers: { 'Permissions-Policy': 'tools=()' } },
},
```

### Hooks and budgets

App-level [configuration](../vue-webmcp#configuration-hooks-and-budgets) (call hooks, the budget mode) is a Vue provide, so a plugin is the place for it:

```ts
// plugins/webmcp.ts
import { WEBMCP_CONFIG } from 'vue-webmcp'

export default defineNuxtPlugin(nuxtApp => {
  nuxtApp.vueApp.provide(WEBMCP_CONFIG, {
    onToolResult: ({ name, ok, ms }) => useTrackEvent('tool_result', { name, ok, ms }),
    budgets: import.meta.test ? 'error' : undefined,
  })
})
```

## Not the same thing as nuxt-mcp

They sound alike and are complementary, not competing:

| | [`nuxt-mcp`](https://github.com/antfu/nuxt-mcp) | `nuxt-webmcp` |
| --- | --- | --- |
| Runs | on your **dev server** (server-side MCP endpoint) | in the **visitor's browser tab** (in-page tools) |
| Consumed by | your coding tools (Cursor, Claude Code, …) to understand the app | browser agents acting for the visitor on the live site |
| Transport | MCP over HTTP | `document.modelContext` browser API |
| Lifetime | while you develop | while a tab showing your page is open |

## License

Apache-2.0
