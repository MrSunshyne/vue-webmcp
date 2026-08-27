<script setup lang="ts">
import { ref } from 'vue'
import { useRegisteredTools } from 'vue-webmcp'
import type { RegisteredTool } from 'vue-webmcp'

// The same list the browser's agent gets, from this page's point of view.
const { isSupported, tools, error, execute } = useRegisteredTools()
const output = ref('')

// Only tools that take no required arguments can be run with an empty object.
function runnable(tool: RegisteredTool): boolean {
  const required = (tool.inputSchema as { required?: unknown[] } | undefined)?.required
  return !required?.length
}

async function run(tool: RegisteredTool) {
  try {
    output.value = JSON.stringify(await execute(tool), null, 2)
  } catch (err) {
    output.value = `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}
</script>

<template>
  <section>
    <h2>What an agent sees</h2>
    <p v-if="!isSupported" class="hint">
      No <code>getTools()</code> here. Discovery needs the browser's modelContext, not only a
      registration polyfill.
    </p>
    <p v-else-if="error" class="banner err">getTools failed: {{ error.message }}</p>
    <ul v-else class="tools">
      <li v-for="tool in tools" :key="tool.name">
        <span><code>{{ tool.name }}</code> {{ tool.description }}</span>
        <button v-if="runnable(tool)" type="button" @click="run(tool)">Run</button>
      </li>
    </ul>
    <pre v-if="output" class="output">{{ output }}</pre>
  </section>
</template>

<style scoped>
h2 {
  font-size: 1rem;
  margin: 0 0 0.5rem;
}
.tools {
  list-style: none;
  padding: 0;
}
.tools li {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.25rem 0;
}
.output {
  font-size: 0.8rem;
  background: #f3f3f3;
  padding: 0.5rem;
  overflow-x: auto;
}
</style>
