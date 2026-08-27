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
  /**
   * What the character-budget checks do: `'warn'` logs (the development
   * default), `'error'` fails setup for an over-budget definition and turns
   * an oversized result into an `isError` response, `false` skips them (the
   * production default). Overridable at runtime through
   * `NUXT_PUBLIC_WEBMCP_BUDGETS`. Leave it unset outside test runs.
   */
  budgets?: 'warn' | 'error' | false
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
      { name: 'useWebMCPTools', from: 'vue-webmcp' },
      { name: 'defineWebMCPTool', from: 'vue-webmcp' },
      { name: 'useWebMCPForm', from: 'vue-webmcp' },
      { name: 'useRegisteredTools', from: 'vue-webmcp' },
    ])

    const tokens =
      typeof options.originTrialToken === 'string'
        ? [options.originTrialToken]
        : (options.originTrialToken ?? [])

    if (tokens.length > 0) {
      const head = nuxt.options.app.head
      head.meta ||= []
      // `key` keeps several tokens apart: unhead dedupes <meta http-equiv>
      // by name and would otherwise keep only the last one. `data-hid` is
      // what the client uses to find the server-rendered element again, so
      // without it hydration appends a second copy of each tag.
      for (const [index, content] of tokens.entries()) {
        const key = `webmcp-origin-trial-${index}`
        head.meta.push({ key, 'data-hid': key, 'http-equiv': 'origin-trial', content })
      }
    }

    // Runtime config: defaults so the NUXT_PUBLIC_WEBMCP_* env vars map onto
    // them, with the user's own runtimeConfig winning over the module option.
    const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>
    publicConfig.webmcp = {
      originTrialToken: '',
      budgets: options.budgets ?? '',
      ...(publicConfig.webmcp as Record<string, unknown> | undefined),
    }
    addPlugin(resolver.resolve('./runtime/plugin'))
    addPlugin(resolver.resolve('./runtime/config'))
  },
})

export default module
