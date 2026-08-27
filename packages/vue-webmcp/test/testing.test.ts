import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useRegisteredTools, useWebMCPTool } from '../src'
import {
  MODEL_CONTEXT_INIT_SCRIPT,
  installModelContextStub,
  uninstallModelContextStub,
} from '../src/testing'
import { mountComposable } from './harness'

afterEach(() => {
  uninstallModelContextStub()
  vi.restoreAllMocks()
})

describe('installModelContextStub', () => {
  it('records registrations from useWebMCPTool and calls them like an agent', async () => {
    const stub = installModelContextStub()
    const { unmount } = mountComposable(() =>
      useWebMCPTool({
        name: 'add-todo',
        description: 'Add a todo',
        execute: ({ text }: { text: string }) => `added ${text}`,
      }),
    )

    expect(document.modelContext).toBe(stub)
    expect(stub.names()).toEqual(['add-todo'])
    expect(await stub.call('add-todo', { text: 'milk' })).toEqual({
      content: [{ type: 'text', text: 'added milk' }],
    })

    unmount()
    expect(stub.names()).toEqual([])
  })

  it('implements getTools, executeTool and toolchange for useRegisteredTools', async () => {
    const stub = installModelContextStub()
    const onChange = vi.fn()
    stub.addEventListener('toolchange', onChange)
    mountComposable(() =>
      useWebMCPTool({ name: 'b', description: 'B', execute: () => 'ok' }),
    )
    mountComposable(() =>
      useWebMCPTool({ name: 'a', description: 'A', execute: () => 'ok' }),
    )
    const { result } = mountComposable(() => useRegisteredTools())
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(result.tools.value.map(t => t.name)).toEqual(['a', 'b'])
    expect(await result.execute(result.tools.value[0]!)).toEqual({
      content: [{ type: 'text', text: 'ok' }],
    })
  })

  it('rejects a duplicate name and hands a JSON-string argument to the tool', async () => {
    const stub = installModelContextStub()
    const execute = vi.fn((args: unknown) => args)
    await stub.registerTool({ name: 'echo', description: 'Echo', execute })
    await expect(
      stub.registerTool({ name: 'echo', description: 'Echo', execute }),
    ).rejects.toMatchObject({ name: 'InvalidStateError' })

    expect(await stub.executeTool({ name: 'echo' }, '{"q":1}')).toBe('{"q":1}')
    expect(execute).toHaveBeenCalledWith({ q: 1 }, { signal: expect.any(AbortSignal) })
  })

  it('unregisters when the signal aborts', async () => {
    const stub = installModelContextStub()
    const controller = new AbortController()
    await stub.registerTool(
      { name: 'temp', description: 'T', execute: () => 'ok' },
      { signal: controller.signal },
    )
    expect(stub.names()).toEqual(['temp'])

    controller.abort()
    expect(stub.names()).toEqual([])
  })
})

describe('MODEL_CONTEXT_INIT_SCRIPT', () => {
  it('is a self-contained script that installs the same stub', async () => {
    expect(MODEL_CONTEXT_INIT_SCRIPT).not.toMatch(/import |require\(/)
    new Function(MODEL_CONTEXT_INIT_SCRIPT)()

    const stub = document.modelContext as unknown as ReturnType<typeof installModelContextStub>
    expect(typeof stub.names).toBe('function')
    mountComposable(() =>
      useWebMCPTool({ name: 'from-script', description: 'S', execute: () => 'ok' }),
    )
    expect(stub.names()).toEqual(['from-script'])
    expect(await stub.call('from-script')).toEqual({ content: [{ type: 'text', text: 'ok' }] })
  })
})
