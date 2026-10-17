import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { INSTALL_SCRIPT, launchInstallHelper } from './installHelper.js'

it('refuses a relative data override before writing a handoff or launching a process', async () => {
  await expect(launchInstallHelper('never-written.json', { installer: 'test.exe', executable: 'test.exe', sha256: '0'.repeat(64), target: '2.0.0-alpha.1', previous: '2.0.0-alpha.0', backup: 'backup.db', dataDirOverride: 'relative' })).rejects.toThrow('absolute data directory')
})

it.skipIf(process.platform !== 'win32')('parses the Windows handoff without running an installer or changing execution policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hydra-helper-parse-'))
  try {
    const file = join(dir, 'helper.ps1'); writeFileSync(file, INSTALL_SCRIPT)
    const parsed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:HYDRA_PARSE_FILE,[ref]$tokens,[ref]$errors); if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }'], { env: { ...process.env, HYDRA_PARSE_FILE: file }, encoding: 'utf8', windowsHide: true })
    expect(parsed.status, parsed.stderr).toBe(0)
    expect(INSTALL_SCRIPT).not.toMatch(/ExecutionPolicy|bypassPermissions|dangerously-/i)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it.skipIf(process.platform !== 'win32')('a late helper with an exited parent refuses installation without the readiness grant', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hydra-helper-no-grant-'))
  try {
    const journal = join(dir, 'handoff.json')
    writeFileSync(journal, JSON.stringify({ pid: 2147483647, attemptId: 'fixture-attempt', phase: 'prepared', error: '', installApproved: false, installer: join(dir, 'must-not-execute.exe') }))
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(INSTALL_SCRIPT, 'utf16le').toString('base64')], { env: { ...process.env, HYDRA_UPDATE_HANDOFF: journal, HYDRA_UPDATE_ATTEMPT: 'fixture-attempt', HYDRA_UPDATE_PARENT: '2147483647' }, encoding: 'utf8', windowsHide: true, timeout: 15_000 })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(readFileSync(journal, 'utf8').replace(/^\uFEFF/, '')).phase).toBe('canceled')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

it.skipIf(process.platform !== 'win32')('an old helper cannot consume or overwrite a newer approved attempt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hydra-helper-stale-attempt-'))
  try {
    const journal = join(dir, 'handoff.json')
    const current = JSON.stringify({ pid: 2147483647, attemptId: 'new-attempt', phase: 'prepared', error: '', installApproved: true, installer: join(dir, 'must-not-execute.exe') })
    writeFileSync(journal, current)
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(INSTALL_SCRIPT, 'utf16le').toString('base64')], { env: { ...process.env, HYDRA_UPDATE_HANDOFF: journal, HYDRA_UPDATE_ATTEMPT: 'old-attempt', HYDRA_UPDATE_PARENT: '2147483647' }, encoding: 'utf8', windowsHide: true, timeout: 15_000 })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(journal, 'utf8')).toBe(current)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
