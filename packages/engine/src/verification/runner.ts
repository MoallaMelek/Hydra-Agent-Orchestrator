import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import type { CheckSpec, Evidence } from '@hydra/protocol'
import { verificationEnv } from '../process/env.js'
import { findOnPath, killTree, reapGroup, spawnArgv } from '../process/spawn.js'
import { isInside } from '../isolation/roots.js'
import { newId, isoNow } from '../util/ids.js'
import { redact } from '../util/redact.js'
import { SCRATCH } from './detect.js'

const TAIL_BYTES = 20_000
/** Per-check log quota; output beyond it is dropped (and counted) but never buffered. */
const LOG_QUOTA_BYTES = 16 * 1024 * 1024

export interface RunChecksOptions {
  taskId: string
  workspacePath: string
  commitSha: string
  phase: Evidence['phase']
  logsDir: string
  scratchDir: string
  signal: AbortSignal
  env?: NodeJS.ProcessEnv
  onEvidence?: (evidence: Evidence) => void
}

export const passed = (evidence: Evidence): boolean => evidence.exitCode === 0 && !evidence.timedOut && !evidence.spawnError && !evidence.treeMutated

/** Executes each check in order and returns observed evidence. Never throws for a failing check. */
export async function runChecks(specs: readonly CheckSpec[], options: RunChecksOptions): Promise<Evidence[]> {
  mkdirSync(options.logsDir, { recursive: true })
  mkdirSync(options.scratchDir, { recursive: true })
  const results: Evidence[] = []
  for (const spec of specs) {
    if (options.signal.aborted) break
    const evidence = await runOne(spec, options)
    results.push(evidence)
    options.onEvidence?.(evidence)
  }
  return results
}

/** Resolves symlinks/junctions so confinement is checked on real paths, not lexically. */
function realInside(root: string, candidate: string): boolean {
  try { return isInside(realpathSync.native(root), realpathSync.native(candidate)) } catch { return false }
}

async function runOne(spec: CheckSpec, options: RunChecksOptions): Promise<Evidence> {
  const id = newId()
  const startedAt = isoNow()
  const started = Date.now()
  const env = verificationEnv(options.env ?? process.env)
  const cwd = resolve(options.workspacePath, spec.cwd)
  const argv = spec.argv.map((part) => part.split(SCRATCH).join(options.scratchDir))
  const base = {
    id, taskId: options.taskId, checkId: spec.id, label: spec.label, phase: options.phase, commitSha: options.commitSha,
    argv, cwd: spec.cwd, startedAt, required: spec.required, treeMutated: false, outputTruncated: false
  }
  const fail = (message: string): Evidence => ({
    ...base, durationMs: Date.now() - started, exitCode: null, timedOut: false, spawnError: message,
    outputTail: '', outputBytes: 0, outputSha256: createHash('sha256').digest('hex')
  })

  if (!isInside(options.workspacePath, cwd) || !realInside(options.workspacePath, cwd)) return fail('Check working directory escapes the workspace')
  const command = argv[0]!
  const local = command.startsWith('./') || command.startsWith('.\\') || isAbsolute(command)
  const executable = local ? resolve(cwd, command) : findOnPath(command, env)
  if (!executable) return fail(`"${command}" is not installed or not on PATH`)
  if (local && !isAbsolute(command) && !realInside(options.workspacePath, executable)) return fail('Check executable resolves outside the workspace')

  const hash = createHash('sha256')
  const log = createWriteStream(join(options.logsDir, `${id}.log`))
  let logError: string | null = null
  log.on('error', (error) => { logError = error.message })
  let tail = ''
  let bytes = 0
  let logged = 0
  let truncated = false
  let timedOut = false
  const record = (chunk: Buffer) => {
    hash.update(chunk)
    bytes += chunk.length
    tail = (tail + chunk.toString('utf8')).slice(-TAIL_BYTES * 2)
    if (logged + chunk.length <= LOG_QUOTA_BYTES) {
      if (!logError) log.write(redact(chunk.toString('utf8')))
      logged += chunk.length
    } else {
      truncated = true
    }
  }

  let child
  try {
    child = spawnArgv(executable, argv.slice(1), { cwd, env })
  } catch (error) {
    log.end()
    return fail((error as Error).message)
  }
  const timer = setTimeout(() => { timedOut = true; void killTree(child) }, spec.timeoutSec * 1000)
  const onAbort = () => { void killTree(child) }
  options.signal.addEventListener('abort', onAbort, { once: true })
  child.stdout?.on('data', record)
  child.stderr?.on('data', record)
  const outcome = await new Promise<{ code: number | null; error: string | null }>((done) => {
    child.on('error', (error) => done({ code: null, error: error.message }))
    child.on('close', (code) => done({ code, error: null }))
  })
  clearTimeout(timer)
  options.signal.removeEventListener('abort', onAbort)
  reapGroup(child) // reap any descendants left in the process group (POSIX)
  await new Promise<void>((done) => log.end(done))

  return {
    ...base,
    durationMs: Date.now() - started,
    exitCode: timedOut || options.signal.aborted ? null : outcome.code,
    timedOut,
    spawnError: outcome.error ?? (logError ? `Log write failed: ${logError}` : null),
    outputTail: redact(tail).slice(-TAIL_BYTES),
    outputBytes: bytes,
    outputSha256: hash.digest('hex'),
    outputTruncated: truncated
  }
}
