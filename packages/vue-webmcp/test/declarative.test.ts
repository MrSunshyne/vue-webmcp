import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, effectScope, h, nextTick, ref } from 'vue'
import { WEBMCP_CONFIG, useWebMCPForm } from '../src'
import type { FormFields, UseWebMCPFormOptions, UseWebMCPFormReturn, WebMCPConfig } from '../src'

// A form bound with `v-bind="attrs"`, the way the README shows it.
function mountForm<Fields extends FormFields = FormFields, Result = unknown>(
  options: UseWebMCPFormOptions<Fields, Result>,
  extra: { config?: WebMCPConfig; fields?: () => ReturnType<typeof h>[] } = {},
) {
  let result!: UseWebMCPFormReturn
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(
    defineComponent({
      setup() {
        result = useWebMCPForm(options)
        return () =>
          h(
            'form',
            result.attrs.value,
            extra.fields ? extra.fields() : [h('input', { name: 'text', value: 'milk' })],
          )
      },
    }),
  )
  if (extra.config) app.provide(WEBMCP_CONFIG, extra.config)
  app.mount(root)
  const form = root.querySelector('form')!
  return {
    result,
    form,
    unmount: () => {
      app.unmount()
      root.remove()
    },
  }
}

// What Chrome hands a form when an agent submits it. The fake respondWith
// enforces what Chromium does: preventDefault() first, and a call during
// dispatch, or it throws InvalidStateError.
function agentSubmit(): { event: SubmitEvent; respondWith: ReturnType<typeof vi.fn> } {
  const event = new SubmitEvent('submit', { cancelable: true, bubbles: true })
  const respondWith = vi.fn(() => {
    if (!event.defaultPrevented || event.eventPhase === Event.NONE) {
      throw new DOMException('respondWith() needs preventDefault() during dispatch', 'InvalidStateError')
    }
  })
  Object.defineProperties(event, {
    agentInvoked: { value: true },
    respondWith: { value: respondWith },
  })
  return { event, respondWith }
}

function activation(type: 'toolactivated' | 'toolcancel', toolName: string): Event {
  return Object.assign(new Event(type), { toolName })
}

