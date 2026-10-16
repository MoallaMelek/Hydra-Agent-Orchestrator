import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Auditable Windows handoff. PowerShell waits for Hydra to exit, verifies the bytes
 * again, runs NSIS, records the exit code, and restarts the SAME install location.
 * No execution-policy changes, downloads, registry edits or profile scripts.
 */
export const INSTALL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$path = $env:HYDRA_UPDATE_HANDOFF
$handoff = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
function Save-Phase($phase, $errorText) {
  $handoff.phase = $phase
  $handoff.error = $errorText
  $handoff | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding utf8
}
try {
  Save-Phase 'waiting_for_exit' ''
  try { $appProcess = Get-Process -Id $handoff.pid -ErrorAction Stop; if (-not $appProcess.WaitForExit(60000)) { throw 'Hydra did not exit within 60 seconds.' } }
  catch [Microsoft.PowerShell.Commands.ProcessCommandException] { }
  if ((Get-FileHash -LiteralPath $handoff.installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $handoff.sha256) { throw 'Installer checksum changed; execution refused.' }
  Save-Phase 'installing' ''
  $installerProcess = Start-Process -FilePath $handoff.installer -ArgumentList @('/S', '--updated') -WindowStyle Hidden -Wait -PassThru
  if ($installerProcess.ExitCode -ne 0) { throw ('Installer failed with exit code ' + $installerProcess.ExitCode) }
  Save-Phase 'restarting' ''
  Start-Process -FilePath $handoff.executable -WindowStyle Hidden
  Save-Phase 'launched' ''
} catch {
  Save-Phase 'failed' $_.Exception.Message
  if (Test-Path -LiteralPath $handoff.executable) { Start-Process -FilePath $handoff.executable -WindowStyle Hidden }
  exit 1
}
`

export async function launchInstallHelper(journalPath: string, values: { installer: string; executable: string; sha256: string; target: string; previous: string; backup: string }): Promise<void> {
  writeFileSync(journalPath, JSON.stringify({ ...values, pid: process.pid, phase: 'prepared', error: '' }), { mode: 0o600 })
  await new Promise<void>((resolve, reject) => {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|PATH|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|ProgramFiles|ProgramFiles\(x86\)|ComSpec|PROCESSOR_ARCHITECTURE)$/i.test(key)))
    const helper = spawn(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', INSTALL_SCRIPT], {
      env: { ...env, HYDRA_UPDATE_HANDOFF: journalPath }, windowsHide: true, detached: true, stdio: 'ignore'
    })
    helper.once('error', reject)
    helper.once('spawn', () => { helper.unref(); resolve() })
  })
}
