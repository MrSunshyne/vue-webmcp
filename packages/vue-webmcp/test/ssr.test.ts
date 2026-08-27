// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useRegisteredTools, useWebMCPTool } from '../src'

describe('server-side rendering', () => {
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
