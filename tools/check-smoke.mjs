#!/usr/bin/env node
// Validates a desktop smoke report (HYDRA_DESKTOP_SMOKE_OUT) for installer tests.
// Usage: node tools/check-smoke.mjs <report.json> [--packaged] [--data-dir <path>] [--no-providers]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [file, ...flags] = process.argv.slice(2)
const flag = (name) => flags.includes(name)
const value = (name) => { const i = flags.indexOf(name); return i >= 0 ? flags[i + 1] : null }
const { report } = JSON.parse(readFileSync(file, 'utf8'))
const failures = []
const expect = (ok, message) => { if (!ok) failures.push(message) }

expect(report.page?.title === 'Hydra', 'window did not load the Hydra UI')
expect(report.page?.live === true, 'UI is not connected to the engine')
expect(JSON.stringify(report.page?.hostKeys) === JSON.stringify(['apiUrl', 'notify', 'pickDirectory', 'token']), 'unexpected renderer bridge surface')
expect(report.page?.nodeRequire === 'undefined' && report.page?.nodeProcess === 'undefined', 'Node APIs leaked into the renderer')
expect(report.databaseExists === true, 'database was not initialized')
if (flag('--packaged')) expect(report.packaged === true, 'app is not running as a packaged build')
const dataDir = value('--data-dir')
if (dataDir) expect(resolve(report.dataDir).toLowerCase() === resolve(dataDir).toLowerCase(), `data dir ${report.dataDir} != expected ${dataDir}`)
if (flag('--no-providers')) {
  // On a clean machine without the CLIs, Hydra must say so instead of failing.
  for (const p of report.providers ?? []) expect(p.installed === false && p.problems > 0, `${p.id} should be reported as not installed`)
}
console.log(JSON.stringify(report, null, 2))
if (failures.length) { console.error(`Smoke check FAILED:\n- ${failures.join('\n- ')}`); process.exit(1) }
console.log('Smoke check passed.')
