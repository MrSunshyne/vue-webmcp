/**
 * The agent skill declares the version it ships with, so an agent reading it
 * out of node_modules knows which API it describes. A skill left behind at an
 * older version is worse than no skill, so publishing with a stale one fails.
 */
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const skill = readFileSync('skills/nuxt-webmcp/SKILL.md', 'utf8')

if (!skill.includes(`library_version: '${version}'`)) {
  console.error(`SKILL.md does not declare library_version '${version}'`)
  process.exit(1)
}

console.log(`SKILL.md declares library_version '${version}'`)
