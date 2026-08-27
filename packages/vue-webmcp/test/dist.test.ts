/**
 * Checks the published artefact, not the source: `MODEL_CONTEXT_INIT_SCRIPT`
 * must survive the build as a self-contained string. Skipped until `pnpm
 * build` has run; `prepublishOnly` builds before testing, so it gates a
 * publish.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { uninstallModelContextStub } from '../src/testing'
import type { ModelContextStub } from '../src/testing'

// Resolved from the package directory vitest runs in: under the jsdom
// environment import.meta.url is an http: URL, not a file path.
const distPath = resolve('dist/testing/index.mjs')
const distHref = pathToFileURL(distPath).href

afterEach(() => uninstallModelContextStub())

describe.skipIf(!existsSync(distPath))('built vue-webmcp/testing', () => {
  it('ships an init script with no bundler helpers that installs the stub', async () => {
    const { MODEL_CONTEXT_INIT_SCRIPT } = (await import(distHref)) as {
      MODEL_CONTEXT_INIT_SCRIPT: string
    }
    expect(MODEL_CONTEXT_INIT_SCRIPT).not.toMatch(/\bimport\b|\brequire\(|\b__\w+\(/)

    // Evaluated the way a page would run it, with no module scope around it.
    new Function(MODEL_CONTEXT_INIT_SCRIPT)()

    const stub = document.modelContext as unknown as ModelContextStub
    await stub.registerTool({ name: 'save_note', description: 'S', execute: () => 'saved' })
    expect(stub.names()).toEqual(['save_note'])
    expect(await stub.call('save_note')).toBe('saved')
    expect((await stub.getTools())[0]?.origin).toBe(location.origin)
  })
})
