# vue-webmcp

A Vue composable that registers a [WebMCP](https://github.com/webmachinelearning/webmcp) tool with the browser and ties its lifetime to the current component or effect scope.

The Vue counterpart to [`use-webmcp-tool`](https://github.com/GoogleChromeLabs/use-webmcp-tool) (React, GoogleChromeLabs): agents observe identical registration behavior and results from both — the normalization matrix and re-registration rules are kept in behavioral lockstep.

> **Status (2026-08-27):** built against the current WebMCP spec draft: the imperative API on **`document.modelContext`** (`registerTool` + `AbortSignal` unregistration), with `execute(args, { signal })` from Chrome 153. WebMCP is experimental: origin trial in Chrome (149→156; the [Intent to Experiment](https://groups.google.com/a/chromium.org/g/blink-dev/c/gmYffo5WOE8/m/OJxuQRP3AAAJ) estimates shipping in 157) and Edge (from 150), local testing via `chrome://flags/#enable-webmcp-testing`. ChatGPT Desktop's built-in browser consumes WebMCP tools as [Site tools](https://learn.chatgpt.com/docs/webmcp) and Brave Leo has experimental support; the spec tracks this in its [implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md). WebKit has formally [opposed](https://github.com/WebKit/standards-positions/issues/670) the proposal; Mozilla is [neutral](https://github.com/mozilla/standards-positions/issues/1412). The composable feature-detects and degrades to a no-op everywhere the API is absent — treat it as progressive enhancement.

## Install

```sh
npm install vue-webmcp
```

Requires Vue 3.3+ as a peer dependency. Ships as ESM with TypeScript types. Its only dependency is [`webmcp-types`](https://github.com/webmachinelearning/webmcp-types), the spec's type definitions (no runtime code); importing `vue-webmcp` is enough to get `document.modelContext` typed, with no separate install. If you do install `webmcp-types` yourself, keep it on 0.1.x so the two copies agree.

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

### Several tools from one component

One component often owns a group of tools. `defineWebMCPTool()` is a typed identity helper, so definitions can live in plain modules; `useWebMCPTools()` registers a list of them with options shared across the group:

```ts
// tools/notes.ts
import { defineWebMCPTool } from 'vue-webmcp'
import { useNotesStore } from '@/stores/notes'

export const searchNotes = defineWebMCPTool({
  name: 'search_notes',
  description: 'Search notes by text',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  annotations: { readOnlyHint: true },
  execute: ({ query }: { query: string }) => useNotesStore().search(query),
})
```

```vue
<script setup lang="ts">
import { useWebMCPTools } from 'vue-webmcp'
import { useNotesStore } from '@/stores/notes'
import { addNote, getNote, searchNotes } from '@/tools/notes'

const store = useNotesStore()

const group = useWebMCPTools([searchNotes, getNote, addNote], {
  enabled: () => store.loaded,           // per-tool `enabled` wins over this
  onError: (error, name) => console.error(name, error),
})

group.isRegistered            // every enabled tool in the group is registered
group.byName.add_note.error   // per-tool state is still there
</script>
```

```ts
const { isSupported, isRegistered, error, byName } = useWebMCPTools(definitions, {
  enabled, annotations, exposedTo, // shared defaults; a tool's own value wins
  onError,                         // (error, name) => void
})
```

Shared `enabled`, `annotations`, `exposedTo` and `onError` apply to each tool that does not set its own (a shared `annotations` replaces, it does not merge). Each tool still goes through `useWebMCPTool`, so the lifecycle, re-registration and normalization rules below apply unchanged, and one tool failing to register leaves the others registered; `error` holds the first failure. `isRegistered` counts only the tools that are enabled, so a group with its read tools on and its write tools off still reports registered. `byName` is keyed by each tool's name at setup time. An inline definition in the list gets `args: any` in `execute`; annotate the parameter, or write the tool with `defineWebMCPTool` to keep it typed.

## API

```ts
const { isSupported, isRegistered, error } = useWebMCPTool({
  name,           // MaybeRefOrGetter<string> — tool identifier (required)
  title,          // MaybeRefOrGetter<string> — human-readable label for user-agent UI (optional)
  description,    // MaybeRefOrGetter<string> — natural-language description for the agent (required)
  inputSchema,    // MaybeRefOrGetter<object> — JSON Schema for the args (optional)
  annotations,    // MaybeRefOrGetter<{ readOnlyHint?, untrustedContentHint? }> (optional)
  exposedTo,      // MaybeRefOrGetter<string[]> — secure origins that may also call the tool (optional)
  execute,        // (args, { signal }) => result | Promise<result> (required)
  enabled,        // MaybeRefOrGetter<boolean> — register only while true (default true)
  formatOutput,   // (result, args) => any — optional shaper before MCP normalization
  onError,        // (error) => void — side effect when execute throws
})
```

| return | type | meaning |
| --- | --- | --- |
| `isSupported` | `Readonly<Ref<boolean>>` | A modelContext API exists here. Flips reactively if an extension injects it late (rechecked every 500 ms for 10 s). |
| `isRegistered` | `Readonly<Ref<boolean>>` | The tool is currently registered with the browser. |
| `error` | `Readonly<Ref<Error \| null>>` | Registration failure, e.g. `NotAllowedError` from a [`tools` Permissions Policy](https://github.com/webmachinelearning/webmcp) or `SecurityError` from an insecure `exposedTo` origin. |

### Reactivity rules

- `name`, `title`, `description`, `inputSchema`, `annotations`, `exposedTo`, and `enabled` accept plain values, refs, or getters. Any change to them re-registers the tool; comparison is **by content**, so a rebuilt-but-identical schema object never churns.
- `title` is a label the user agent may use when it refers to the tool in its own UI; agents work from `name` and `description`. Omit it and the user agent is free to display a value of its own. The spec recommends localizing it to the user's language.
- `execute` is *not* reactive input and never triggers re-registration. It reads reactive state live at call time — `setup()` runs once in Vue, so there is no stale-closure problem and no ref-mirroring dance.
- On the server (SSR) the composable is inert: no `document` access, `isSupported` stays `false`, registration happens after mount on the client. No hydration mismatch.

### Cancellation

`execute` receives `(args, { signal })`. The browser aborts `signal` when the caller cancels the execution or goes away (Chrome 153+), so pass it to `fetch` and check it in long-running work:

```ts
async execute({ query }, { signal }) {
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal })
  return response.json()
}
```

Inside the composable an abort is a failure like any other: `onError` runs and `execute` resolves to an `isError` result. The caller that cancelled has already received the abort reason and does not see that result. On browsers that call `execute` without options, the composable supplies a signal that never aborts, so `signal` is always defined.

### Result normalization

Whatever `execute` returns is normalized to an MCP tool result, identically to `use-webmcp-tool`:

- a **string** → `{ content: [{ type: "text", text }] }`
- **`undefined`/`null`** → `{ content: [] }` (success, no payload)
- a value already shaped as `{ content: [...] }` → passed through untouched
- anything else (object/array/number) → JSON-serialized into a text block
- a **thrown value** — Error or not (`throw "not signed in"`, `throw { code: 403 }`) → `{ content: [...], isError: true }`, after `onError`. Errors and objects with a string `message` (an error thrown in another realm, a structured-cloned error) supply that message; strings pass through; anything else is JSON-serialized. A failure must never read as success to the agent.
- a **returned `Error`** → treated exactly like a throw

## Consuming tools: `useRegisteredTools()`

The other side of the API. `getTools()` returns the tools this document may call, `executeTool()` runs one in its owner's document, and the `toolchange` event fires when the set changes. `useRegisteredTools()` folds those into a reactive list, for an in-page agent, a dev panel, or an iframe-hosted agent reading a partner page's tools:

```vue
<script setup lang="ts">
import { useRegisteredTools } from 'vue-webmcp'

const { isSupported, tools, execute } = useRegisteredTools()

async function search(query: string) {
  const tool = tools.value.find(t => t.name === 'search-posts')
  if (!tool) return
  const result = await execute(tool, { query })
  // result is the tool's return value, e.g. { content: [{ type: 'text', text: '...' }] }
}
</script>

<template>
  <ul v-if="isSupported">
    <li v-for="tool in tools" :key="tool.name">{{ tool.name }}: {{ tool.description }}</li>
  </ul>
</template>
```

```ts
const { isSupported, tools, error, refresh, execute } = useRegisteredTools({
  fromOrigins,    // MaybeRefOrGetter<string[]> — secure origins whose tools to include (optional)
  argumentFormat, // 'object' | 'json' — skip the detection described below (optional)
})
```

| return | type | meaning |
| --- | --- | --- |
| `isSupported` | `Readonly<Ref<boolean>>` | `getTools()` and `executeTool()` exist here. A registration-only polyfill leaves this `false`. |
| `tools` | `Readonly<ShallowRef<readonly RegisteredTool[]>>` | The spec's `RegisteredTool` dictionaries (`name`, `title`, `description`, `inputSchema`, `annotations`, `origin`, `window`), sorted by name, refreshed on `toolchange`. |
| `error` | `Readonly<Ref<Error \| null>>` | Failure of the last `getTools()` call. |
| `refresh` | `() => Promise<void>` | Query again by hand. A failure lands in `error`. |
| `execute` | `(tool, args?, { signal }?) => Promise<unknown>` | Run a tool. Resolves with its result parsed from the JSON the browser returns; pass a `signal` to cancel. Rejects with the browser's `DOMException` when the tool or the browser fails, and with a `NotSupportedError` when the API is absent. |

Same lifecycle as `useWebMCPTool`: inert on the server, starts after mount in a component or immediately in a store or `effectScope`, waits up to 10 s for a late-injected API, and goes inert on scope disposal. Cross-origin tools need the other page to list your origin in `exposedTo` and you to list theirs in `fromOrigins`; the browser checks both before running anything.

Three transitional details are handled for you. Arguments go over as the JSON string Chrome shipped with, and switch to the object form the spec adopted once the browser rejects the string with a `TypeError`; a string handed to an object parameter fails before the tool runs, so nothing ever runs twice, and `argumentFormat` skips the detection. A stringified `inputSchema` from an older `getTools()` is parsed back into an object. Results come back parsed whether the browser returns JSON text (spec) or a polyfill returns the value itself; a polyfill returning a plain string that happens to be valid JSON is parsed too.

## Configuration: hooks and budgets

App-level settings reach every `useWebMCPTool` call through Vue's provide/inject, read once when each tool is set up. Provide once, at the root:

```ts
// main.ts
import { WEBMCP_CONFIG } from 'vue-webmcp'

app.provide(WEBMCP_CONFIG, {
  onToolCall: ({ name }) => track('tool_called', { name }),
  onToolResult: ({ name, ok, ms }) => track('tool_result', { name, ok, ms }),
  budgets: import.meta.env.MODE === 'test' ? 'error' : undefined,
})
```

`app.provide` reaches everything, including tools registered from Pinia stores or under `app.runWithContext`. `provideWebMCPConfig(config)` in a component's `setup()` reaches that component's subtree only. Outside an injection context (a bare `effectScope` with no app) there is no config and the defaults apply.

| option | meaning |
| --- | --- |
| `onToolCall({ name, args? })` | Runs before `execute`. |
| `onToolResult({ name, ok, ms, response, error?, args? })` | Runs after normalization, for success and failure alike: `ok` is false when `execute` threw, returned an `Error`, or returned an `isError` result; `error` holds what was thrown; `ms` is timed from after `onToolCall`. Runs after the tool's own `onError`. |
| `includeArgs` | Put the call arguments in both payloads, as the same object `execute` receives (do not mutate it). Off by default: arguments often carry personal data that should not reach an analytics tool. |
| `budgets` | What happens when a name, description, parameter or result is over [Chrome's character budgets](#security-notes): `'warn'` logs (the development default); `'error'` fails setup for an over-budget initial definition (a thrown error in a dev or test build; the server never validates), records a later over-budget change in `error` without registering, and turns an oversized result into an `isError` response, so a test run fails on any of them; `false` skips the checks (the production default). An explicit `'warn'` is honoured in production too, so leave it unset outside test runs. |

A hook that throws is reported with a warning and never changes the tool's result.

## Security notes

Tools are an attack surface as much as an interface. Minimum hygiene:

- Mark tools that don't mutate state with `annotations: { readOnlyHint: true }`; mark tools whose output embeds user- or third-party content with `untrustedContentHint: true` so agents don't follow it as instructions.
- Stay within Chrome's [character budgets](https://developer.chrome.com/docs/ai/webmcp/secure-tools): 500 characters per tool description, 150 per parameter description, 30 per tool or parameter name, 1.5K per tool output. Dev builds warn when you exceed any of them, and when a name is outside the spec grammar (`[a-zA-Z0-9_.-]{1,128}`); `budgets: 'error'` in the [configuration](#configuration-hooks-and-budgets) makes them fail instead, which is what you want in a test run.
- WebMCP requires a secure, origin-isolated context and is gated by the `tools` Permissions Policy (default `self`); denial surfaces as a `NotAllowedError` in `error`.
- A tool is visible to the registering page, its same-origin frames, and the browser's own agent by default. `exposedTo: ['https://agent.example']` extends that to specific secure origins, for example an iframe-hosted agent, which also needs `allow="tools"` on its frame and `getTools({ fromOrigins })` on its side. An entry that is not a potentially trustworthy origin makes registration fail: `error` holds a `SecurityError` and the tool is not registered.
- Registration is *site-controlled*: never expose an operation as a tool that you wouldn't expose as an unauthenticated-intent button — the agent acts with the signed-in user's session.

## Trying it locally

1. Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled (or an [origin-trial token](https://developer.chrome.com/docs/ai/webmcp) on your origin). Chrome 153+ passes `{ signal }` to `execute`.
2. The [Model Context Tool Inspector](https://github.com/GoogleChromeLabs/webmcp-tools) extension to list and invoke registered tools.

Live examples: the [playground](https://mrsunshyne.github.io/vue-webmcp/) from this repo, and the [Trip Splitter](https://mrsunshyne.github.io/webmcp-demos/demos/trip-splitter/) in [webmcp-demos](https://github.com/MrSunshyne/webmcp-demos), which loads this package from a CDN with no build step.

## Credits

The API design, result-normalization contract, and test matrix originate from [`use-webmcp-tool`](https://github.com/GoogleChromeLabs/use-webmcp-tool) by Sarah Drasner (Google Chrome team). Portions of this package are derived from it under Apache-2.0 — see the [NOTICE](../../NOTICE) file.

This is an independent community project, not affiliated with or endorsed by Google.

## License

Apache-2.0
