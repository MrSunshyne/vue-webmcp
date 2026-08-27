import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { defineWebMCPTool, useWebMCPTools } from '../src'
import type { UseWebMCPToolReturn } from '../src'
import { cleanupModelContext, installFakeModelContext, mountComposable } from './harness'

const searchNotes = defineWebMCPTool({
  name: 'search_notes',
  description: 'Search notes by text',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  annotations: { readOnlyHint: true },
  execute: ({ query }: { query: string }) => `found ${query}`,
})

const addNote = defineWebMCPTool({
  name: 'add_note',
  description: 'Add a note',
  execute: () => 'added',
})

afterEach(() => {
  cleanupModelContext()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('defineWebMCPTool', () => {
  it('returns the definition unchanged and keeps the argument type', () => {
    expect(searchNotes.name).toBe('search_notes')
    expectTypeOf(searchNotes.execute).parameter(0).toEqualTypeOf<{ query: string }>()
  })
})

describe('useWebMCPTools', () => {
  it('registers every tool and reports the group state', () => {
    const { tools } = installFakeModelContext()
    const { result } = mountComposable(() => useWebMCPTools([searchNotes, addNote]))

    expect(result.isSupported.value).toBe(true)
    expect(result.isRegistered.value).toBe(true)
    expect(result.error.value).toBeNull()
    expect([...tools.keys()].sort()).toEqual(['add_note', 'search_notes'])
    // Static names in the list become the keys of byName.
    expectTypeOf<keyof typeof result.byName>().toEqualTypeOf<'search_notes' | 'add_note'>()
    expectTypeOf(result.byName.add_note).toEqualTypeOf<UseWebMCPToolReturn>()
    expect(result.byName.add_note.isRegistered.value).toBe(true)
  })

  it('applies shared options, with per-tool options winning', async () => {
    const { tools, registerTool } = installFakeModelContext()
    const loaded = ref(false)
    const { result } = mountComposable(() =>
      useWebMCPTools([searchNotes, { ...addNote, enabled: true }], {
        enabled: loaded,
        annotations: { untrustedContentHint: true },
        exposedTo: ['https://agent.example'],
      }),
    )

    // add_note sets its own enabled, so it registers straight away, and the
    // disabled search_notes does not count against the group.
    expect([...tools.keys()]).toEqual(['add_note'])
    expect(result.isRegistered.value).toBe(true)

    loaded.value = true
    await nextTick()
    expect(tools.size).toBe(2)
    expect(result.isRegistered.value).toBe(true)

    const search = registerTool.mock.calls.find(call => call[0].name === 'search_notes')!
    // search_notes keeps its own annotations; add_note takes the shared ones.
    expect(search[0].annotations).toEqual({ readOnlyHint: true })
    expect(search[1]?.exposedTo).toEqual(['https://agent.example'])
    const add = registerTool.mock.calls.find(call => call[0].name === 'add_note')!
    expect(add[0].annotations).toEqual({ untrustedContentHint: true })
  })

  it('lets a tool switch itself off under a shared enabled, and a shared false switch the rest off', () => {
    const { tools } = installFakeModelContext()
    const { result } = mountComposable(() =>
      useWebMCPTools([{ ...searchNotes, enabled: false }, addNote], { enabled: true }),
    )
    expect([...tools.keys()]).toEqual(['add_note'])
    expect(result.isRegistered.value).toBe(true)

    const off = mountComposable(() =>
      useWebMCPTools([{ ...addNote, name: 'off_note' }], { enabled: false }),
    )
    expect(tools.has('off_note')).toBe(false)
    expect(off.result.isRegistered.value).toBe(false)
  })

  it('handles tools named after Object.prototype members', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tools } = installFakeModelContext()
    const { result } = mountComposable(() =>
      useWebMCPTools([
        { name: 'constructor', description: 'C', execute: () => 'ok' },
        { name: '__proto__', description: 'P', execute: () => 'ok' },
      ]),
    )

    expect(warnSpy).not.toHaveBeenCalled()
    expect([...tools.keys()].sort()).toEqual(['__proto__', 'constructor'])
    expect(result.byName.constructor.isRegistered.value).toBe(true)
    expect(result.byName.__proto__.isRegistered.value).toBe(true)
    expect(result.isRegistered.value).toBe(true)
  })

  it('routes failures to the shared onError with the tool name, unless the tool has its own', async () => {
    const { tools } = installFakeModelContext()
    const sharedOnError = vi.fn()
    const ownOnError = vi.fn()
    mountComposable(() =>
      useWebMCPTools(
        [
          {
            name: 'fails',
            description: 'Fails',
            execute: () => {
              throw new Error('nope')
            },
          },
          {
            name: 'fails_too',
            description: 'Fails too',
            onError: ownOnError,
            execute: () => {
              throw new Error('nope either')
            },
          },
        ],
        { onError: sharedOnError },
      ),
    )

    await tools.get('fails')!.execute({})
    await tools.get('fails_too')!.execute({})

    expect(sharedOnError).toHaveBeenCalledTimes(1)
    expect(sharedOnError).toHaveBeenCalledWith(expect.any(Error), 'fails')
    expect(ownOnError).toHaveBeenCalledTimes(1)
  })

  it('surfaces the first registration error of the group', () => {
    const { registerTool } = installFakeModelContext()
    registerTool.mockImplementation(tool => {
      if (tool.name === 'add_note') throw new DOMException('denied', 'NotAllowedError')
      return Promise.resolve()
    })
    const { result } = mountComposable(() => useWebMCPTools([searchNotes, addNote]))

    expect(result.isRegistered.value).toBe(false)
    expect(result.error.value?.name).toBe('NotAllowedError')
    expect(result.byName.search_notes.isRegistered.value).toBe(true)
    expect(result.byName.add_note.error.value?.name).toBe('NotAllowedError')
  })

  it('unregisters the whole group on unmount', () => {
    const { tools } = installFakeModelContext()
    const { unmount } = mountComposable(() => useWebMCPTools([searchNotes, addNote]))
    expect(tools.size).toBe(2)

    unmount()
    expect(tools.size).toBe(0)
  })

  it('warns in dev about a duplicate name', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installFakeModelContext()
    mountComposable(() => useWebMCPTools([addNote, addNote]))

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"add_note" twice'))
  })

  it('reports an empty group as not registered', () => {
    installFakeModelContext()
    const { result } = mountComposable(() => useWebMCPTools([]))

    expect(result.isSupported.value).toBe(false)
    expect(result.isRegistered.value).toBe(false)
  })
})
