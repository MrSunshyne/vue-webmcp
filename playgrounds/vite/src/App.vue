<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWebMCPTool } from 'vue-webmcp'
import ClearCompletedTool from './components/ClearCompletedTool.vue'

interface Todo {
  id: number
  text: string
  done: boolean
}

const todos = ref<Todo[]>([
  { id: 1, text: 'Enable chrome://flags/#enable-webmcp-testing', done: false },
  { id: 2, text: 'Install the Model Context Tool Inspector extension', done: false },
])
let nextId = 3

const draft = ref('')
const exposeClearTool = ref(false)
const remaining = computed(() => todos.value.filter(t => !t.done).length)

function addTodo(text: string) {
  todos.value.push({ id: nextId++, text, done: false })
}

function submit() {
  const text = draft.value.trim()
  if (!text) return
  addTodo(text)
  draft.value = ''
}

function clearCompleted() {
  todos.value = todos.value.filter(t => !t.done)
}

const { isSupported, isRegistered, error } = useWebMCPTool({
  name: 'add-todo',
  description: "Add a new item to the user's active todo list",
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The text content of the todo item' },
    },
    required: ['text'],
  },
  async execute({ text }: { text: string }) {
    addTodo(text)
    return `Added todo item: "${text}" successfully.`
  },
})

useWebMCPTool({
  name: 'list-todos',
  description: 'List all todo items with their completion state',
  annotations: { readOnlyHint: true },
  execute: () =>
    todos.value.map(t => `${t.done ? '[x]' : '[ ]'} ${t.text}`).join('\n') || 'The list is empty.',
})
</script>

<template>
  <main>
    <h1>vue-webmcp playground</h1>

    <p v-if="!isSupported" class="banner off">
      No modelContext API in this browser. Use Chrome 149+ with
      <code>chrome://flags/#enable-webmcp-testing</code> enabled, then reload.
    </p>
    <p v-else-if="error" class="banner err">Registration failed: {{ error.message }}</p>
    <p v-else-if="isRegistered" class="banner on">
      add-todo and list-todos are registered. Invoke them from the Tool Inspector extension.
    </p>

    <form @submit.prevent="submit">
      <input v-model="draft" placeholder="New todo" aria-label="New todo" />
      <button type="submit">Add</button>
    </form>

    <ul>
      <li v-for="todo in todos" :key="todo.id">
        <label>
          <input v-model="todo.done" type="checkbox" />
          <span :class="{ done: todo.done }">{{ todo.text }}</span>
        </label>
      </li>
    </ul>
    <p class="hint">{{ remaining }} remaining</p>

    <section>
      <label>
        <input v-model="exposeClearTool" type="checkbox" />
        Mount the clear-completed panel
      </label>
      <ClearCompletedTool v-if="exposeClearTool" :todos="todos" @clear="clearCompleted" />
      <p class="hint">
        The <code>clear-completed</code> tool is only registered while the panel above is mounted.
      </p>
    </section>
  </main>
</template>

<style>
body {
  font-family: system-ui, sans-serif;
  margin: 0;
  background: #fafafa;
  color: #1a1a1a;
}
main {
  max-width: 34rem;
  margin: 3rem auto;
  padding: 0 1rem;
}
.banner {
  padding: 0.6rem 0.8rem;
  border-radius: 6px;
  border: 1px solid;
}
.banner.on {
  background: #eefaf0;
  border-color: #9ad7a5;
}
.banner.off {
  background: #f3f3f3;
  border-color: #ccc;
}
.banner.err {
  background: #fdeeee;
  border-color: #e2a1a1;
}
form {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
form input {
  flex: 1;
  padding: 0.45rem 0.6rem;
}
ul {
  list-style: none;
  padding: 0;
}
li {
  padding: 0.25rem 0;
}
.done {
  text-decoration: line-through;
  opacity: 0.6;
}
.hint {
  font-size: 0.85rem;
  opacity: 0.7;
}
section {
  margin-top: 2rem;
  border-top: 1px solid #e0e0e0;
  padding-top: 1rem;
}
</style>
