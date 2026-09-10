import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // *.test-d.ts files are statically checked with tsc, never executed.
    typecheck: {
      enabled: true,
    },
  },
})
