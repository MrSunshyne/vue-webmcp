import { addImports, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

export interface ModuleOptions {
  /**
   * Chrome origin-trial token(s) for WebMCP, injected as
   * `<meta http-equiv="origin-trial">` tags. Register your origin at
   * https://developer.chrome.com/docs/ai/webmcp — without a token (or the
   * local `chrome://flags/#enable-webmcp-testing` flag) the API is absent
   * and every tool registration degrades to a no-op.
   */
  originTrialToken?: string | string[]
}

const module: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-webmcp',
    configKey: 'webmcp',
    compatibility: {
      nuxt: '>=3.13.0',
    },
  },
  defaults: {},
  setup(options, nuxt) {
    addImports({ name: 'useWebMCPTool', from: 'vue-webmcp' })

    const tokens =
      typeof options.originTrialToken === 'string'
        ? [options.originTrialToken]
        : (options.originTrialToken ?? [])

    if (tokens.length > 0) {
      const head = nuxt.options.app.head
      head.meta ||= []
      type MetaEntry = (typeof head.meta)[number]
      for (const content of tokens) {
        // "origin-trial" is not in unhead's httpEquiv union, hence the cast.
        head.meta.push({ 'http-equiv': 'origin-trial', content } as unknown as MetaEntry)
      }
    }
  },
})

export default module
