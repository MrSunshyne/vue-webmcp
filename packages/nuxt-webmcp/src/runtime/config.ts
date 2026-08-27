import { inject } from 'vue'
import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import { WEBMCP_CONFIG } from 'vue-webmcp'
import type { WebMCPConfig } from 'vue-webmcp'

interface PublicWebMCPConfig {
  budgets?: unknown
}

// The budget mode from `webmcp.budgets` or NUXT_PUBLIC_WEBMCP_BUDGETS,
// provided app-wide the way main.ts would. Runs after the app's own plugins
// and yields to one that already provides WEBMCP_CONFIG (for the call
// hooks); that plugin should carry `budgets` itself.
export default defineNuxtPlugin({
  name: 'nuxt-webmcp:config',
  enforce: 'post',
  setup(nuxtApp) {
    const config = useRuntimeConfig().public.webmcp as PublicWebMCPConfig | undefined
    const raw = config?.budgets
    // Nitro turns the env value "false" into a boolean.
    const budgets: WebMCPConfig['budgets'] | undefined =
      raw === 'warn' || raw === 'error' || raw === false ? raw : undefined
    if (budgets === undefined) {
      if ((import.meta as { dev?: boolean }).dev && raw !== '' && raw !== undefined) {
        console.warn(
          `[nuxt-webmcp] ignoring budgets value ${JSON.stringify(raw)}; expected "warn", "error" or false.`,
        )
      }
      return
    }
    const provided = nuxtApp.vueApp.runWithContext(() => inject(WEBMCP_CONFIG, null))
    if (provided) return
    nuxtApp.vueApp.provide(WEBMCP_CONFIG, { budgets })
  },
})
