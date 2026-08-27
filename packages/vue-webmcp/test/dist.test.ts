// @vitest-environment node
/**
 * Checks the published artefact, not the source: `MODEL_CONTEXT_INIT_SCRIPT`
 * must survive the build as a self-contained string. Skipped until `pnpm
 * build` has run; `prepublishOnly` builds before testing, so it gates a
 * publish.
 */
import { existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const dist = new URL('../dist/testing/index.mjs', import.meta.url)

describe.skipIf(!existsSync(dist))('built vue-webmcp/testing', () => {
  it('ships an init script with no bundler helpers that installs the stub in a fresh window', async () => {
    const { MODEL_CONTEXT_INIT_SCRIPT } = (await import(dist.href)) as {
      MODEL_CONTEXT_INIT_SCRIPT: string
    }
    expect(MODEL_CONTEXT_INIT_SCRIPT).not.toMatch(/\bimport\b|\brequire\(|\b__\w+\(/)

    const { window } = new JSDOM('<!doctype html><p>page</p>', {
      url: 'https://example.test/notes',
      runScripts: 'outside-only',
    })
    window.eval(MODEL_CONTEXT_INIT_SCRIPT)

    const stub = window.document.modelContext as unknown as {
      registerTool: (tool: object) => Promise<void>
      names: () => string[]
      call: (name: string) => Promise<unknown>
      getTools: () => Promise<{ origin: string }[]>
    }
    await stub.registerTool({ name: 'save_note', description: 'S', execute: () => 'saved' })
    expect(stub.names()).toEqual(['save_note'])
    expect(await stub.call('save_note')).toBe('saved')
    expect((await stub.getTools())[0]?.origin).toBe('https://example.test')
  })
})
