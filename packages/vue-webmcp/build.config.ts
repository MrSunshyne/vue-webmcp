import { defineBuildConfig } from 'unbuild'

// The declarations refer to the global `WebMCP` namespace from webmcp-types.
// rollup-plugin-dts drops triple-slash directives, so a small rollup plugin
// puts the reference back on every emitted declaration chunk; without it
// consumers see an unresolved namespace unless they load webmcp-types
// themselves.
const REFERENCE = '/// <reference types="webmcp-types" />\n'

export default defineBuildConfig({
  entries: ['src/index', 'src/testing/index'],
  // The package is ESM-only, so only `.d.mts` is ever resolved. The default
  // ('compatible') also emits a byte-identical `.d.ts` beside every chunk,
  // which nothing here points at and which doubles the shipped declarations.
  declaration: 'node16',
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
