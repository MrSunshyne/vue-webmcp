import { addImports, addPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/schema'

export interface ModuleOptions {
  /**
   * Chrome origin-trial token(s) for WebMCP, injected as
   * `<meta http-equiv="origin-trial">` tags at build time. Register your
   * origin at https://developer.chrome.com/docs/ai/webmcp — without a token
   * (or the local `chrome://flags/#enable-webmcp-testing` flag) the API is
   * absent and every tool registration degrades to a no-op.
   *
   * For a token decided at deploy time, set
   * `runtimeConfig.public.webmcp.originTrialToken` (or the env var
   * `NUXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN`) instead; both can be used
   * together and every token ends up in the head.
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
    const resolver = createResolver(import.meta.url)

    addImports([
      { name: 'useWebMCPTool', from: 'vue-webmcp' },
      { name: 'useRegisteredTools', from: 'vue-webmcp' },
    ])

    const tokens =
      typeof options.originTrialToken === 'string'
        ? [options.originTrialToken]
        : (options.originTrialToken ?? [])

    if (tokens.length > 0) {
      const head = nuxt.options.app.head
      head.meta ||= []
      type MetaEntry = (typeof head.meta)[number]
      tokens.forEach((content, index) => {
        // Keyed so several tokens survive unhead's dedupe, which otherwise
        // keeps only the last <meta http-equiv="origin-trial">. The cast is
        // because "origin-trial" is not in unhead's httpEquiv union.
        head.meta!.push({
          key: `webmcp-origin-trial-${index}`,
          'http-equiv': 'origin-trial',
          content,
        } as unknown as MetaEntry)
      })
    }

    // Runtime tokens: a default so NUXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN maps
    // onto it, and a plugin that puts them in the head per request.
    const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>
    publicConfig.webmcp = {
      originTrialToken: '',
      ...(publicConfig.webmcp as Record<string, unknown> | undefined),
    }
    addPlugin(resolver.resolve('./runtime/plugin'))
  },
})

export default module
