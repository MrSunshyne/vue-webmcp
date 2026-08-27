import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useRegisteredTools, useWebMCPTool } from '../src'
import type { UseRegisteredToolsReturn } from '../src'
import {
  cleanupModelContext,
  installFakeModelContext,
  installRegisterOnlyModelContext,
  mountComposable,
} from './harness'

// getTools() resolves on a microtask; toolchange refreshes on the next one.
async function settle(): Promise<void> {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  cleanupModelContext()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('support detection', () => {
  it('reports isSupported: false without a modelContext, then connects on late injection', async () => {
    vi.useFakeTimers()
    const { result } = mountComposable(() => useRegisteredTools())
    expect(result.isSupported.value).toBe(false)
    expect(result.tools.value).toEqual([])

    const { context } = installFakeModelContext()
    context.registerTool({ name: 'late', description: 'Late', execute: () => ({ content: [] }) })
    vi.advanceTimersByTime(500)
    expect(result.isSupported.value).toBe(true)

    vi.useRealTimers()
    await settle()
    expect(result.tools.value.map(t => t.name)).toEqual(['late'])
  })

  it('reports isSupported: false on a registerTool-only context and warns in dev', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installRegisterOnlyModelContext()
    const { result } = mountComposable(() => useRegisteredTools())

    expect(result.isSupported.value).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('getTools'))
  })
})

describe('discovery', () => {
  it('lists registered tools and follows toolchange', async () => {
    const { context } = installFakeModelContext()
    context.registerTool({ name: 'b-tool', description: 'B', execute: () => ({ content: [] }) })
    const { result } = mountComposable(() => useRegisteredTools())

    await settle()
    expect(result.isSupported.value).toBe(true)
    expect(result.tools.value.map(t => t.name)).toEqual(['b-tool'])
    expect(result.tools.value[0]?.origin).toBe(location.origin)

    // A component registering a tool shows up; unmounting it removes it.
    const { unmount } = mountComposable(() =>
      useWebMCPTool({ name: 'a-tool', description: 'A', execute: () => 'ok' }),
    )
    await settle()
    expect(result.tools.value.map(t => t.name)).toEqual(['a-tool', 'b-tool'])

    unmount()
    await settle()
    expect(result.tools.value.map(t => t.name)).toEqual(['b-tool'])
  })

  it('parses a stringified inputSchema from older browsers into an object', async () => {
    const { context } = installFakeModelContext()
    const schema = { type: 'object', properties: { q: { type: 'string' } } }
    context.getTools.mockResolvedValue([
      {
        name: 'search',
        title: '',
        description: 'Search',
        inputSchema: JSON.stringify(schema) as unknown as object,
        window,
        origin: location.origin,
      },
    ])
    const { result } = mountComposable(() => useRegisteredTools())

    await settle()
    expect(result.tools.value[0]?.inputSchema).toEqual(schema)
  })

  it('passes fromOrigins through and refreshes when it changes', async () => {
    const { context } = installFakeModelContext()
    const fromOrigins = ref(['https://partner.example'])
    mountComposable(() => useRegisteredTools({ fromOrigins }))

    await settle()
    expect(context.getTools).toHaveBeenLastCalledWith({ fromOrigins: ['https://partner.example'] })

    fromOrigins.value = ['https://partner.example', 'https://other.example']
    await settle()
    expect(context.getTools).toHaveBeenCalledTimes(2)
    expect(context.getTools).toHaveBeenLastCalledWith({
      fromOrigins: ['https://partner.example', 'https://other.example'],
    })
  })

  it('surfaces a getTools failure in error and clears it on the next success', async () => {
    const { context } = installFakeModelContext()
    context.getTools.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    const { result } = mountComposable(() => useRegisteredTools())

    await settle()
    expect(result.error.value?.name).toBe('NotAllowedError')
    expect(result.tools.value).toEqual([])

    await result.refresh()
    expect(result.error.value).toBeNull()
  })

  it('keeps the newest query when an older one resolves late', async () => {
    const { context } = installFakeModelContext()
    let releaseFirst: (tools: never[]) => void = () => {}
    context.getTools
      .mockImplementationOnce(() => new Promise(resolve => (releaseFirst = resolve)))
      .mockResolvedValueOnce([
        { name: 'fresh', title: '', description: '', window, origin: location.origin },
      ])
    const { result } = mountComposable(() => useRegisteredTools())

    await result.refresh()
    expect(result.tools.value.map(t => t.name)).toEqual(['fresh'])

    releaseFirst([])
    await settle()
    expect(result.tools.value.map(t => t.name)).toEqual(['fresh'])
  })
})

