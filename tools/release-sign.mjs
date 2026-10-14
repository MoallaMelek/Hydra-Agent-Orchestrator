#!/usr/bin/env node
/**
 * Owner tool for signed updates. Never commit the private key; keep it offline.
 *
 *   node tools/release-sign.mjs keygen <private-key-file>
 *       Creates a new Ed25519 key pair. Prints the public key to embed in releases
 *       (HYDRA_UPDATE_KEY). Refuses to write inside this repository.
 *   node tools/release-sign.mjs sign <private-key-file> <manifest.json> <out.json>
 *       Signs a manifest ({ schema, version, releasedAt, notes, files: [...] }).
 *
 * Publishing the signed manifest and installers is a separate, owner-approved step.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { signManifest, UpdateManifest } from '../packages/engine/dist/update/updater.js'

const [, , command, keyFile, input, output] = process.argv
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))

if (command === 'keygen' && keyFile) {
  const target = resolve(keyFile)
  if (target.toLowerCase().startsWith(repo.toLowerCase())) throw new Error('Refusing to write a private key inside the repository.')
  if (existsSync(target)) throw new Error('That file already exists.')
  const secret = ed25519.utils.randomSecretKey()
  writeFileSync(target, Buffer.from(secret).toString('hex'), { mode: 0o600 })
  console.log(`Private key written to ${target}. Keep it offline and backed up.`)
  console.log(`Public key: ${Buffer.from(ed25519.getPublicKey(secret)).toString('hex')}`)
} else if (command === 'sign' && keyFile && input && output) {
  const manifest = UpdateManifest.parse(JSON.parse(readFileSync(input, 'utf8')))
  const signature = signManifest(manifest, readFileSync(keyFile, 'utf8').trim())
  writeFileSync(output, JSON.stringify({ manifest, signature }, null, 2))
  console.log(`Signed manifest for ${manifest.version} written to ${output}`)
} else {
  console.log('Usage: release-sign.mjs keygen <key-file> | sign <key-file> <manifest.json> <out.json>')
  process.exitCode = 1
}
