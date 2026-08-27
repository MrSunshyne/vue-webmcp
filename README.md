# vue-webmcp

[![CI](https://github.com/MrSunshyne/vue-webmcp/actions/workflows/ci.yml/badge.svg)](https://github.com/MrSunshyne/vue-webmcp/actions/workflows/ci.yml)

[WebMCP](https://github.com/webmachinelearning/webmcp) for the Vue and Nuxt ecosystem: expose page functionality as typed, described tools that AI agents can call — instead of having them scrape your DOM.

```vue
<script setup>
const { isRegistered } = useWebMCPTool({
  name: 'add-todo',
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The text content of the todo item' } },
    required: ['text'],
  },
  async execute({ text }) {
    addTodo(text)
    return `Added todo item: "${text}" successfully.`
  },
})
</script>
```

The tool registers when the component mounts and unregisters when it unmounts, so what the agent can do matches what is on screen.

Live demo: [mrsunshyne.github.io/vue-webmcp](https://mrsunshyne.github.io/vue-webmcp/) (needs Chrome 149+ with `chrome://flags/#enable-webmcp-testing`).

More WebMCP demos, including a [Trip Splitter](https://mrsunshyne.github.io/webmcp-demos/demos/trip-splitter/) built with this package: [webmcp-demos](https://github.com/MrSunshyne/webmcp-demos) ([live](https://mrsunshyne.github.io/webmcp-demos/)).

> **Status (2026-08-27):** WebMCP is experimental — a W3C Web Machine Learning CG draft, in origin trial in Chrome (149→156; the [Intent to Experiment](https://groups.google.com/a/chromium.org/g/blink-dev/c/gmYffo5WOE8/m/OJxuQRP3AAAJ) estimates shipping in 157) and Edge (from 150), locally testable via `chrome://flags/#enable-webmcp-testing`. ChatGPT Desktop's built-in browser calls WebMCP tools ([Site tools](https://learn.chatgpt.com/docs/webmcp)); Brave Leo has experimental support; see the spec's [implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md). WebKit [opposes](https://github.com/WebKit/standards-positions/issues/670); Mozilla is [neutral](https://github.com/mozilla/standards-positions/issues/1412). Everything here feature-detects and no-ops where the API is absent.

## Packages

| package | what it is |
| --- | --- |
| [`vue-webmcp`](packages/vue-webmcp) | The composables: `useWebMCPTool()` and `useWebMCPTools()` to register tools, `useRegisteredTools()` to discover and call them. Vue 3.3+, SSR-safe, no runtime dependencies. |
| [`nuxt-webmcp`](packages/nuxt-webmcp) | Nuxt module: auto-imports, origin-trial token injection, Permissions-Policy recipes. |

Behavioral counterpart to [`use-webmcp-tool`](https://github.com/GoogleChromeLabs/use-webmcp-tool) (React, GoogleChromeLabs) — agents observe identical registration and result semantics from both.

## Repo layout

```
packages/vue-webmcp    core composable + test suite
packages/nuxt-webmcp   Nuxt module
playgrounds/vite       todo demo (three tools, one mount-scoped)
playgrounds/nuxt       the same todo demo via the Nuxt module (auto-import, SSR)
```

```sh
pnpm install
pnpm build          # build both packages
pnpm test           # run the vue-webmcp test suite
pnpm --filter playground-vite dev
pnpm --filter playground-nuxt dev
```

To see tools actually being called: Chrome 149+ with `chrome://flags/#enable-webmcp-testing`, plus the [Model Context Tool Inspector](https://github.com/GoogleChromeLabs/webmcp-tools) extension.

## License

Apache-2.0. The normalization code and test harness are adapted from the Apache-2.0 licensed [`use-webmcp-tool`](https://github.com/GoogleChromeLabs/use-webmcp-tool) — full attribution in [NOTICE](NOTICE).

This is an independent community project, not affiliated with or endorsed by Google.
