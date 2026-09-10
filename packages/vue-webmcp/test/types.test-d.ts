/**
 * Type-level tests for schema-inferred execute arguments. Statically checked
 * by Vitest typecheck mode; never executed.
 */
import { describe, expectTypeOf, it } from 'vitest'
import { computed, ref } from 'vue'
import { defineWebMCPTool, useWebMCPTool } from '../src'

describe('schema-inferred execute args', () => {
  it('infers required and optional properties from a literal inputSchema', () => {
    useWebMCPTool({
      name: 'add-todo',
      description: 'Add a todo',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          priority: { type: 'number' },
        },
        required: ['text'],
      },
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<{ text: string; priority?: number }>()
        return 'ok'
      },
    })
  })

  it('infers enum members and arrays', () => {
    useWebMCPTool({
      name: 'set-view',
      description: 'Switch the view',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { enum: ['list', 'grid'] },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['mode'],
      },
      execute(args) {
        expectTypeOf(args.mode).toEqualTypeOf<'list' | 'grid'>()
        expectTypeOf(args.tags).toEqualTypeOf<string[] | undefined>()
        return 'ok'
      },
    })
  })

  it('types formatOutput with the inferred args', () => {
    useWebMCPTool({
      name: 'search',
      description: 'Search',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
      execute: ({ query }) => query.toUpperCase(),
      formatOutput(result, args) {
        expectTypeOf(result).toEqualTypeOf<string>()
        expectTypeOf(args).toEqualTypeOf<{ query: string }>()
        return result
      },
    })
  })

  it('falls back to Record<string, unknown> for a ref or getter schema', () => {
    const schema = ref({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    })
    useWebMCPTool({
      name: 'reactive-schema',
      description: 'Reactive schema',
      inputSchema: schema,
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<Record<string, unknown>>()
        return 'ok'
      },
    })
    useWebMCPTool({
      name: 'getter-schema',
      description: 'Getter schema',
      inputSchema: () => ({ type: 'object' as const }),
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<Record<string, unknown>>()
        return 'ok'
      },
    })
    useWebMCPTool({
      name: 'computed-schema',
      description: 'Computed schema',
      inputSchema: computed(() => ({ type: 'object' })),
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<Record<string, unknown>>()
        return 'ok'
      },
    })
  })

  it('keeps the manual Args type argument working, schema present or not', () => {
    type SearchArgs = { query: string; limit?: number }
    useWebMCPTool<SearchArgs>({
      name: 'typed-search',
      description: 'Typed search',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<SearchArgs>()
        return args.query
      },
    })
    useWebMCPTool<SearchArgs>({
      name: 'typed-no-schema',
      description: 'Typed, no schema',
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<SearchArgs>()
        return args.query
      },
    })
  })

  it('defaults to Record<string, unknown> without an inputSchema', () => {
    useWebMCPTool({
      name: 'no-schema',
      description: 'No schema',
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<Record<string, unknown>>()
        return 'ok'
      },
    })
  })

  it('infers through defineWebMCPTool and keeps the literal name', () => {
    const tool = defineWebMCPTool({
      name: 'save-note',
      description: 'Save the note',
      inputSchema: {
        type: 'object',
        properties: { body: { type: 'string' } },
        required: ['body'],
      },
      execute({ body }) {
        expectTypeOf(body).toEqualTypeOf<string>()
        return body
      },
    })
    expectTypeOf(tool.name).toEqualTypeOf<'save-note'>()

    type NoteArgs = { body: string }
    const manual = defineWebMCPTool<NoteArgs>({
      name: 'save-note-manual',
      description: 'Save the note',
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<NoteArgs>()
        return args.body
      },
    })
    // An explicit type argument switches off inference for the remaining
    // type parameters, so `Name` falls back to its `string` default. This
    // predates the schema overload.
    expectTypeOf(manual.name).toEqualTypeOf<string>()
  })
})

describe('hoisted schema variables', () => {
  it('keeps full inference for a schema hoisted with as const', () => {
    const schema = {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    } as const
    useWebMCPTool({
      name: 'hoisted-const',
      description: 'Hoisted as const',
      inputSchema: schema,
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<{ text: string }>()
        return 'ok'
      },
    })
  })

  it('degrades a widened hoisted schema to optional unknown properties', () => {
    const schema = {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    }
    useWebMCPTool({
      name: 'hoisted-widened',
      description: 'Hoisted without as const',
      inputSchema: schema,
      execute(args) {
        expectTypeOf(args).toEqualTypeOf<{ text?: unknown }>()
        return 'ok'
      },
    })
  })
})
