/**
 * Behavioral contract ported from use-webmcp-tool
 * (https://github.com/GoogleChromeLabs/use-webmcp-tool),
 * Copyright 2026 Google LLC, Apache-2.0 — see NOTICE at the repository root —
 * plus Vue-specific coverage: reactive options, effectScope disposal, and
 * live-closure execute semantics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useWebMCPTool } from '../src'
import type { UseWebMCPToolReturn, WebMCPToolExecuteOptions, WebMCPToolResponse } from '../src'
import { cleanupModelContext, installFakeModelContext, mountComposable } from './harness'

const baseOptions = {
  name: 'add-todo',
  description: 'Add a todo',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
}

// Mirrors the browser side: Chrome 153+ passes `{ signal }` as the second
// argument, earlier builds pass nothing.
async function invoke(
  tools: Map<string, { execute: (args: unknown, options?: WebMCPToolExecuteOptions) => unknown }>,
  name: string,
  args: unknown = {},
  options?: WebMCPToolExecuteOptions,
): Promise<WebMCPToolResponse> {
  const tool = tools.get(name)
  if (!tool) throw new Error(`tool "${name}" is not registered`)
  return (await tool.execute(args, options)) as WebMCPToolResponse
}

afterEach(() => {
  cleanupModelContext()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('registration lifecycle', () => {
  it('registers on mount and unregisters (via abort) on unmount', () => {
    const { tools, registerTool } = installFakeModelContext()
    const { result, unmount } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, execute: () => 'ok' }),
    )

    expect(result.isSupported.value).toBe(true)
    expect(result.isRegistered.value).toBe(true)
    expect(result.error.value).toBeNull()
    expect(registerTool).toHaveBeenCalledTimes(1)
    const call = registerTool.mock.calls[0]!
    expect(call[0].name).toBe('add-todo')
    expect(call[0].description).toBe('Add a todo')
    expect(call[0].inputSchema).toEqual(baseOptions.inputSchema)

    unmount()
    expect(tools.size).toBe(0)
  })

  it('passes annotations through to registerTool', () => {
    const { registerTool } = installFakeModelContext()
    const annotations = { readOnlyHint: true, untrustedContentHint: false }
    mountComposable(() => useWebMCPTool({ ...baseOptions, annotations, execute: () => 'ok' }))

    expect(registerTool).toHaveBeenCalledTimes(1)
    expect(registerTool.mock.calls[0]![0].annotations).toEqual(annotations)
  })

  it('passes title through to registerTool and omits it when unset', () => {
    const { registerTool } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ ...baseOptions, name: 'plain', execute: () => 'ok' }))
    mountComposable(() =>
      useWebMCPTool({ ...baseOptions, name: 'titled', title: 'Add a todo', execute: () => 'ok' }),
    )

    expect(registerTool.mock.calls[0]![0]).not.toHaveProperty('title')
    expect(registerTool.mock.calls[1]![0].title).toBe('Add a todo')
  })

  it('passes exposedTo through to registerTool and omits it when unset', () => {
    const { registerTool } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ ...baseOptions, name: 'local', execute: () => 'ok' }))
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        name: 'shared',
        exposedTo: ['https://agent.example'],
        execute: () => 'ok',
      }),
    )

    expect(registerTool.mock.calls[0]![1]).not.toHaveProperty('exposedTo')
    expect(registerTool.mock.calls[1]![1]?.exposedTo).toEqual(['https://agent.example'])
  })

  it('reports isSupported: false when no modelContext exists', () => {
    vi.useFakeTimers()
    const { result, unmount } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, execute: () => 'ok' }),
    )

    expect(result.isSupported.value).toBe(false)
    expect(result.isRegistered.value).toBe(false)
    expect(result.error.value).toBeNull()
    unmount()
  })

  it('follows a reactive enabled ref, registering only while true', async () => {
    const { tools, registerTool } = installFakeModelContext()
    const enabled = ref(false)
    const { result } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, enabled, execute: () => 'ok' }),
    )

    expect(result.isSupported.value).toBe(true)
    expect(result.isRegistered.value).toBe(false)
    expect(registerTool).not.toHaveBeenCalled()

    enabled.value = true
    await nextTick()
    expect(result.isRegistered.value).toBe(true)
    expect(tools.size).toBe(1)

    enabled.value = false
    await nextTick()
    expect(result.isRegistered.value).toBe(false)
    expect(tools.size).toBe(0)
  })

  it('accepts enabled as a getter', async () => {
    const { tools } = installFakeModelContext()
    const visible = ref(true)
    const { result } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, enabled: () => visible.value, execute: () => 'ok' }),
    )

    expect(result.isRegistered.value).toBe(true)
    visible.value = false
    await nextTick()
    expect(result.isRegistered.value).toBe(false)
    expect(tools.size).toBe(0)
  })
})

describe('late injection', () => {
  it('detects a modelContext injected after mount and registers', () => {
    vi.useFakeTimers()
    const { result } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, execute: () => 'ok' }),
    )
    expect(result.isSupported.value).toBe(false)

    const { tools } = installFakeModelContext()
    vi.advanceTimersByTime(500)

    expect(result.isSupported.value).toBe(true)
    expect(result.isRegistered.value).toBe(true)
    expect(tools.size).toBe(1)
  })

  it('gives up polling after 10 seconds', () => {
    vi.useFakeTimers()
    const { result } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, execute: () => 'ok' }),
    )
    vi.advanceTimersByTime(10_000)

    const { registerTool } = installFakeModelContext()
    vi.advanceTimersByTime(5_000)

    expect(result.isSupported.value).toBe(false)
    expect(registerTool).not.toHaveBeenCalled()
  })

  it('polls again after giving up once a registration field changes', async () => {
    vi.useFakeTimers()
    const enabled = ref(true)
    const { result } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, enabled, execute: () => 'ok' }),
    )
    vi.advanceTimersByTime(10_000)
    expect(result.isSupported.value).toBe(false)

    enabled.value = false
    await nextTick()
    const { tools } = installFakeModelContext()
    vi.advanceTimersByTime(500)
    expect(result.isSupported.value).toBe(true)

    enabled.value = true
    await nextTick()
    expect(tools.size).toBe(1)
  })

  it('falls back to the deprecated navigator.modelContext with a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tools } = installFakeModelContext('navigator')
    const { result } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, execute: () => 'ok' }),
    )

    expect(result.isSupported.value).toBe(true)
    expect(result.isRegistered.value).toBe(true)
    expect(tools.size).toBe(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('navigator.modelContext'))
  })
})

describe('registration errors', () => {
  it('captures a synchronous registration error, e.g. a tools permissions policy denial', () => {
    const { registerTool } = installFakeModelContext()
    registerTool.mockImplementation(() => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    const { result } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, execute: () => 'ok' }),
    )

    expect(result.isSupported.value).toBe(true)
    expect(result.isRegistered.value).toBe(false)
    expect(result.error.value?.name).toBe('NotAllowedError')
  })

  it('captures an async rejection from a promise-returning registerTool', async () => {
    const { registerTool } = installFakeModelContext()
    registerTool.mockImplementation(() => Promise.reject(new Error('nope')))
    const { result } = mountComposable(() =>
      useWebMCPTool({ ...baseOptions, execute: () => 'ok' }),
    )

    await nextTick()
    expect(result.isRegistered.value).toBe(false)
    expect(result.error.value?.message).toBe('nope')
  })

  it('surfaces the SecurityError a browser rejects an insecure exposedTo origin with', async () => {
    const { registerTool } = installFakeModelContext()
    registerTool.mockImplementation(() =>
      Promise.reject(new DOMException('bad origin', 'SecurityError')),
    )
    const { result } = mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        exposedTo: ['http://insecure.example'],
        execute: () => 'ok',
      }),
    )

    await nextTick()
    expect(result.isRegistered.value).toBe(false)
    expect(result.error.value?.name).toBe('SecurityError')
  })
})

describe('re-registration identity', () => {
  it('re-registers when the description changes', async () => {
    const { tools, registerTool } = installFakeModelContext()
    const description = ref('Add a todo')
    mountComposable(() => useWebMCPTool({ ...baseOptions, description, execute: () => 'ok' }))

    description.value = 'Add an item to the list'
    await nextTick()

    expect(registerTool).toHaveBeenCalledTimes(2)
    expect(tools.size).toBe(1)
    expect(tools.get('add-todo')?.description).toBe('Add an item to the list')
  })

  it('re-registers when the title changes', async () => {
    const { tools, registerTool } = installFakeModelContext()
    const title = ref('Add a todo')
    mountComposable(() => useWebMCPTool({ ...baseOptions, title, execute: () => 'ok' }))

    title.value = 'Add an item'
    await nextTick()

    expect(registerTool).toHaveBeenCalledTimes(2)
    expect(tools.get('add-todo')?.title).toBe('Add an item')
  })

  it('drops the title again when it becomes undefined or null', async () => {
    const { registerTool } = installFakeModelContext()
    const title = ref<string | undefined | null>('Add a todo')
    mountComposable(() => useWebMCPTool({ ...baseOptions, title, execute: () => 'ok' }))

    title.value = undefined
    await nextTick()
    expect(registerTool).toHaveBeenCalledTimes(2)
    expect(registerTool.mock.calls[1]![0]).not.toHaveProperty('title')

    // null from a JS caller reads as unset too, without a re-registration.
    title.value = null
    await nextTick()
    expect(registerTool).toHaveBeenCalledTimes(2)
  })

  it('re-registers when exposedTo changes', async () => {
    const { registerTool } = installFakeModelContext()
    const exposedTo = ref(['https://agent.example'])
    mountComposable(() => useWebMCPTool({ ...baseOptions, exposedTo, execute: () => 'ok' }))

    exposedTo.value = ['https://agent.example', 'https://other.example']
    await nextTick()

    expect(registerTool).toHaveBeenCalledTimes(2)
    expect(registerTool.mock.calls[1]![1]?.exposedTo).toEqual([
      'https://agent.example',
      'https://other.example',
    ])
  })

  it('does not churn on a content-equal schema object', async () => {
    const { registerTool } = installFakeModelContext()
    const inputSchema = ref({ type: 'object', properties: { text: { type: 'string' } } })
    mountComposable(() => useWebMCPTool({ ...baseOptions, inputSchema, execute: () => 'ok' }))

    inputSchema.value = { type: 'object', properties: { text: { type: 'string' } } }
    await nextTick()

    expect(registerTool).toHaveBeenCalledTimes(1)
  })

  it('re-registers under the new name and removes the old tool', async () => {
    const { tools } = installFakeModelContext()
    const name = ref('add-todo')
    mountComposable(() => useWebMCPTool({ ...baseOptions, name, execute: () => 'ok' }))

    name.value = 'append-todo'
    await nextTick()

    expect(tools.size).toBe(1)
    expect(tools.has('append-todo')).toBe(true)
  })

  it('reads live reactive state in execute without re-registering', async () => {
    const { tools, registerTool } = installFakeModelContext()
    const count = ref(0)
    mountComposable(() =>
      useWebMCPTool({ ...baseOptions, execute: () => `count is ${count.value}` }),
    )

    count.value = 5
    await nextTick()

    expect(registerTool).toHaveBeenCalledTimes(1)
    const response = await invoke(tools, 'add-todo')
    expect(response.content[0]?.text).toBe('count is 5')
  })
})

describe('result normalization', () => {
  it('maps a string to a single text block', async () => {
    const { tools } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute: () => 'done' }))
    expect(await invoke(tools, 'add-todo')).toEqual({
      content: [{ type: 'text', text: 'done' }],
    })
  })

  it('maps undefined to an empty successful result', async () => {
    const { tools } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute: () => undefined }))
    expect(await invoke(tools, 'add-todo')).toEqual({ content: [] })
  })

  it('passes an already well-formed result through untouched', async () => {
    const { tools } = installFakeModelContext()
    const shaped = { content: [{ type: 'text', text: 'raw' }], isError: false }
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute: () => shaped }))
    expect(await invoke(tools, 'add-todo')).toBe(shaped)
  })

  it('JSON-serializes objects and numbers into text blocks', async () => {
    const { tools } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ ...baseOptions, name: 'obj', execute: () => ({ id: 7 }) }))
    mountComposable(() => useWebMCPTool({ ...baseOptions, name: 'num', execute: () => 42 }))

    expect((await invoke(tools, 'obj')).content[0]?.text).toBe('{"id":7}')
    expect((await invoke(tools, 'num')).content[0]?.text).toBe('42')
  })

  it('applies formatOutput before normalization, with result and args', async () => {
    const { tools } = installFakeModelContext()
    const formatOutput = vi.fn((result: string, args: { text: string }) => `${result}:${args.text}`)
    mountComposable(() =>
      useWebMCPTool({ ...baseOptions, execute: () => 'added', formatOutput }),
    )

    const response = await invoke(tools, 'add-todo', { text: 'milk' })
    expect(formatOutput).toHaveBeenCalledWith('added', { text: 'milk' })
    expect(response.content[0]?.text).toBe('added:milk')
  })
})

describe('error normalization', () => {
  it('turns a thrown Error into an isError result and fires onError', async () => {
    const { tools } = installFakeModelContext()
    const onError = vi.fn()
    const failure = new Error('not signed in')
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        execute: () => {
          throw failure
        },
        onError,
      }),
    )

    const response = await invoke(tools, 'add-todo')
    expect(response).toEqual({
      content: [{ type: 'text', text: 'not signed in' }],
      isError: true,
    })
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('turns a thrown string into an isError result', async () => {
    const { tools } = installFakeModelContext()
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        execute: () => {
          throw 'not signed in'
        },
      }),
    )
    expect(await invoke(tools, 'add-todo')).toEqual({
      content: [{ type: 'text', text: 'not signed in' }],
      isError: true,
    })
  })

  it('turns a thrown plain object into a JSON isError result', async () => {
    const { tools } = installFakeModelContext()
    const onError = vi.fn()
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        execute: () => {
          throw { code: 403 }
        },
        onError,
      }),
    )
    expect(await invoke(tools, 'add-todo')).toEqual({
      content: [{ type: 'text', text: '{"code":403}' }],
      isError: true,
    })
    expect(onError).toHaveBeenCalledWith({ code: 403 })
  })

  it('uses the message of a thrown Error-like object', async () => {
    const { tools } = installFakeModelContext()
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        execute: () => {
          throw { message: 'cross-realm failure', code: 500 }
        },
      }),
    )
    expect(await invoke(tools, 'add-todo')).toEqual({
      content: [{ type: 'text', text: 'cross-realm failure' }],
      isError: true,
    })
  })

  it('still yields an isError result when reading message throws', async () => {
    const { tools } = installFakeModelContext()
    const hostile = {
      get message(): string {
        throw new Error('no access')
      },
    }
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        execute: () => {
          throw hostile
        },
      }),
    )

    const response = await invoke(tools, 'add-todo')
    expect(response.isError).toBe(true)
    expect(typeof response.content[0]?.text).toBe('string')
  })

  it('treats a returned Error exactly like a thrown one', async () => {
    const { tools } = installFakeModelContext()
    const onError = vi.fn()
    const failure = new Error('boom')
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute: () => failure, onError }))

    const response = await invoke(tools, 'add-todo')
    expect(response.isError).toBe(true)
    expect(response.content[0]?.text).toBe('boom')
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('treats a formatOutput Error like a thrown one', async () => {
    const { tools } = installFakeModelContext()
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        execute: () => 'fine',
        formatOutput: () => new Error('shaping failed'),
      }),
    )
    const response = await invoke(tools, 'add-todo')
    expect(response.isError).toBe(true)
    expect(response.content[0]?.text).toBe('shaping failed')
  })
})

describe('execute options and signal', () => {
  it('forwards args and the browser-provided options to execute', async () => {
    const { tools } = installFakeModelContext()
    const execute = vi.fn(
      (args: { text: string }, _options: WebMCPToolExecuteOptions) => `done: ${args.text}`,
    )
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute }))

    const controller = new AbortController()
    const options = { signal: controller.signal }
    const response = await invoke(tools, 'add-todo', { text: 'buy milk' }, options)

    // Identity, not equality: two distinct AbortSignals compare equal.
    expect(execute.mock.calls[0]![0]).toEqual({ text: 'buy milk' })
    expect(execute.mock.calls[0]![1]).toBe(options)
    expect(response).toEqual({ content: [{ type: 'text', text: 'done: buy milk' }] })
  })

  it.each([undefined, {}, { signal: undefined }, null])(
    'supplies a signal that never aborts when the browser passes %o',
    async callOptions => {
      const { tools } = installFakeModelContext()
      const execute = vi.fn((_args: unknown, { signal }: WebMCPToolExecuteOptions) =>
        signal.aborted ? 'aborted' : 'live',
      )
      mountComposable(() => useWebMCPTool({ ...baseOptions, execute }))

      const response = await invoke(
        tools,
        'add-todo',
        {},
        callOptions as WebMCPToolExecuteOptions | undefined,
      )

      expect(execute.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
      expect(response.content[0]?.text).toBe('live')
    },
  )

  it('lets execute observe an abort during execution', async () => {
    const { tools } = installFakeModelContext()
    const controller = new AbortController()
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        execute: (_args, { signal }) =>
          new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted during execution')))
          }),
      }),
    )

    const pending = invoke(tools, 'add-todo', {}, { signal: controller.signal })
    controller.abort()

    expect(await pending).toEqual({
      content: [{ type: 'text', text: 'aborted during execution' }],
      isError: true,
    })
  })

  // jsdom's DOMException is not an instanceof Error, so this also pins the
  // Error-like handling in toErrorResponse: without it the text would be "{}".
  it('reports an AbortError from signal.throwIfAborted() through onError', async () => {
    const { tools } = installFakeModelContext()
    const onError = vi.fn()
    const controller = new AbortController()
    controller.abort()
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        execute: (_args, { signal }) => {
          signal.throwIfAborted()
          return 'never reached'
        },
        onError,
      }),
    )

    const response = await invoke(tools, 'add-todo', {}, { signal: controller.signal })

    expect(response.isError).toBe(true)
    expect(response.content[0]?.text).toMatch(/abort/i)
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]![0] as { name: string }).name).toBe('AbortError')
  })
})

describe('scope handling', () => {
  it('works inside a bare effectScope (e.g. a Pinia store) and unregisters on scope stop', () => {
    const { tools } = installFakeModelContext()
    const scope = effectScope()
    let result: UseWebMCPToolReturn | undefined
    scope.run(() => {
      result = useWebMCPTool({ ...baseOptions, execute: () => 'ok' })
    })

    expect(result?.isRegistered.value).toBe(true)
    expect(tools.size).toBe(1)

    scope.stop()
    expect(tools.size).toBe(0)
  })
})

describe('dev-mode descriptor warnings', () => {
  it('warns on a name outside the spec grammar and an over-budget description', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installFakeModelContext()
    mountComposable(() =>
      useWebMCPTool({
        name: 'bad name!',
        description: 'x'.repeat(501),
        execute: () => 'ok',
      }),
    )

    const messages = warnSpy.mock.calls.map(call => String(call[0]))
    expect(messages.some(m => m.includes('spec grammar'))).toBe(true)
    expect(messages.some(m => m.includes('501-character description'))).toBe(true)
  })

  it('warns on tool and param names over the 30-character guidance', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installFakeModelContext()
    mountComposable(() =>
      useWebMCPTool({
        name: 'n'.repeat(31),
        description: 'ok',
        inputSchema: { type: 'object', properties: { ['p'.repeat(31)]: { type: 'string' } } },
        execute: () => 'ok',
      }),
    )

    const messages = warnSpy.mock.calls.map(call => String(call[0]))
    expect(messages.some(m => m.includes('tool name') && m.includes('31 characters'))).toBe(true)
    expect(messages.some(m => m.includes('31-character name'))).toBe(true)
    expect(messages.some(m => m.includes('spec grammar'))).toBe(false)
  })

  it('warns once when a tool returns more than 1.5K characters of text', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tools } = installFakeModelContext()
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute: () => 'z'.repeat(1501) }))

    await invoke(tools, 'add-todo')
    await invoke(tools, 'add-todo')

    const messages = warnSpy.mock.calls
      .map(call => String(call[0]))
      .filter(m => m.includes('1501 characters'))
    expect(messages).toHaveLength(1)
  })

  it('does not touch a pass-through result while measuring it', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tools } = installFakeModelContext()
    const onError = vi.fn()
    // A null element is not valid MCP, but toToolResponse passes it through
    // and the dev-only check must not turn that into an error result.
    const shaped = { content: [null, { type: 'text', text: 'x' }] } as unknown as WebMCPToolResponse
    mountComposable(() => useWebMCPTool({ ...baseOptions, execute: () => shaped, onError }))

    expect(await invoke(tools, 'add-todo')).toBe(shaped)
    expect(onError).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('stays quiet exactly at the budgets and ignores non-text blocks', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tools } = installFakeModelContext()
    const name = 'n'.repeat(30)
    mountComposable(() =>
      useWebMCPTool({
        name,
        description: 'ok',
        inputSchema: { type: 'object', properties: { ['p'.repeat(30)]: { type: 'string' } } },
        execute: () => ({
          content: [
            { type: 'image', data: 'd'.repeat(5000) },
            { type: 'text', text: 'z'.repeat(1500) },
          ],
        }),
      }),
    )

    await invoke(tools, name)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warns on an over-budget param description', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    installFakeModelContext()
    mountComposable(() =>
      useWebMCPTool({
        ...baseOptions,
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'y'.repeat(151) } },
        },
        execute: () => 'ok',
      }),
    )

    const messages = warnSpy.mock.calls.map(call => String(call[0]))
    expect(messages.some(m => m.includes('param "text"'))).toBe(true)
  })
})
