---
name: nuxt-webmcp
description: >
  Add WebMCP agent tools to a Nuxt app: auto-imported composables, origin-trial tokens
  from build or runtime config, budgets, and the WEBMCP_CONFIG plugin for call hooks.
  Load when wiring WebMCP into Nuxt, when tools are not appearing in the browser, or
  when nuxt-webmcp is being confused with nuxt-mcp.
metadata:
  type: framework
  library: 'nuxt-webmcp'
  library_version: '0.3.1'
  framework: nuxt
requires:
  - 'vue-webmcp#vue-webmcp'
sources:
  - 'MrSunshyne/vue-webmcp:packages/nuxt-webmcp/README.md'
  - 'MrSunshyne/vue-webmcp:packages/nuxt-webmcp/src/module.ts'
  - 'MrSunshyne/vue-webmcp:packages/nuxt-webmcp/src/runtime/plugin.ts'
---

`nuxt-webmcp` wraps `vue-webmcp` with the Nuxt plumbing: auto-imports, origin-trial token
injection, and a budget mode from runtime config. The composables themselves are
documented in `vue-webmcp#vue-webmcp` — read that for tool authoring. This skill covers
only what is different under Nuxt. Requires Nuxt 3.13+.

## Setup

```sh
npm install nuxt-webmcp
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-webmcp'],
})
```

That is the whole install. `useWebMCPTool`, `useWebMCPTools`, `defineWebMCPTool`,
`useWebMCPForm` and `useRegisteredTools` are auto-imported in components, composables and
stores. Do not add `vue-webmcp` to the app's dependencies; the module depends on it.

```vue
<script setup lang="ts">
// no import — useWebMCPTool is auto-imported
const { isSupported, isRegistered } = useWebMCPTool({
  name: 'search_posts',
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
    <p v-if="isSupported && isRegistered">search_posts is available to agents</p>
  </ClientOnly>
</template>
```

## Core Patterns

### Origin-trial tokens

Without a token on the origin — or the local `chrome://flags/#enable-webmcp-testing` flag
— the API does not exist and every registration is a no-op. This is the usual reason
tools do not appear. Register the origin at developer.chrome.com/docs/ai/webmcp.

At deploy time, so one server build can serve several origins:

```sh
NUXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN="token-for-this-origin"   # several: comma-separated
```

At build time, baked in:

```ts
webmcp: { originTrialToken: process.env.WEBMCP_OT_TOKEN?.split(',') },
```

Both can be set at once; every token reaches the head.

### Budgets

```ts
webmcp: { budgets: 'error' },   // 'warn' | 'error' | false
```

Also `NUXT_PUBLIC_WEBMCP_BUDGETS=error`. Use `'error'` in test runs so an over-budget
name, description or result fails instead of warning. Leave it unset in production.

### Call hooks go in a plugin

Hooks are functions, so they cannot come from runtime config. Provide `WEBMCP_CONFIG`
yourself and the module's own plugin stands down — but it stops supplying `budgets` too,
so carry that through.

```ts
// plugins/webmcp.ts
import { WEBMCP_CONFIG } from 'vue-webmcp'
import type { WebMCPConfig } from 'vue-webmcp'

export default defineNuxtPlugin(nuxtApp => {
  const budgets = (useRuntimeConfig().public.webmcp.budgets || undefined) as WebMCPConfig['budgets']
  nuxtApp.vueApp.provide(WEBMCP_CONFIG, {
    onToolResult: ({ name, ok, ms }) => useTrackEvent('tool_result', { name, ok, ms }),
    budgets,
  })
})
```

### Permissions Policy

WebMCP is gated by the `tools` Permissions Policy, default `self`. Change it with nitro
route rules:

```ts
routeRules: {
  '/embed/**': { headers: { 'Permissions-Policy': 'tools=()' } },
},
```

## Common Mistakes

### HIGH Guarding registration for SSR

The composable is inert on the server and registers after mount. Guards are noise, and
`onMounted` wrapping breaks the reactive options.

Wrong:

```ts
if (import.meta.client) {
  useWebMCPTool({ name, description, execute })
}
```

Right:

```ts
useWebMCPTool({ name, description, execute })
```

### HIGH Rendering registration state without ClientOnly

Registration happens after hydration, so server markup disagrees with the first client
render.

Wrong:

```vue
<p v-if="isSupported && isRegistered">ready</p>
```

Right:

```vue
<ClientOnly>
  <p v-if="isSupported && isRegistered">ready</p>
</ClientOnly>
```

### HIGH Confusing nuxt-webmcp with nuxt-mcp

They are complementary, not alternatives. [`nuxt-mcp`](https://github.com/antfu/nuxt-mcp)
runs an MCP endpoint on the dev server so a coding tool can understand the app.
`nuxt-webmcp` registers tools in the visitor's browser tab for a browser agent acting on
the live site. If the request is about agents using the running site, this is the right
package.

### MEDIUM Inventing the runtime config env var

The variable is `NUXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN`, matching
`runtimeConfig.public.webmcp.originTrialToken`. The budget one is
`NUXT_PUBLIC_WEBMCP_BUDGETS`. Both must be public: they are read in the browser.

### MEDIUM Providing WEBMCP_CONFIG and losing budgets

A plugin that provides `WEBMCP_CONFIG` takes precedence over the module's, which then
leaves the key alone. Read `budgets` from runtime config in that plugin, or the module
option and the env var stop working.

### MEDIUM Importing the auto-imported composables

Harmless but redundant in components. `WEBMCP_CONFIG` and the types are *not*
auto-imported and do need importing from `vue-webmcp` in a plugin.

## API Discovery

Module options under the `webmcp` key in `nuxt.config.ts`:

- `originTrialToken` — `string | string[]`, injected as `<meta http-equiv="origin-trial">`
  at build time.
- `budgets` — `'warn' | 'error' | false`.

Runtime config: `runtimeConfig.public.webmcp.originTrialToken` and `.budgets`.

Everything else — the composables, result normalization, the testing stub — comes from
`vue-webmcp`. See `vue-webmcp#vue-webmcp`.
