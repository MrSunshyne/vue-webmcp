# nuxt-webmcp

Nuxt module for [WebMCP](https://github.com/webmachinelearning/webmcp). Wraps [`vue-webmcp`](../vue-webmcp) with the Nuxt-specific plumbing:

- **Auto-imports** `useWebMCPTool` in components, composables, and stores.
- **Origin-trial token injection** — WebMCP is in origin trial in Chrome (149→156) and Edge (from 150); without a token on your origin (or the local `chrome://flags/#enable-webmcp-testing` flag) the API simply doesn't exist. The module injects your token as `<meta http-equiv="origin-trial">`.
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
  webmcp: {
    // https://developer.chrome.com/docs/ai/webmcp
    originTrialToken: process.env.NUXT_PUBLIC_WEBMCP_OT_TOKEN,
  },
})
```

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
