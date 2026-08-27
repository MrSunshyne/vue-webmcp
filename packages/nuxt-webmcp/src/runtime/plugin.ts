import { defineNuxtPlugin, useHead, useRuntimeConfig } from '#imports'

interface PublicWebMCPConfig {
  originTrialToken?: unknown
}

// Origin-trial tokens decided at deploy time rather than build time:
// `runtimeConfig.public.webmcp.originTrialToken`, or the env var
// NUXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN. Several tokens: an array in the
// config, or a comma-separated string. Read per request, so one server build
// can serve origins with different tokens.
export default defineNuxtPlugin({
  name: 'nuxt-webmcp:origin-trial',
  setup() {
    const config = useRuntimeConfig().public.webmcp as PublicWebMCPConfig | undefined
    const raw = config?.originTrialToken
    // Nitro coerces env values that look like numbers, booleans or JSON, so
    // only a string or an array of strings counts.
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
    const tokens = [
      ...new Set(list.filter(t => typeof t === 'string').map(t => t.trim())),
    ].filter(Boolean)
    if (tokens.length === 0) return

    // `key` keeps several tokens apart in unhead's dedupe; `data-hid` lets the
    // client find the server-rendered tag again instead of appending a copy.
    useHead({
      meta: tokens.map((content, index) => {
        const key = `webmcp-origin-trial-runtime-${index}`
        return { key, 'data-hid': key, 'http-equiv': 'origin-trial' as const, content }
      }),
    })
  },
})