async function settle(): Promise<void> {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('attributes', () => {
  it('sets toolname and tooldescription, and toolautosubmit only when asked', async () => {
    const name = ref('add_note')
    const { form, result } = mountForm({
      name,
      description: 'Add a note',
      execute: () => 'ok',
    })

    expect(form.getAttribute('toolname')).toBe('add_note')
    expect(form.getAttribute('tooldescription')).toBe('Add a note')
    expect(form.hasAttribute('toolautosubmit')).toBe(false)

    name.value = 'create_note'
    await nextTick()
    expect(form.getAttribute('toolname')).toBe('create_note')
    expect(result.attrs.value.toolautosubmit).toBeUndefined()

    const auto = mountForm({ name: 'x', description: 'X', autosubmit: true, execute: () => 'ok' })
    expect(auto.form.getAttribute('toolautosubmit')).toBe('')
  })
})

describe('submission', () => {
  it('answers an agent through respondWith with the normalized result', async () => {
    const execute = vi.fn(async (fields: FormFields) => `added ${fields.text}`)
    const { form } = mountForm({ name: 'add_note', description: 'Add', execute })
    const { event, respondWith } = agentSubmit()

    form.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(respondWith).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith({ text: 'milk' }, event)
    await expect(respondWith.mock.calls[0]![0]).resolves.toEqual({
      content: [{ type: 'text', text: 'added milk' }],
    })
  })

  it('keeps every entry of a repeated field name', async () => {
    const execute = vi.fn((fields: FormFields) => fields)
    const { form } = mountForm(
      { name: 'tag_note', description: 'Tag', execute },
      {
        fields: () => [
          h('input', { name: 'text', value: 'milk' }),
          h('input', { type: 'checkbox', name: 'tag', value: 'a', checked: true }),
          h('input', { type: 'checkbox', name: 'tag', value: 'b', checked: true }),
        ],
      },
    )

    form.dispatchEvent(agentSubmit().event)
    expect(execute.mock.calls[0]![0]).toEqual({ text: 'milk', tag: ['a', 'b'] })
  })

  it('serves a person the same way, without respondWith', async () => {
    const execute = vi.fn(() => 'ok')
    const { form, result } = mountForm({ name: 'add_note', description: 'Add', execute })
    const event = new SubmitEvent('submit', { cancelable: true, bubbles: true })

    form.dispatchEvent(event)
    expect(result.isSubmitting.value).toBe(true)
    await settle()

    expect(event.defaultPrevented).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(result.isSubmitting.value).toBe(false)
    expect(result.error.value).toBeNull()
  })

  it('turns a failure into an isError result for the agent and an error for the page', async () => {
    const onError = vi.fn()
    const failure = new Error('not signed in')
    const { form, result } = mountForm({
      name: 'add_note',
      description: 'Add',
      execute: () => {
        throw failure
      },
      onError,
    })
    const { event, respondWith } = agentSubmit()

    form.dispatchEvent(event)
    await expect(respondWith.mock.calls[0]![0]).resolves.toEqual({
      content: [{ type: 'text', text: 'not signed in' }],
      isError: true,
    })
    await settle()

    expect(result.error.value?.message).toBe('not signed in')
    expect(onError).toHaveBeenCalledWith(failure)
    expect(result.isSubmitting.value).toBe(false)
  })

  it('recovers when respondWith itself throws', async () => {
    const { form, result } = mountForm({ name: 'add_note', description: 'Add', execute: () => 'ok' })
    const event = new SubmitEvent('submit', { cancelable: false })
    Object.defineProperties(event, {
      agentInvoked: { value: true },
      respondWith: {
        value: () => {
          throw new DOMException('not cancelled', 'InvalidStateError')
        },
      },
    })

    form.dispatchEvent(event)
    await settle()

    expect(result.isSubmitting.value).toBe(false)
    expect(result.error.value?.name).toBe('InvalidStateError')
  })

  it('applies formatOutput before normalization', async () => {
    const { form } = mountForm({
      name: 'add_note',
      description: 'Add',
      execute: () => ({ id: 7 }),
      formatOutput: (result: { id: number }, fields) => `#${result.id} ${fields.text}`,
    })
    const { event, respondWith } = agentSubmit()

    form.dispatchEvent(event)
    await expect(respondWith.mock.calls[0]![0]).resolves.toEqual({
      content: [{ type: 'text', text: '#7 milk' }],
    })
  })

  it('reports to the app-level call hooks under the form tool name', async () => {
    const onToolCall = vi.fn()
    const onToolResult = vi.fn()
    const { form } = mountForm(
      {
        name: 'add_note',
        description: 'Add',
        execute: () => {
          throw new Error('nope')
        },
      },
      { config: { includeArgs: true, onToolCall, onToolResult } },
    )

    form.dispatchEvent(agentSubmit().event)
    await settle()

    expect(onToolCall).toHaveBeenCalledWith({ name: 'add_note', args: { text: 'milk' } })
    expect(onToolResult).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'add_note', ok: false, args: { text: 'milk' } }),
    )
    expect(onToolResult.mock.calls[0]![0].response.isError).toBe(true)
  })
})

describe('activation', () => {
  it('follows toolactivated and toolcancel for its own tool name', async () => {
    const name = ref('add_note')
    const { result, form, unmount } = mountForm({ name, description: 'Add', execute: () => 'ok' })
    await nextTick()

    window.dispatchEvent(activation('toolactivated', 'other_tool'))
    expect(result.isAgentActive.value).toBe(false)

    window.dispatchEvent(activation('toolactivated', 'add_note'))
    expect(result.isAgentActive.value).toBe(true)

    window.dispatchEvent(activation('toolcancel', 'add_note'))
    expect(result.isAgentActive.value).toBe(false)

    // Submitting ends the activation too.
    window.dispatchEvent(activation('toolactivated', 'add_note'))
    form.dispatchEvent(agentSubmit().event)
    await settle()
    expect(result.isAgentActive.value).toBe(false)

    // A renamed form is a different tool.
    window.dispatchEvent(activation('toolactivated', 'add_note'))
    name.value = 'create_note'
    await nextTick()
    expect(result.isAgentActive.value).toBe(false)

    // Nothing listens after unmount.
    unmount()
    window.dispatchEvent(activation('toolactivated', 'create_note'))
    expect(result.isAgentActive.value).toBe(false)
  })

  it('listens straight away outside a component and stops with the scope', () => {
    const scope = effectScope()
    let result!: UseWebMCPFormReturn
    scope.run(() => {
      result = useWebMCPForm({ name: 'add_note', description: 'Add', execute: () => 'ok' })
    })

    window.dispatchEvent(activation('toolactivated', 'add_note'))
    expect(result.isAgentActive.value).toBe(true)

    scope.stop()
    window.dispatchEvent(activation('toolcancel', 'add_note'))
    expect(result.isAgentActive.value).toBe(true)
  })
})
