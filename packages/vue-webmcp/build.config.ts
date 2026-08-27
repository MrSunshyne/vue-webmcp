import { defineBuildConfig } from 'unbuild'

// The declarations refer to the global `WebMCP` namespace from webmcp-types.
// rollup-plugin-dts drops triple-slash directives, so a small rollup plugin
// puts the reference back on every emitted declaration chunk; without it
// consumers see an unresolved namespace unless they load webmcp-types
// themselves.
const REFERENCE = '/// <reference types="webmcp-types" />\n'

export default defineBuildConfig({
  entries: ['src/index'],
  declaration: true,
  clean: true,
  externals: ['vue'],
  hooks: {
    'rollup:dts:options'(_ctx, options) {
      if (!Array.isArray(options.plugins)) return
      options.plugins.push({
        name: 'webmcp-types-reference',
        renderChunk: (code: string) => REFERENCE + code,
      })
    },
  },
})
