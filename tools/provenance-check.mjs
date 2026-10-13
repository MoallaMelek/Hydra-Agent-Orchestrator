#!/usr/bin/env node
// Originality evidence for Hydra v2. For every v2 source file, measures the share of
// its normalized 6-line windows ("shingles") that also occur anywhere in the legacy
// tree. Also fails on any import from legacy/ and on upstream infrastructure identifiers.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SOURCE = /\.(ts|tsx|mts|mjs|js|css|html)$/
const SKIP = new Set(['node_modules', 'dist', 'out', 'release', 'coverage', '.git'])
const K = 6
const MAX_FILE_OVERLAP = 0.15
const FORBIDDEN = [/hydra-za/i, /firebaseapp\.com/i, /from\s+['"][^'"]*\/legacy\//]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    const info = statSync(path)
    if (info.isDirectory()) walk(path, out)
    else if (SOURCE.test(name)) out.push(path)
  }
  return out
}

/** Lines stripped of whitespace, comments and trivial punctuation-only content. */
function normalizedLines(text) {
  return text.split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').replace(/\s+/g, '').trim())
    .filter((line) => line.length >= 6 && !/^[{}()[\];,]*$/.test(line) && !/^(import|export\{|\*|\/\*)/.test(line))
}

function shingles(text) {
  const lines = normalizedLines(text)
  const set = new Set()
  for (let i = 0; i + K <= lines.length; i++) set.add(createHash('sha1').update(lines.slice(i, i + K).join('\n')).digest('hex'))
  return set
}

const legacyFiles = walk(join(ROOT, 'legacy'))
const legacy = new Set()
for (const file of legacyFiles) for (const s of shingles(readFileSync(file, 'utf8'))) legacy.add(s)

const v2Files = ['packages', 'apps', 'tools', 'skills'].flatMap((dir) => { try { return walk(join(ROOT, dir)) } catch { return [] } })
const report = []
const problems = []
let totalShingles = 0
let totalShared = 0
for (const file of v2Files) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  if (rel === 'tools/provenance-check.mjs') continue // contains the forbidden patterns by design
  for (const pattern of FORBIDDEN) if (pattern.test(text)) problems.push(`${rel}: forbidden reference ${pattern}`)
  const mine = shingles(text)
  let shared = 0
  for (const s of mine) if (legacy.has(s)) shared++
  totalShingles += mine.size
  totalShared += shared
  const ratio = mine.size ? shared / mine.size : 0
  report.push({ file: rel, shingles: mine.size, shared, ratio: Number(ratio.toFixed(4)) })
  if (ratio > MAX_FILE_OVERLAP) problems.push(`${rel}: ${(ratio * 100).toFixed(1)}% of 6-line windows also appear in legacy/`)
}

report.sort((a, b) => b.ratio - a.ratio)
const summary = {
  generatedAt: new Date().toISOString(),
  method: `normalized ${K}-line shingles, comments/whitespace/imports removed`,
  legacyFiles: legacyFiles.length,
  v2Files: report.length,
  v2Shingles: totalShingles,
  sharedWithLegacy: totalShared,
  overallOverlap: totalShingles ? Number((totalShared / totalShingles).toFixed(5)) : 0,
  topFiles: report.slice(0, 10),
  problems
}
if (process.argv.includes('--write')) writeFileSync(join(ROOT, 'docs', 'v2', 'provenance-report.json'), JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify({ ...summary, topFiles: summary.topFiles.slice(0, 5) }, null, 2))
if (problems.length) {
  console.error(`\nProvenance check FAILED:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('\nProvenance check passed.')
