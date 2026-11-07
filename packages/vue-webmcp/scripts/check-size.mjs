/**
 * Size budgets for the published package.
 *
 * Two numbers matter, and they fail for different reasons:
 *   - `gzip`, the cost an app actually ships. Regressions here are real.
 *   - `unpacked`, what npm reports as install size. Regressions here are
 *     usually a build config emitting files nobody imports.
 *
 * Raise a budget deliberately, in the same commit as the growth that needs it.
 *
 * Also checks that the agent skill declares the version it ships with: a skill
 * claiming an older API than the package is worse than no skill at all.
 */
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

const BUDGETS = {
  // npm's install-size number, in bytes. Raised from 86,000 to make room for
  // the 7.5 kB agent skill, which is documentation and reaches no bundle, and
  // from 94,000 for the README and skill text on the debugging annotation,
  // then to 96,000 for the docs on where the activation events fire, to
  // 98,000 for the testing stub's spec cancellation and events, to 99,000
  // for the docs on cancelled calls, to 102,000 for the outputSchema section
  // and its example, and to 104,000 for the 2026-11 spec notes.
  unpacked: 104_000,
  // gzipped bytes per entry point, unminified — a proxy, not the shipped size.
  entries: {
    'dist/index.mjs': 5_000,
    // Raised from 1,200 when the stub's executeTool() gained the spec's
    // cancellation, error names and activation events; the init-script string
    // repeats the stub's source, so its growth counts twice. Test-only entry.
    'dist/testing/index.mjs': 1_400,
  },
}

const pack = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' }),
)[0]

const failures = []
const report = []

report.push(['unpacked', pack.unpackedSize, BUDGETS.unpacked])
if (pack.unpackedSize > BUDGETS.unpacked) {
  failures.push(
    `unpacked size ${pack.unpackedSize} exceeds budget ${BUDGETS.unpacked}`,
  )
}

for (const [entry, budget] of Object.entries(BUDGETS.entries)) {
  const size = gzipSync(readFileSync(entry), { level: 9 }).byteLength
  report.push([entry, size, budget])
  if (size > budget) {
    failures.push(`${entry} gzipped to ${size}, exceeds budget ${budget}`)
  }
}

const width = Math.max(...report.map(([name]) => name.length))
for (const [name, size, budget] of report) {
  const pct = ((size / budget) * 100).toFixed(0)
  console.log(`${name.padEnd(width)}  ${String(size).padStart(7)} / ${budget}  (${pct}%)`)
}

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const skill = readFileSync('skills/vue-webmcp/SKILL.md', 'utf8')
if (!skill.includes(`library_version: '${version}'`)) {
  failures.push(`SKILL.md does not declare library_version '${version}'`)
}

if (failures.length > 0) {
  console.error(`\nPublish checks failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exit(1)
}
