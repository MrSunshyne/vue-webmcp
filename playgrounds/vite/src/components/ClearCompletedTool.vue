<script setup lang="ts">
import { useWebMCPTool } from 'vue-webmcp'

const props = defineProps<{ todos: { done: boolean }[] }>()
const emit = defineEmits<{ clear: [] }>()

const { isRegistered } = useWebMCPTool({
  name: 'clear-completed',
  description: 'Remove all completed items from the todo list',
  async execute() {
    const removed = props.todos.filter(t => t.done).length
    emit('clear')
    return `Removed ${removed} completed item(s).`
  },
})
</script>

<template>
  <p class="hint">
    {{ isRegistered ? 'clear-completed is registered while this panel is mounted.' : 'Waiting for modelContext…' }}
  </p>
</template>
