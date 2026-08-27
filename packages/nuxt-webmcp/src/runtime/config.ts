import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import { WEBMCP_CONFIG } from 'vue-webmcp'
import type { WebMCPConfig } from 'vue-webmcp'

interface PublicWebMCPConfig {
  budgets?: unknown
}

// The budget mode from `webmcp.budgets` or NUXT_PUBLIC_WEBMCP_BUDGETS,
// provided app-wide the way main.ts would. A plugin of your own that
// provides WEBMCP_CONFIG (for the call hooks) replaces this one, so include
// `budgets` there too.
export default defineNuxtPlugin({
  name: 'nuxt-webmcp:config',
  setup(nuxtApp) {
    const config = useRuntimeConfig().public.webmcp as PublicWebMCPConfig | undefined
    const raw = config?.budgets
    // Nitro turns the env value "false" into a boolean.
    const budgets: WebMCPConfig['budgets'] | undefined =
      raw === 'warn' || raw === 'error' || raw === false ? raw : undefined
    if (budgets === undefined) return
    nuxtApp.vueApp.provide(WEBMCP_CONFIG, { budgets })
  },
})
