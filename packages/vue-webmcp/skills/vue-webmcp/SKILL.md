---
name: vue-webmcp
description: >
  Register WebMCP tools from Vue components with useWebMCPTool, consume them with
  useRegisteredTools, wire a form with useWebMCPForm, and test with the shipped
  document.modelContext stub. Load when adding agent tools to a Vue or Nuxt app, or
  when raw document.modelContext.registerTool calls are producing lifecycle bugs.
metadata:
  type: framework
  library: 'vue-webmcp'
  library_version: '0.3.2'
  framework: vue
sources:
  - 'MrSunshyne/vue-webmcp:packages/vue-webmcp/README.md'
  - 'MrSunshyne/vue-webmcp:packages/vue-webmcp/src/index.ts'
  - 'MrSunshyne/vue-webmcp:packages/vue-webmcp/src/testing/index.ts'
---

WebMCP lets a page expose functions as tools an AI agent can call. `vue-webmcp` binds
a tool's lifetime to a Vue component or effect scope, so the tools an agent sees match
what is on screen. Requires Vue 3.3+. ESM only.

## Setup

```sh
npm install vue-webmcp
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useWebMCPTool } from 'vue-webmcp'

const todos = ref<string[]>([])

const { isSupported, isRegistered, error } = useWebMCPTool({
  name: 'add_todo',
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The text of the item' } },
    required: ['text'],
  },
  async execute({ text }) {
    todos.value.push(text)
    return `Added "${text}".`
  },
})
</script>
```

The tool registers on mount and unregisters on unmount. Where the API is absent the
composable is a no-op and `isSupported` stays `false`, so it is safe to ship
unconditionally. It is inert during SSR and registers after mount, so there is no
hydration mismatch.

## Core Patterns

### Let the lifecycle scope the tool

Defining a tool inside the component it acts on is the point of the package. The tool
exists only while that view is on screen, so an agent can tell where the user is, and a
tool never runs against a view that is not mounted. For finer control, `enabled` takes a
ref or getter: `enabled: () => route.name === 'notes'`.

### Return whatever is convenient

Return values are normalized to an MCP result. A string becomes a text block,
`undefined`/`null` becomes an empty success, an object or array is JSON-serialized, and a
value already shaped as `{ content: [...] }` passes through. A thrown value — `Error` or
not — becomes `{ content: [...], isError: true }` after `onError` runs. Return a plain
string unless there is a reason not to.

### Read reactive state directly in execute

`execute` is not a reactive input and never causes re-registration. It reads state live at
call time, so there is no stale-closure problem and no need to mirror refs.

### Accept the abort signal

`execute` receives `(args, { signal })`. Pass it to `fetch` and check it in long work. On
browsers that call `execute` without options the composable supplies a signal that never
aborts, so `signal` is always defined.

```ts
async execute({ query }, { signal }) {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal })
  return res.json()
}
```

### Consuming tools

`useRegisteredTools()` is the other side: a reactive `tools` list refreshed on
`toolchange`, plus `execute(tool, args, { signal })`. It handles Chrome's transitional
shapes — the JSON-string argument form, a stringified `inputSchema`, results as JSON text
or as a value — so do not write that handling yourself.

### Forms

`useWebMCPForm()` wires Chrome's declarative API: `v-bind="attrs"` on a `<form>` and one
`execute` that serves both an agent and a person clicking Submit. Fields arrive as
`FormData` entries — a string, a `File`, or an array when a name repeats.

### App-level hooks and budgets

`app.provide(WEBMCP_CONFIG, { onToolCall, onToolResult, budgets })` reaches every tool,
including those registered from Pinia stores. Set `budgets: 'error'` in test runs so
over-budget names, descriptions or results fail instead of warning.

## Common Mistakes

### HIGH Assigning document.modelContext in tests

`document.modelContext` is `readonly`. Use the shipped stub, which tracks the spec.

Wrong:

```ts
document.modelContext = { registerTool: vi.fn() }
```

Right:

```ts
import { installModelContextStub, uninstallModelContextStub } from 'vue-webmcp/testing'

let stub: ModelContextStub
beforeEach(() => { stub = installModelContextStub() })
afterEach(() => uninstallModelContextStub())

test('the editor offers save_note', async () => {
  mount(NoteEditor)
  expect(stub.names()).toEqual(['save_note'])
  expect(await stub.call('save_note', { title: 'Groceries' })).toEqual({
    content: [{ type: 'text', text: 'Saved "Groceries".' }],
  })
})
```

For Playwright, `context.addInitScript(MODEL_CONTEXT_INIT_SCRIPT)`; for Puppeteer,
`page.evaluateOnNewDocument`.

### HIGH Hand-rolling registration in lifecycle hooks

The composable already does this, including re-registration when reactive options change
and the 10-second wait for a late-injected API.

Wrong:

```ts
const controller = new AbortController()
onMounted(() => {
  document.modelContext?.registerTool({ name, description, execute }, { signal: controller.signal })
})
onUnmounted(() => controller.abort())
```

Right:

```ts
useWebMCPTool({ name, description, execute })
```

### MEDIUM Constraining Args with an interface

If you wrap the composable and constrain `Args extends Record<string, unknown>`, an
`interface` will not satisfy it — interfaces have no implicit index signature. Declare
argument shapes with `type`, or leave the constraint off.

Wrong:

```ts
interface AddTodoArgs { text: string }
```

Right:

```ts
type AddTodoArgs = { text: string }
```

### MEDIUM One tool name from a component rendered more than once

Two mounted instances register the same name twice. Include the instance in the name, or
keep one on screen.

```ts
useWebMCPTool({ name: `save_note_${props.noteId}`, /* … */ })
```

### MEDIUM Binding a class to isAgentActive for an autosubmit form

Chrome submits a `toolautosubmit` form before it activates the tool and dispatches no
`toolcancel`, so `isAgentActive` stays `false` for the whole call. Use `isSubmitting` to
show that one.

### LOW Hand-building the MCP result shape

Wrong:

```ts
execute: async ({ text }) => ({ content: [{ type: 'text', text: `Added "${text}".` }] })
```

Right:

```ts
execute: async ({ text }) => `Added "${text}".`
```

## API Discovery

- `vue-webmcp` — `useWebMCPTool`, `useWebMCPTools`, `defineWebMCPTool`,
  `useRegisteredTools`, `useWebMCPForm`, `WEBMCP_CONFIG`, `provideWebMCPConfig`,
  `toToolResponse`, `toErrorResponse`.
- `vue-webmcp/testing` — `installModelContextStub`, `uninstallModelContextStub`,
  `MODEL_CONTEXT_INIT_SCRIPT`, and the `ModelContextStub` type.
- `nuxt-webmcp` auto-imports all of the composables and injects origin-trial tokens.

Importing `vue-webmcp` types `document.modelContext`; `webmcp-types` needs no separate
install. Full documentation is in the package README.

## Security

Tools act with the signed-in user's session. Mark non-mutating tools
`annotations: { readOnlyHint: true }`, and mark tools whose output embeds user or
third-party content `untrustedContentHint: true` so agents do not follow it as
instructions. Never expose an operation as a tool that you would not expose as an
unauthenticated-intent button. Chrome's character budgets are 30 per name, 500 per tool
description, 150 per parameter description and 1.5K per output.
