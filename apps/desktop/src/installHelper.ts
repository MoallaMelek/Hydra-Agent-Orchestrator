import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

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
  if ($handoff.dataDirOverride) { $env:HYDRA_DATA_DIR = $handoff.dataDirOverride }
  Start-Process -FilePath $handoff.executable -WindowStyle Hidden
  Save-Phase 'launched' ''
} catch {
  Save-Phase 'failed' $_.Exception.Message
  if ($handoff.dataDirOverride) { $env:HYDRA_DATA_DIR = $handoff.dataDirOverride }
  if (Test-Path -LiteralPath $handoff.executable) { Start-Process -FilePath $handoff.executable -WindowStyle Hidden }
  exit 1
}
`

export async function launchInstallHelper(journalPath: string, values: { installer: string; executable: string; sha256: string; target: string; previous: string; backup: string; dataDirOverride?: string }): Promise<void> {
  if (values.dataDirOverride && !isAbsolute(values.dataDirOverride)) throw new Error('Update restart requires an absolute data directory')
  writeFileSync(journalPath, JSON.stringify({ ...values, pid: process.pid, phase: 'prepared', error: '' }), { mode: 0o600 })
  const helperPid = await new Promise<number>((resolve, reject) => {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|PATH|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|ProgramFiles|ProgramFiles\(x86\)|ComSpec|PROCESSOR_ARCHITECTURE)$/i.test(key)))
    const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    // DETACHED_PROCESS makes Windows PowerShell silently skip -Command on some
    // Windows systems. The OS Start-Process launcher creates an independent,
    // hidden helper instead. Only this constant reviewed script is encoded;
    // paths and package metadata are read from the journal, never interpolated.
    const bootstrap = "$ErrorActionPreference='Stop'; $p=Start-Process -FilePath $env:HYDRA_UPDATE_POWERSHELL -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$env:HYDRA_UPDATE_SCRIPT) -WindowStyle Hidden -RedirectStandardOutput ($env:HYDRA_UPDATE_HANDOFF+'.stdout.log') -RedirectStandardError ($env:HYDRA_UPDATE_HANDOFF+'.stderr.log') -PassThru; $p.Id"
    const launcher = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', bootstrap], {
      env: { ...env, HYDRA_UPDATE_HANDOFF: journalPath, HYDRA_UPDATE_POWERSHELL: powershell, HYDRA_UPDATE_SCRIPT: Buffer.from(INSTALL_SCRIPT, 'utf16le').toString('base64') }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    launcher.stdout.on('data', chunk => { if (output.length < 1024) output += String(chunk).slice(0, 1024) })
    launcher.stderr.resume()
    launcher.once('error', reject)
    launcher.once('exit', code => {
      launcher.stdout.destroy()
      launcher.stderr.destroy()
      const pid = Number(output.trim())
      if (code === 0 && Number.isSafeInteger(pid) && pid > 0) resolve(pid)
      else reject(new Error('Update helper launcher failed; Hydra will remain open.'))
    })
  })
  try {
    // A created OS process is not proof PowerShell initialized successfully.
    // Keep Hydra alive until the helper acknowledges it is waiting for our exit.
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const state = JSON.parse(readFileSync(journalPath, 'utf8').replace(/^\uFEFF/, '')) as { phase: string }
        if (state.phase === 'waiting_for_exit') return
        if (state.phase === 'failed') throw new Error('Update helper could not prepare; see its local log.')
      } catch (error) { if (!(error instanceof SyntaxError)) throw error }
      try { process.kill(helperPid, 0) } catch { throw new Error('Update helper exited before confirming readiness; see its local log.') }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Update helper did not confirm readiness; restart was refused. See its local log.')
  } catch (error) { try { process.kill(helperPid) } catch { /* Already exited. */ } throw error }
}
