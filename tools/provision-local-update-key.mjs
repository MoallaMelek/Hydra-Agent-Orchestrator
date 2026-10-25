#!/usr/bin/env node
// Local publisher provisioning only: no publication, secret upload or plaintext key file.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ed25519 } from '@noble/curves/ed25519.js'

if (process.platform !== 'win32' || process.env.LOCALAPPDATA?.toLowerCase() !== join(homedir(), 'AppData', 'Local').toLowerCase()) throw new Error('Run under the actual Windows user, outside the redirected test sandbox')
const dir = join(process.env.LOCALAPPDATA, 'Hydra', 'publisher')
const keyPath = join(dir, 'release-key.dpapi')
const metadataPath = join(dir, 'publisher.json')
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA)$/i.test(key)))
function run(script, input = '') {
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; " + script], { input, encoding: 'utf8', env, windowsHide: true })
  if (result.status !== 0) throw new Error('Local DPAPI provisioning failed; no private material is logged')
  return result.stdout.trim()
}
mkdirSync(dir, { recursive: true })
const sid = run(`$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); foreach($identity in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }; Set-Acl -LiteralPath '${dir.replaceAll("'", "''")}' -AclObject $acl; $sid.Value`)
const protect = "$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"
const unprotect = "$bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"
let secret
let created = false
if (existsSync(keyPath)) secret = Buffer.from(run(unprotect, readFileSync(keyPath, 'utf8')), 'base64')
else {
  if (existsSync(metadataPath)) throw new Error('Publisher metadata exists without its protected key; refusing replacement')
  secret = Buffer.from(ed25519.utils.randomSecretKey())
  writeFileSync(keyPath, run(protect, secret.toString('base64')), { flag: 'wx' })
  created = true
}
try {
  const publicKey = Buffer.from(ed25519.getPublicKey(secret)).toString('hex')
  if (existsSync(metadataPath) && JSON.parse(readFileSync(metadataPath, 'utf8')).publicKey !== publicKey) throw new Error('Protected key and recorded publisher do not match')
  const verified = Buffer.from(run(unprotect, readFileSync(keyPath, 'utf8')), 'base64')
  try { if (!verified.equals(secret)) throw new Error('DPAPI roundtrip failed') } finally { verified.fill(0) }
  const metadata = { algorithm: 'Ed25519', publicKey, fingerprintSha256: createHash('sha256').update(Buffer.from(publicKey, 'hex')).digest('hex'), protection: 'Windows DPAPI CurrentUser; user/SYSTEM directory ACL', ownerSid: sid, createdAt: new Date().toISOString(), manifestUrl: 'https://github.com/MoallaMelek/Hydra-Agent-Orchestrator/releases/download/updates-preview/hydra-update-preview.json' }
  if (created || !existsSync(metadataPath)) writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ created, metadataPath, publicKey, roundtripVerified: true }))
} finally { secret.fill(0) }
