import { defineNuxtPlugin, useHead, useRuntimeConfig } from '#imports'

interface PublicWebMCPConfig {
  originTrialToken?: string | string[]
}

// Origin-trial tokens decided at deploy time rather than build time:
// `runtimeConfig.public.webmcp.originTrialToken`, or the env var
// NUXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN. Several tokens: an array in the
// config, or a comma-separated string. Read per request, so one build can
// serve origins with different tokens.
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public.webmcp as PublicWebMCPConfig | undefined
  const raw = config?.originTrialToken
  const tokens = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
    .map(token => token.trim())
    .filter(Boolean)
  if (tokens.length === 0) return

  // Keyed so several tokens survive unhead's dedupe, which otherwise keeps
  // only the last <meta http-equiv="origin-trial">.
  const meta = tokens.map((content, index) => ({
    key: `webmcp-origin-trial-runtime-${index}`,
    'http-equiv': 'origin-trial',
    content,
  }))
  useHead({ meta } as unknown as Parameters<typeof useHead>[0])
})
