#!/usr/bin/env node
// Scans build outputs and packaged apps for anything that must never ship:
// developer credentials, provider credential stores, env files, private keys,
// upstream infrastructure identifiers and legacy code. Exit code 1 on any hit.
// Usage: node tools/scan-artifacts.mjs <dir> [<dir>...]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const FORBIDDEN_FILES = /^(\.env(\..*)?|credentials(\.json)?|auth\.json|\.credentials\.json|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key)$/i
const FORBIDDEN_DIRS = /^(\.claude|\.codex|\.ssh|\.aws|legacy)$/i
const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/, 'OpenAI API key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}/, 'GitHub token'],
  [/(?:AKIA|ASIA)[0-9A-Z]{16}/, 'AWS access key id'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/"refresh_token"\s*:\s*"[^"]{10,}/, 'OAuth refresh token'],
  [/hydra-za/i, 'upstream Firebase project'],
  [/devtoken-ui-preview/, 'development API token']
]
const TEXT = /\.(m?js|cjs|json|html|css|map|txt|md|yml|yaml|toml|ini|env|ts)$/i
const MAX = 32 * 1024 * 1024

const hits = []
let files = 0
function walk(dir, root) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const rel = relative(root, path)
    const info = statSync(path)
    if (info.isDirectory()) {
      if (FORBIDDEN_DIRS.test(name)) hits.push(`${rel}: forbidden directory`)
      else walk(path, root)
      continue
    }
    files++
    if (FORBIDDEN_FILES.test(basename(name))) hits.push(`${rel}: forbidden file`)
    if (!TEXT.test(name) || info.size > MAX) continue
    const text = readFileSync(path, 'utf8')
    for (const [pattern, label] of PATTERNS) if (pattern.test(text)) hits.push(`${rel}: ${label}`)
  }
}

const targets = process.argv.slice(2)
if (!targets.length) { console.error('usage: scan-artifacts <dir>...'); process.exit(2) }
for (const target of targets) walk(target, target)
console.log(`Scanned ${files} files in ${targets.join(', ')}`)
if (hits.length) {
  console.error(`Artifact scan FAILED:\n- ${hits.join('\n- ')}`)
  process.exit(1)
}
console.log('Artifact scan passed: no credentials, credential stores, env files, private keys or upstream identifiers.')
