// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useRegisteredTools, useWebMCPForm, useWebMCPTool, useWebMCPTools } from '../src'

describe('server-side rendering', () => {
  it('renders the declarative attributes from useWebMCPForm without touching window', async () => {
    const App = defineComponent({
      setup() {
        const { attrs } = useWebMCPForm({
          name: 'add_note',
          description: 'Add a note',
          execute: () => 'ok',
        })
        return () => h('form', attrs.value)
      },
    })

    const html = await renderToString(createSSRApp(App))
    expect(html).toBe('<form toolname="add_note" tooldescription="Add a note"></form>')
  })

  it('keeps useWebMCPTools inert: nothing registered, no document access', async () => {
    const App = defineComponent({
      setup() {
        const { isSupported, isRegistered } = useWebMCPTools([
          { name: 'a', description: 'A', execute: () => 'ok' },
        ])
        return () => h('div', `${isSupported.value}:${isRegistered.value}`)
      },
    })

    const html = await renderToString(createSSRApp(App))
    expect(html).toBe('<div>false:false</div>')
  })

  it('keeps useRegisteredTools inert: no tools, isSupported false', async () => {
    const App = defineComponent({
      setup() {
        const { isSupported, tools } = useRegisteredTools()
        return () => h('div', `${isSupported.value}:${tools.value.length}`)
      },
    })

    const html = await renderToString(createSSRApp(App))
    expect(html).toBe('<div>false:0</div>')
  })

  it('stays inert: no document access, isSupported and isRegistered render false', async () => {
    const App = defineComponent({
      setup() {
        const { isSupported, isRegistered } = useWebMCPTool({
          name: 'ssr-tool',
          description: 'Never registers on the server',
          execute: () => 'ok',
        })
        return () => h('div', `${isSupported.value}:${isRegistered.value}`)
      },
    })

    const html = await renderToString(createSSRApp(App))
    expect(html).toBe('<div>false:false</div>')
  })
})
