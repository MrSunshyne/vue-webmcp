export default defineNuxtConfig({
  modules: ['nuxt-webmcp'],
  webmcp: {
    // Build-time token(s): register your origin at
    // https://developer.chrome.com/docs/ai/webmcp and put the token here.
    // At deploy time, set NUXT_PUBLIC_WEBMCP_ORIGIN_TRIAL_TOKEN instead (comma-separated for several).
    // Locally, chrome://flags/#enable-webmcp-testing needs no token at all.
    originTrialToken: process.env.WEBMCP_BUILD_TOKENS?.split(','),
  },
  compatibilityDate: '2026-08-01',
})
