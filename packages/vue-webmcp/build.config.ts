/// <reference types="node" />
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineBuildConfig } from 'unbuild'

// The declarations refer to the global `WebMCP` namespace from webmcp-types.
// rollup-plugin-dts drops triple-slash directives, so put the reference back
// on the emitted declaration files; without it consumers see an unresolved
// namespace unless they load webmcp-types themselves.
const REFERENCE = '/// <reference types="webmcp-types" />\n'

export default defineBuildConfig({
  entries: ['src/index'],
  declaration: true,
  clean: true,
  externals: ['vue'],
  hooks: {
    async 'build:done'(ctx) {
      const outDir = ctx.options.outDir
      for (const file of await readdir(outDir)) {
        if (!/\.d\.[cm]?ts$/.test(file)) continue
        const path = join(outDir, file)
        const source = await readFile(path, 'utf8')
        if (!source.startsWith(REFERENCE)) await writeFile(path, REFERENCE + source)
      }
    },
  },
})
