# vue-webmcp

A Vue composable that registers a [WebMCP](https://github.com/webmachinelearning/webmcp) tool with the browser and ties its lifetime to the current component or effect scope.

The Vue counterpart to [`use-webmcp-tool`](https://github.com/GoogleChromeLabs/use-webmcp-tool) (React, GoogleChromeLabs): agents observe identical registration behavior and results from both — the normalization matrix and re-registration rules are kept in behavioral lockstep.

> **Status (2026-08-01):** built against the current WebMCP spec draft, which exposes the imperative API on **`document.modelContext`** (`registerTool` + `AbortSignal` unregistration). WebMCP is 🧪 experimental: Chrome origin trial 149→156, local testing via `chrome://flags/#enable-webmcp-testing`. WebKit has formally [opposed](https://github.com/WebKit/standards-positions/issues/670) the proposal; Mozilla has [no position](https://github.com/mozilla/standards-positions/issues/1412). No mainstream shipping agent consumes WebMCP tools yet. The composable feature-detects and degrades to a no-op everywhere the API is absent — treat it as progressive enhancement.

## Install

```sh
npm install vue-webmcp
```

Requires Vue 3.3+ as a peer dependency. Ships as ESM with TypeScript types. No runtime dependencies.

Using Nuxt? See [`nuxt-webmcp`](../nuxt-webmcp) for auto-imports and origin-trial token injection.

## What it does

WebMCP lets a page expose JavaScript functions as "tools" that an AI agent (browser-built-in, iframe-hosted, or extension) can discover and call, instead of scraping the DOM or clicking through the UI. The raw API is imperative:

```js
const controller = new AbortController()

document.modelContext.registerTool({
  name: 'add-todo',
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The text content of the todo item' } },
    required: ['text'],
  },
  async execute({ text }) {
    await addTodo(text)
    return { content: [{ type: 'text', text: `Added todo item: "${text}" successfully.` }] }
  },
}, { signal: controller.signal })

// Unregister later:
controller.abort()
```

`useWebMCPTool` folds that into Vue's reactivity and lifecycle. Plain component state is all it needs:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useWebMCPTool } from 'vue-webmcp'

const todos = ref<string[]>([])

const { isSupported, isRegistered, error } = useWebMCPTool({
  name: 'add-todo',
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The text content of the todo item' } },
    required: ['text'],
  },
  async execute({ text }) {
    todos.value.push(text)
    return `Added todo item: "${text}" successfully.`
  },
})
</script>

<template>
  <p v-if="isSupported && isRegistered">add-todo is available to agents</p>
</template>
```

The tool registers when the component mounts and unregisters automatically when it unmounts — the set of tools an agent sees stays in lockstep with what is actually on screen.

### With Pinia and vue-router

`execute` is an ordinary closure — no store is required, and the composable has no store integration to configure. But because `execute` reads reactive state live at call time, it composes naturally with one, and reactive options like `enabled` can follow the router:

```vue
<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useWebMCPTool } from 'vue-webmcp'
import { useTodoStore } from '@/stores/todos'

const store = useTodoStore()
const route = useRoute()

const { isRegistered } = useWebMCPTool({
  name: 'add-todo',
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The text content of the todo item' } },
    required: ['text'],
  },
  enabled: () => route.name === 'todos', // registered only while the todos page is active
  async execute({ text }) {
    store.add(text) // reads the live store at call time — no stale closures
    return `Added todo item: "${text}" successfully.`
  },
})
</script>
```

You can also call `useWebMCPTool` *inside* a Pinia store or a bare `effectScope` for app-wide tools that shouldn't die with a component; teardown then runs on scope disposal instead of unmount.

## API

```ts
const { isSupported, isRegistered, error } = useWebMCPTool({
  name,           // MaybeRefOrGetter<string> — tool identifier (required)
  description,    // MaybeRefOrGetter<string> — natural-language description for the agent (required)
  inputSchema,    // MaybeRefOrGetter<object> — JSON Schema for the args (optional)
  annotations,    // MaybeRefOrGetter<{ readOnlyHint?, untrustedContentHint? }> (optional)
  execute,        // (args) => result | Promise<result> (required)
  enabled,        // MaybeRefOrGetter<boolean> — register only while true (default true)
  formatOutput,   // (result, args) => any — optional shaper before MCP normalization
  onError,        // (error) => void — side effect when execute throws
})
```

| return | type | meaning |
| --- | --- | --- |
| `isSupported` | `Readonly<Ref<boolean>>` | A modelContext API exists here. Flips reactively if an extension injects it late (rechecked every 500 ms for 10 s). |
| `isRegistered` | `Readonly<Ref<boolean>>` | The tool is currently registered with the browser. |
| `error` | `Readonly<Ref<Error \| null>>` | Registration failure, e.g. `NotAllowedError` from a [`tools` Permissions Policy](https://github.com/webmachinelearning/webmcp). |

### Reactivity rules

- `name`, `description`, `inputSchema`, `annotations`, and `enabled` accept plain values, refs, or getters. Agent-visible changes re-register the tool; comparison is **by content**, so a rebuilt-but-identical schema object never churns.
- `execute` is *not* reactive input and never triggers re-registration. It reads reactive state live at call time — `setup()` runs once in Vue, so there is no stale-closure problem and no ref-mirroring dance.
- On the server (SSR) the composable is inert: no `document` access, `isSupported` stays `false`, registration happens after mount on the client. No hydration mismatch.

### Result normalization

Whatever `execute` returns is normalized to an MCP tool result, identically to `use-webmcp-tool`:

- a **string** → `{ content: [{ type: "text", text }] }`
- **`undefined`/`null`** → `{ content: [] }` (success, no payload)
- a value already shaped as `{ content: [...] }` → passed through untouched
- anything else (object/array/number) → JSON-serialized into a text block
- a **thrown value** — Error or not (`throw "not signed in"`, `throw { code: 403 }`) → `{ content: [...], isError: true }`, after `onError`. A failure must never read as success to the agent.
- a **returned `Error`** → treated exactly like a throw

## Security notes

Tools are an attack surface as much as an interface. Minimum hygiene:

- Mark tools that don't mutate state with `annotations: { readOnlyHint: true }`; mark tools whose output embeds user- or third-party content with `untrustedContentHint: true` so agents don't follow it as instructions.
- Keep descriptions within Chrome's guidance (≤ 500 characters per tool, ≤ 150 per parameter) — dev builds warn when you exceed them, or when a name is outside the spec grammar (`[a-zA-Z0-9_.-]{1,128}`).
- WebMCP requires a secure, origin-isolated context and is gated by the `tools` Permissions Policy (default `self`); denial surfaces as a `NotAllowedError` in `error`.
- Registration is *site-controlled*: never expose an operation as a tool that you wouldn't expose as an unauthenticated-intent button — the agent acts with the signed-in user's session.

## Trying it locally

1. Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled (or an [origin-trial token](https://developer.chrome.com/docs/ai/webmcp) on your origin).
2. The [Model Context Tool Inspector](https://github.com/GoogleChromeLabs/webmcp-tools) extension to list and invoke registered tools.

## Credits

The API design, result-normalization contract, and test matrix originate from [`use-webmcp-tool`](https://github.com/GoogleChromeLabs/use-webmcp-tool) by Sarah Drasner (Google Chrome team). Portions of this package are derived from it under Apache-2.0 — see the [NOTICE](../../NOTICE) file.

This is an independent community project, not affiliated with or endorsed by Google.

## License

Apache-2.0
