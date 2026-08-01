import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  // Set for subpath hosting, e.g. GitHub Pages: BASE_PATH=/vue-webmcp/vite/
  base: process.env.BASE_PATH ?? '/',
})
