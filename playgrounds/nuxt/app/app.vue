<script setup lang="ts">
const notes = ref([
  { title: 'WebMCP in origin trial', body: 'Chrome 149 to 156, ship target 157.' },
  { title: 'Tools follow the UI', body: 'Registration is scoped to component lifetime.' },
  { title: 'SSR is a no-op', body: 'Tools register after hydration, on the client only.' },
])

// Auto-imported by nuxt-webmcp
const { isSupported, isRegistered } = useWebMCPTool({
  name: 'search-notes',
  description: 'Search notes by keyword and return matching titles with their text',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Keyword to search for' } },
    required: ['query'],
  },
  annotations: { readOnlyHint: true },
  execute({ query }: { query: string }) {
    const q = query.toLowerCase()
    const hits = notes.value.filter(
      n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    )
    if (hits.length === 0) return `No notes match "${query}".`
    return hits.map(n => `${n.title}: ${n.body}`).join('\n')
  },
})
</script>

<template>
  <main style="max-width: 34rem; margin: 3rem auto; font-family: system-ui, sans-serif">
    <h1>nuxt-webmcp playground</h1>
    <ClientOnly>
      <p v-if="isSupported && isRegistered">🤖 search-notes is registered</p>
      <p v-else>
        No modelContext API — enable <code>chrome://flags/#enable-webmcp-testing</code> and reload.
      </p>
    </ClientOnly>
    <ul>
      <li v-for="note in notes" :key="note.title">
        <strong>{{ note.title }}</strong> — {{ note.body }}
      </li>
    </ul>
  </main>
</template>
