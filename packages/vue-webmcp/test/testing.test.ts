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

  it('returns the outputSchema from getTools', async () => {
    const stub = installModelContextStub()
    const outputSchema = { type: 'object', properties: { id: { type: 'string' } } }
    await stub.registerTool({ name: 'save', description: 'Save', outputSchema, execute: () => 'ok' })

    const [tool] = await stub.getTools()
    expect(tool!.outputSchema).toEqual(outputSchema)
  })

  it('round-trips every annotation through registerTool and getTools', async () => {
    const stub = installModelContextStub()
    const annotations = {
      readOnlyHint: true,
      untrustedContentHint: true,
      consequentialHint: true,
      debugging: true,
    }
    await stub.registerTool({ name: 'book', description: 'Book it', annotations, execute: () => 'ok' })

    const [tool] = await stub.getTools()
    expect(tool!.annotations).toEqual(annotations)
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

  it('rejects a cancelled call at once and aborts the tool, firing toolcancel', async () => {
    const stub = installModelContextStub()
    let toolSignal!: AbortSignal
    // A tool that ignores its signal and never settles.
    await stub.registerTool({
      name: 'slow',
      description: 'Slow',
      execute: (_args, options) => {
        toolSignal = options!.signal
        return new Promise(() => {})
      },
    })
    const cancelled = vi.fn((event: Event) => (event as ToolCancelEvent).toolName)
    stub.addEventListener('toolcancel', cancelled)

    const controller = new AbortController()
    const call = stub.executeTool({ name: 'slow' }, {}, { signal: controller.signal })
    controller.abort(new DOMException('took too long', 'TimeoutError'))

    // The caller gets its own reason; the tool sees a plain AbortError.
    await expect(call).rejects.toMatchObject({ name: 'TimeoutError', message: 'took too long' })
    expect(toolSignal.aborted).toBe(true)
    expect((toolSignal.reason as DOMException).name).toBe('AbortError')
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(cancelled).toHaveReturnedWith('slow')
  })

  it('stops listening to a long-lived signal once the call finishes', async () => {
    const stub = installModelContextStub()
    await stub.registerTool({ name: 'echo', description: 'Echo', execute: () => 'ok' })
    const cancelled = vi.fn()
    stub.addEventListener('toolcancel', cancelled)
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')

    await stub.executeTool({ name: 'echo' }, {}, { signal: controller.signal })
    await stub.executeTool({ name: 'echo' }, {}, { signal: controller.signal })
    controller.abort()

    expect(remove).toHaveBeenCalledTimes(2)
    expect(cancelled).not.toHaveBeenCalled()
  })

  it('checks an aborted signal before looking the tool up', async () => {
    const stub = installModelContextStub()
    const reason = new DOMException('gone', 'AbortError')
    await expect(
      stub.executeTool({ name: 'missing' }, {}, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason)
  })

  it('fires toolactivated after invoking execute, for executeTool and call', async () => {
    const stub = installModelContextStub()
    const order: string[] = []
    await stub.registerTool({
      name: 'echo',
      description: 'Echo',
      execute: () => {
        order.push('execute')
        return 'ok'
      },
    })
    stub.addEventListener('toolactivated', event => {
      order.push(`toolactivated:${(event as ToolActivatedEvent).toolName}`)
    })

    await stub.executeTool({ name: 'echo' })
    await stub.call('echo')
    expect(order).toEqual(['execute', 'toolactivated:echo', 'execute', 'toolactivated:echo'])
  })

  it('names failures the way the spec does', async () => {
    const stub = installModelContextStub()
    await stub.registerTool({
      name: 'broken',
      description: 'Broken',
      execute: () => Promise.reject(new Error('database is down')),
    })
    await stub.registerTool({
      name: 'cyclic',
      description: 'Cyclic',
      execute: () => {
        const value: Record<string, unknown> = {}
        value.self = value
        return value
      },
    })

    // Only the name crosses, as in Chrome: the tool's own message stays behind.
    const failure: unknown = await stub.executeTool({ name: 'broken' }).catch(err => err)
    expect(failure).toMatchObject({ name: 'OperationError', message: 'Tool execution failed.' })
    await expect(stub.executeTool({ name: 'cyclic' })).rejects.toMatchObject({ name: 'OperationError' })
    await expect(stub.executeTool({ name: 'broken' }, '"text"')).rejects.toMatchObject({
      name: 'DataError',
    })
    await expect(stub.executeTool({ name: 'missing' })).rejects.toMatchObject({ name: 'NotFoundError' })
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
