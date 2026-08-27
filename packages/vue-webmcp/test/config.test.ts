import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { WEBMCP_CONFIG, provideWebMCPConfig, useWebMCPTool } from '../src'
import type { WebMCPToolResponse } from '../src'
import { cleanupModelContext, installFakeModelContext, mountComposable } from './harness'

const baseOptions = { name: 'add-todo', description: 'Add a todo' }

async function invoke(
  tools: Map<string, { execute: (args: unknown) => unknown }>,
  name: string,
  args: unknown = {},
): Promise<WebMCPToolResponse> {
  return (await tools.get(name)!.execute(args)) as WebMCPToolResponse
}

afterEach(() => {
  cleanupModelContext()
  vi.restoreAllMocks()
})

describe('hooks', () => {
  it('reports a call and its result, without the arguments by default', async () => {
    const { tools } = installFakeModelContext()
    const onToolCall = vi.fn()
    const onToolResult = vi.fn()
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute: () => 'done' }), {
      config: { onToolCall, onToolResult },
    })

    const response = await invoke(tools, 'add-todo', { text: 'milk' })

    expect(onToolCall).toHaveBeenCalledWith({ name: 'add-todo' })
    expect(onToolResult).toHaveBeenCalledTimes(1)
    const event = onToolResult.mock.calls[0]![0]
    expect(event).toMatchObject({ name: 'add-todo', ok: true, response })
    expect(event).not.toHaveProperty('args')
    expect(event).not.toHaveProperty('error')
    expect(typeof event.ms).toBe('number')
  })

  it('includes the arguments when the app opts in', async () => {
    const { tools } = installFakeModelContext()
    const onToolCall = vi.fn()
    const onToolResult = vi.fn()
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute: () => 'done' }), {
      config: { includeArgs: true, onToolCall, onToolResult },
    })

    await invoke(tools, 'add-todo', { text: 'milk' })

    expect(onToolCall).toHaveBeenCalledWith({ name: 'add-todo', args: { text: 'milk' } })
    expect(onToolResult.mock.calls[0]![0].args).toEqual({ text: 'milk' })
  })

  it('reports a thrown error as ok: false with the error, after onError', async () => {
    const { tools } = installFakeModelContext()
    const order: string[] = []
    const failure = new Error('nope')
    mountComposable(
      () =>
        useWebMCPTool({
          ...baseOptions,
          execute: () => {
            throw failure
          },
          onError: () => order.push('onError'),
        }),
      { config: { onToolResult: () => order.push('onToolResult') } },
    )
    const onToolResult = vi.fn()
    mountComposable(
      () =>
        useWebMCPTool({
          ...baseOptions,
          name: 'other',
          execute: () => {
            throw failure
          },
        }),
      { config: { onToolResult } },
    )

    await invoke(tools, 'add-todo')
    await invoke(tools, 'other')

    expect(order).toEqual(['onError', 'onToolResult'])
    expect(onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'other', ok: false, error: failure }),
    )
    expect(onToolResult.mock.calls[0]![0].response.isError).toBe(true)
  })

  it('treats a pass-through isError result as ok: false', async () => {
    const { tools } = installFakeModelContext()
    const onToolResult = vi.fn()
    mountComposable(
      () =>
        useWebMCPTool({
          ...baseOptions,
          execute: () => ({ content: [{ type: 'text', text: 'no' }], isError: true }),
        }),
      { config: { onToolResult } },
    )

    await invoke(tools, 'add-todo')
    expect(onToolResult.mock.calls[0]![0]).toMatchObject({ ok: false })
    expect(onToolResult.mock.calls[0]![0]).not.toHaveProperty('error')
  })

  it('never lets a throwing hook change the result', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tools } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute: () => 'done' }), {
      config: {
        onToolCall: () => {
          throw new Error('analytics down')
        },
        onToolResult: () => {
          throw new Error('analytics down')
        },
      },
    })

    expect(await invoke(tools, 'add-todo')).toEqual({ content: [{ type: 'text', text: 'done' }] })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('analytics down'))
  })

  it('can be provided from a root component with provideWebMCPConfig', async () => {
    const { tools } = installFakeModelContext()
    const onToolCall = vi.fn()
    const Child = defineComponent({
      setup() {
        useWebMCPTool({ ...baseOptions, execute: () => 'done' })
        return () => h('div')
      },
    })
    const Root = defineComponent({
      setup() {
        provideWebMCPConfig({ onToolCall })
        return () => h(Child)
      },
    })
    createApp(Root).mount(document.createElement('div'))

    await invoke(tools, 'add-todo')
    expect(onToolCall).toHaveBeenCalledWith({ name: 'add-todo' })
  })
})

describe('budgets', () => {
  it("'error' turns an oversized result into an isError response", async () => {
    const { tools } = installFakeModelContext()
    const onError = vi.fn()
    mountComposable(
      () => useWebMCPTool({ ...baseOptions, execute: () => 'z'.repeat(1501), onError }),
      { config: { budgets: 'error' } },
    )

    const response = await invoke(tools, 'add-todo')
    expect(response.isError).toBe(true)
    expect(response.content[0]?.text).toMatch(/1501 characters/)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('false silences the checks', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tools } = installFakeModelContext()
    mountComposable(
      () =>
        useWebMCPTool({
          name: 'x'.repeat(31),
          description: 'y'.repeat(501),
          execute: () => 'z'.repeat(1501),
        }),
      { config: { budgets: false } },
    )

    await invoke(tools, 'x'.repeat(31))
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("'error' fails a later over-budget change into error without throwing", async () => {
    const { tools } = installFakeModelContext()
    const description = ref('ok')
    const { result } = mountComposable(
      () => useWebMCPTool({ ...baseOptions, description, execute: () => 'ok' }),
      { config: { budgets: 'error' } },
    )
    expect(result.isRegistered.value).toBe(true)

    description.value = 'y'.repeat(501)
    await nextTick()
    expect(result.isRegistered.value).toBe(false)
    expect(result.error.value?.message).toMatch(/501-character description/)
    expect(tools.size).toBe(0)
  })

  it("'error' throws from setup for an over-budget initial definition", () => {
    const { tools } = installFakeModelContext()
    // runWithContext gives the composable an injection context without
    // mounting, so the throw leaves no half-initialized component behind.
    const app = createApp({ render: () => h('div') })
    app.provide(WEBMCP_CONFIG, { budgets: 'error' })
    expect(() =>
      app.runWithContext(() =>
        useWebMCPTool({ name: 'x'.repeat(31), description: 'ok', execute: () => 'ok' }),
      ),
    ).toThrow(/31 characters/)
    expect(tools.size).toBe(0)
  })
})
