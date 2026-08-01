export default defineNuxtConfig({
  modules: ['nuxt-webmcp'],
  webmcp: {
    // Register your origin at https://developer.chrome.com/docs/ai/webmcp
    // and put the token here (or use chrome://flags/#enable-webmcp-testing locally).
    // originTrialToken: process.env.NUXT_PUBLIC_WEBMCP_OT_TOKEN,
  },
  compatibilityDate: '2026-08-01',
})
