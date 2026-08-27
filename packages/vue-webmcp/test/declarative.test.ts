import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { useWebMCPForm } from '../src'
import type { FormFields, UseWebMCPFormOptions, UseWebMCPFormReturn } from '../src'

// A form bound with `v-bind="attrs"`, the way the README shows it.
function mountForm<Fields extends FormFields = FormFields, Result = unknown>(
  options: UseWebMCPFormOptions<Fields, Result>,
) {
  let result!: UseWebMCPFormReturn
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp(
    defineComponent({
      setup() {
        result = useWebMCPForm(options)
        return () => h('form', result.attrs.value, [h('input', { name: 'text', value: 'milk' })])
      },
    }),
  )
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

// What Chrome hands a form when an agent submits it.
function agentSubmit(): { event: SubmitEvent; respondWith: ReturnType<typeof vi.fn> } {
  const event = new SubmitEvent('submit', { cancelable: true, bubbles: true })
  const respondWith = vi.fn()
  Object.defineProperties(event, {
    agentInvoked: { value: true },
    respondWith: { value: respondWith },
  })
  return { event, respondWith }
}

function activation(type: 'toolactivated' | 'toolcancel', toolName: string): Event {
  return Object.assign(new Event(type), { toolName })
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
    const execute = vi.fn(async (fields: Record<string, FormDataEntryValue>) => `added ${fields.text}`)
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

  it('serves a person the same way, without respondWith', async () => {
    const execute = vi.fn(() => 'ok')
    const { form, result } = mountForm({ name: 'add_note', description: 'Add', execute })
    const event = new SubmitEvent('submit', { cancelable: true, bubbles: true })

    form.dispatchEvent(event)
    expect(result.isSubmitting.value).toBe(true)
    await nextTick()
    await nextTick()

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
    await nextTick()

    expect(result.error.value?.message).toBe('not signed in')
    expect(onError).toHaveBeenCalledWith(failure)
    expect(result.isSubmitting.value).toBe(false)
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
})

describe('activation', () => {
  it('follows toolactivated and toolcancel for its own tool name', async () => {
    const { result, form, unmount } = mountForm({ name: 'add_note', description: 'Add', execute: () => 'ok' })
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
    await nextTick()
    await nextTick()
    expect(result.isAgentActive.value).toBe(false)

    // Nothing listens after unmount.
    unmount()
    window.dispatchEvent(activation('toolactivated', 'add_note'))
    expect(result.isAgentActive.value).toBe(false)
  })
})