describe('execution', () => {
  it('runs a discovered tool with a signal and parses the JSON result', async () => {
    const { context } = installFakeModelContext()
    const execute = vi.fn((args: { text: string }) => `added ${args.text}`)
    mountComposable(() => useWebMCPTool({ name: 'add', description: 'Add', execute }))
    const { result } = mountComposable(() => useRegisteredTools())
    await settle()

    const controller = new AbortController()
    const tool = result.tools.value[0]!
    const output = await result.execute(tool, { text: 'milk' }, { signal: controller.signal })

    // The JSON string Chrome shipped with goes first; the fake accepts it.
    expect(context.executeTool).toHaveBeenCalledWith(tool, '{"text":"milk"}', {
      signal: controller.signal,
    })
    expect(execute).toHaveBeenCalledWith({ text: 'milk' }, { signal: expect.any(AbortSignal) })
    expect(output).toEqual({ content: [{ type: 'text', text: 'added milk' }] })
  })

  it('switches to the object form when the browser rejects the string with a TypeError', async () => {
    const { context } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ name: 'add', description: 'Add', execute: () => 'ok' }))
    const { result } = mountComposable(() => useRegisteredTools())
    await settle()

    // An `object` parameter fails WebIDL conversion for a string, before the tool runs.
    const objectOnly = context.executeTool.getMockImplementation()!
    context.executeTool.mockImplementation((tool, args, options) =>
      typeof args === 'string'
        ? Promise.reject(new TypeError("parameter 2 is not of type 'Object'"))
        : objectOnly(tool, args, options),
    )

    const tool = result.tools.value[0]!
    await result.execute(tool, { text: 'a' })
    await result.execute(tool, { text: 'b' })

    const payloads = context.executeTool.mock.calls.map(call => call[1])
    expect(payloads).toEqual(['{"text":"a"}', { text: 'a' }, { text: 'b' }])
  })

  it('does not retry when the tool itself fails, and rejects with the browser error', async () => {
    const { context } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ name: 'add', description: 'Add', execute: () => 'ok' }))
    const { result } = mountComposable(() => useRegisteredTools())
    await settle()

    context.executeTool.mockRejectedValueOnce(new DOMException('boom', 'UnknownError'))
    await expect(result.execute(result.tools.value[0]!)).rejects.toMatchObject({
      name: 'UnknownError',
    })
    expect(context.executeTool).toHaveBeenCalledTimes(1)
  })

  it('honours an explicit argumentFormat', async () => {
    const { context } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ name: 'add', description: 'Add', execute: () => 'ok' }))
    const asObject = mountComposable(() => useRegisteredTools({ argumentFormat: 'object' }))
    const asJson = mountComposable(() => useRegisteredTools({ argumentFormat: 'json' }))
    await settle()

    await asObject.result.execute(asObject.result.tools.value[0]!, { text: 'milk' })
    await asJson.result.execute(asJson.result.tools.value[0]!, { text: 'milk' })

    const payloads = context.executeTool.mock.calls.map(call => call[1])
    expect(payloads).toEqual([{ text: 'milk' }, '{"text":"milk"}'])
  })

  it('returns a non-JSON result as is', async () => {
    const { context } = installFakeModelContext()
    // A polyfill may resolve with the value itself rather than JSON text.
    context.executeTool.mockResolvedValueOnce({ content: [] } as unknown as string)
    mountComposable(() => useWebMCPTool({ name: 'add', description: 'Add', execute: () => 'ok' }))
    const { result } = mountComposable(() => useRegisteredTools())
    await settle()

    expect(await result.execute(result.tools.value[0]!)).toEqual({ content: [] })
  })

  it('rejects with NotSupportedError when the consumer API is absent', async () => {
    // Fake timers keep this instance's late-injection poll out of later tests.
    vi.useFakeTimers()
    const { result } = mountComposable(() => useRegisteredTools())
    await expect(
      result.execute({ name: 'x', title: '', description: '', window, origin: location.origin }),
    ).rejects.toMatchObject({ name: 'NotSupportedError' })
  })
})

describe('scope handling', () => {
  it('stops following toolchange and goes inert once the scope is disposed', async () => {
    const { context } = installFakeModelContext()
    const scope = effectScope()
    let result: UseRegisteredToolsReturn | undefined
    scope.run(() => {
      result = useRegisteredTools()
    })
    await settle()
    expect(context.getTools).toHaveBeenCalledTimes(1)

    scope.stop()
    context.registerTool({ name: 'later', description: 'Later', execute: () => ({ content: [] }) })
    await settle()
    expect(context.getTools).toHaveBeenCalledTimes(1)
    expect(result?.tools.value).toEqual([])

    // A call after disposal neither queries nor executes anything.
    await result!.refresh()
    expect(context.getTools).toHaveBeenCalledTimes(1)
    await expect(
      result!.execute({ name: 'later', title: '', description: '', window, origin: location.origin }),
    ).rejects.toMatchObject({ name: 'NotSupportedError' })
    expect(context.executeTool).not.toHaveBeenCalled()
  })
})
