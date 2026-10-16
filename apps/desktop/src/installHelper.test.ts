import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { INSTALL_SCRIPT } from './installHelper.js'

it.skipIf(process.platform !== 'win32')('parses the Windows handoff without running an installer or changing execution policy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hydra-helper-parse-'))
  try {
    const file = join(dir, 'helper.ps1'); writeFileSync(file, INSTALL_SCRIPT)
    const parsed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:HYDRA_PARSE_FILE,[ref]$tokens,[ref]$errors); if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }'], { env: { ...process.env, HYDRA_PARSE_FILE: file }, encoding: 'utf8', windowsHide: true })
    expect(parsed.status, parsed.stderr).toBe(0)
    expect(INSTALL_SCRIPT).not.toMatch(/ExecutionPolicy|bypassPermissions|dangerously-/i)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
