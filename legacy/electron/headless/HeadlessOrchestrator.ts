import { EventEmitter } from 'events'
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  statSync
} from 'fs'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import { type ChildProcess } from 'child_process'
import { getProvider } from '../agents/providers'
import { spawnResolvedCli, terminateProcessTree } from '../agents/cliExecution'
import { atomicWriteJson } from '../tasks/atomicStore'
import { consumeProviderLine, emptySemanticResult } from '../tasks/semanticResults'
import type {
  HeadlessRun,
  HeadlessRunStatus,
  StartHeadlessRunPayload,
  HeadlessRunEventPayload,
  HeadlessRunLogOptions,
  HeadlessRunLogPayload,
  ListHeadlessRunsOptions
} from '@shared/types'

interface ManagedHeadlessRun {
  state: HeadlessRun
  process: ChildProcess | null
  logPath: string
  metaPath: string
  stdoutBuffer: string
  stderrBuffer: string
  timer?: ReturnType<typeof setTimeout>
  cancelRequested?: boolean
  termination?: Promise<void>
}

interface PersistedHeadlessRunFile {
  schemaVersion: number
  run: HeadlessRun
}

const META_EXTENSION = '.meta.json'
const LOG_EXTENSION = '.jsonl'
const META_SCHEMA_VERSION = 1
const DEFAULT_LOG_TAIL_LINES = 400
const DEFAULT_LOG_MAX_CHARS = 120_000

export class HeadlessOrchestrator extends EventEmitter {
  private runs = new Map<string, ManagedHeadlessRun>()

  constructor(private readonly baseDir: string) {
    super()
    mkdirSync(this.baseDir, { recursive: true })
    this.hydrateRunsFromDisk()
  }

  start(payload: StartHeadlessRunPayload): HeadlessRun {
    const runId = randomUUID().slice(0, 8)
    const startedAt = new Date().toISOString()
    const logPath = join(this.baseDir, `${runId}${LOG_EXTENSION}`)
    const metaPath = join(this.baseDir, `${runId}${META_EXTENSION}`)

    const state: HeadlessRun = {
      id: runId,
      prompt: payload.prompt,
      projectDir: payload.projectDir,
      provider: payload.provider,
      model: payload.model,
      reasoningEffort: payload.reasoningEffort,
      resumeSessionId: payload.resumeSessionId ?? null,
      status: 'running',
      startedAt,
      endedAt: null,
      sessionId: payload.resumeSessionId ?? null,
      error: null,
      result: emptySemanticResult(), accessMode: payload.accessMode ?? 'read-only', sandbox: payload.sandbox ?? 'read-only'
    }

    const managed: ManagedHeadlessRun = {
      state,
      process: null,
      logPath,
      metaPath,
      stdoutBuffer: '',
      stderrBuffer: ''
    }
    this.runs.set(runId, managed)
    writeFileSync(logPath, '', 'utf-8')
    this.persistRun(managed)

    const provider = getProvider(payload.provider)
    const args = provider.buildHeadlessArgs(payload.model, payload.prompt, payload.resumeSessionId ?? null, payload.reasoningEffort)
    if (payload.provider === 'claude' && payload.accessMode !== 'context-only') {
      args[args.indexOf('--tools') + 1] = payload.accessMode === 'project-write' ? 'Read,Glob,Grep,Write,Edit' : 'Read,Glob,Grep'
      args[args.indexOf('--permission-mode') + 1] = payload.accessMode === 'project-write' ? 'acceptEdits' : 'dontAsk'
    }
    if (payload.provider === 'codex' && payload.sandbox === 'workspace-write') {
      const index = args.indexOf('-s') + 1
      if (index > 0) args[index] = 'workspace-write'
    }

    try {
      // Direct native executable; prompt is never parsed by a shell.
      const child = spawnResolvedCli(provider.command, args, {
        cwd: payload.projectDir,
        env: {
          ...process.env,
          FORCE_COLOR: '0'
        }
      })
      managed.process = child
      child.stdin!.on('error', () => { /* close/error determines terminal status */ })
      if (payload.provider !== 'opencode') child.stdin!.end(payload.prompt)
      managed.timer = setTimeout(() => {
        managed.state.error = 'Execution timed out'
        this.cancel(runId)
      }, Math.min(payload.timeoutMs ?? 10 * 60_000, 30 * 60_000))
      managed.timer.unref()

      child.stdout!.on('data', (chunk: Buffer | string) => {
        this.handleStdout(managed, chunk.toString('utf-8'))
      })

      child.stderr!.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString('utf-8')
        managed.stderrBuffer = (managed.stderrBuffer + text).slice(-12000)
        this.appendLog(managed, JSON.stringify({ type: 'stderr', text }))
        this.emitRunEvent({ runId, data: text })
      })

      child.on('close', (code) => {
        if (managed.stdoutBuffer.trim()) this.handleStdout(managed, '\n')
        if (managed.cancelRequested) {
          void (managed.termination ?? Promise.resolve()).then(() => this.finalizeRun(managed, managed.state.error ? 'errored' : 'canceled', managed.state.error))
          return
        }
        if (code === 0 && !managed.state.result?.failed && (payload.provider === 'opencode' || managed.state.result?.terminal)) {
          this.finalizeRun(managed, 'completed', null)
        } else {
          this.finalizeRun(managed, 'errored', managed.state.result?.error || `CLI exited without successful semantic completion (code ${code ?? -1})`)
        }
      })

      child.on('error', (err) => {
        this.finalizeRun(managed, 'errored', err.message)
      })
    } catch (err) {
      this.finalizeRun(managed, 'errored', (err as Error).message)
    }

    return { ...managed.state }
  }

  list(options: ListHeadlessRunsOptions = {}): HeadlessRun[] {
    const query = options.query?.trim().toLowerCase()
    const statusFilter = options.status && options.status !== 'all' ? options.status : null

    const filtered = Array.from(this.runs.values())
      .map((run) => ({ ...run.state }))
      .filter((run) => {
        if (statusFilter && run.status !== statusFilter) return false
        if (!query) return true
        return (
          run.id.toLowerCase().includes(query) ||
          run.prompt.toLowerCase().includes(query) ||
          run.projectDir.toLowerCase().includes(query) ||
          run.model.toLowerCase().includes(query) ||
          run.status.toLowerCase().includes(query) ||
          (run.sessionId ?? '').toLowerCase().includes(query) ||
          (run.error ?? '').toLowerCase().includes(query)
        )
      })
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))

    if (typeof options.limit === 'number' && options.limit > 0) {
      return filtered.slice(0, options.limit)
    }
    return filtered
  }

  get(runId: string): HeadlessRun | null {
    const managed = this.runs.get(runId)
    return managed ? { ...managed.state } : null
  }

  getLog(runId: string, options: HeadlessRunLogOptions = {}): HeadlessRunLogPayload | null {
    const managed = this.runs.get(runId)
    if (!managed) return null
    if (!existsSync(managed.logPath)) {
      return {
        runId,
        content: '',
        totalLines: 0,
        returnedLines: 0,
        truncated: false
      }
    }

    const tailLines =
      options.tailLines && options.tailLines > 0
        ? Math.floor(options.tailLines)
        : DEFAULT_LOG_TAIL_LINES
    const maxChars =
      options.maxChars && options.maxChars > 0
        ? Math.floor(options.maxChars)
        : DEFAULT_LOG_MAX_CHARS

    const raw = readFileSync(managed.logPath, 'utf-8')
    const allLines = raw.length === 0 ? [] : raw.split('\n').filter((line) => line.length > 0)
    const totalLines = allLines.length
    const sliced = allLines.slice(Math.max(0, totalLines - tailLines))
    let content = sliced.join('\n')
    let truncated = totalLines > sliced.length

    if (content.length > maxChars) {
      content = content.slice(content.length - maxChars)
      truncated = true
    }

    const returnedLines = content.length === 0 ? 0 : content.split('\n').length
    return {
      runId,
      content,
      totalLines,
      returnedLines,
      truncated
    }
  }

  cancel(runId: string): boolean {
    const managed = this.runs.get(runId)
    if (!managed || !managed.process) return false
    if (managed.cancelRequested) return true
    managed.cancelRequested = true
    managed.termination = terminateProcessTree(managed.process).catch(err => {
      managed.state.error = `Cancellation failed: ${(err as Error).message}`
      this.persistRun(managed)
      this.emitRunEvent({ runId, data: managed.state.error })
    })
    return true
  }

  shutdown(): void { for (const run of this.runs.values()) if (run.process) this.cancel(run.state.id) }

  private handleStdout(managed: ManagedHeadlessRun, data: string): void {
    managed.stdoutBuffer += data
    if (managed.stdoutBuffer.length > 2_000_000) {
      managed.state.error = 'Provider output exceeded line limit'
      this.cancel(managed.state.id)
      managed.stdoutBuffer = managed.stdoutBuffer.slice(-120000)
    }
    const lines = managed.stdoutBuffer.split('\n')
    managed.stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      this.appendLog(managed, line)
      this.captureSessionId(managed, line)
      if (managed.state.result) {
        const previousText = managed.state.result.text
        consumeProviderLine(managed.state.provider, line, managed.state.result, managed.state.id)
        if (managed.state.result.text !== previousText) this.emit('text', { runId: managed.state.id, text: managed.state.result.text })
        if (managed.state.result.sessionId) managed.state.sessionId = managed.state.result.sessionId
      }
      this.emitRunEvent({ runId: managed.state.id, data: line })
    }
  }

  private captureSessionId(managed: ManagedHeadlessRun, line: string): void {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const session =
        (typeof parsed.session_id === 'string' && parsed.session_id) ||
        (typeof parsed.sessionId === 'string' && parsed.sessionId) ||
        null
      if (session) {
        managed.state.sessionId = session
        this.persistRun(managed)
      }
    } catch {
      // Non-JSON line, ignore.
    }
  }

  private appendLog(managed: ManagedHeadlessRun, line: string): void {
    try {
      appendFileSync(managed.logPath, `${line}\n`, 'utf-8')
    } catch {
      // Best effort log persistence.
    }
  }

  private finalizeRun(
    managed: ManagedHeadlessRun,
    status: HeadlessRunStatus,
    error: string | null
  ): void {
    if (managed.state.endedAt) return
    if (managed.timer) clearTimeout(managed.timer)
    managed.process = null
    managed.state.status = status
    managed.state.error = error
    managed.state.endedAt = new Date().toISOString()
    this.persistRun(managed)
    this.emit('terminal', { ...managed.state })
    this.emitRunEvent({ runId: managed.state.id, data: JSON.stringify({ type: 'hydra.terminal', status, error }) })
  }

  private emitRunEvent(payload: HeadlessRunEventPayload): void {
    this.emit('event', payload)
  }

  private hydrateRunsFromDisk(): void {
    const entries = readdirSync(this.baseDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)

    const metaFiles = entries.filter((name) => name.endsWith(META_EXTENSION))
    for (const metaName of metaFiles) {
      const metaPath = join(this.baseDir, metaName)
      try {
        const raw = readFileSync(metaPath, 'utf-8')
        const parsed = JSON.parse(raw) as Partial<PersistedHeadlessRunFile>
        const run = parsed.run
        if (!run || !this.isHeadlessRun(run)) continue

        if (!run.provider) run.provider = 'claude'
        if (run.status === 'running') {
          run.status = 'errored'; run.error = 'Interrupted by daemon restart'; run.endedAt = new Date().toISOString()
          atomicWriteJson(metaPath, { schemaVersion: META_SCHEMA_VERSION, run })
        }
        const logPath = join(this.baseDir, `${run.id}${LOG_EXTENSION}`)
        this.runs.set(run.id, {
          state: run,
          process: null,
          logPath,
          metaPath,
          stdoutBuffer: '',
          stderrBuffer: ''
        })
      } catch {
        // Ignore malformed persisted entries.
      }
    }

    const logFiles = entries.filter((name) => name.endsWith(LOG_EXTENSION))
    for (const logName of logFiles) {
      const runId = basename(logName, LOG_EXTENSION)
      if (this.runs.has(runId)) continue

      const logPath = join(this.baseDir, logName)
      const metaPath = join(this.baseDir, `${runId}${META_EXTENSION}`)
      const stat = statSync(logPath)
      const timestamp = stat.mtime.toISOString()

      const fallbackRun: HeadlessRun = {
        id: runId,
        prompt: '(legacy run)',
        projectDir: '',
        provider: 'claude',
        model: 'sonnet',
        resumeSessionId: null,
        status: 'completed',
        startedAt: timestamp,
        endedAt: timestamp,
        sessionId: this.discoverSessionIdFromLog(logPath),
        error: null
      }

      const managed: ManagedHeadlessRun = {
        state: fallbackRun,
        process: null,
        logPath,
        metaPath,
        stdoutBuffer: '',
        stderrBuffer: ''
      }
      this.runs.set(runId, managed)
      this.persistRun(managed)
    }
  }

  private discoverSessionIdFromLog(logPath: string): string | null {
    try {
      const raw = readFileSync(logPath, 'utf-8')
      const lines = raw.split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>
          const session =
            (typeof parsed.session_id === 'string' && parsed.session_id) ||
            (typeof parsed.sessionId === 'string' && parsed.sessionId) ||
            null
          if (session) return session
        } catch {
          continue
        }
      }
      return null
    } catch {
      return null
    }
  }

  private persistRun(managed: ManagedHeadlessRun): void {
    const payload: PersistedHeadlessRunFile = {
      schemaVersion: META_SCHEMA_VERSION,
      run: managed.state
    }
    try {
      atomicWriteJson(managed.metaPath, payload)
    } catch {
      // Best effort persistence.
    }
  }

  private isHeadlessRun(value: unknown): value is HeadlessRun {
    if (!value || typeof value !== 'object') return false
    const run = value as Record<string, unknown>

    const validStatus =
      run.status === 'running' ||
      run.status === 'completed' ||
      run.status === 'errored' ||
      run.status === 'canceled'

    const validProviders = ['claude', 'codex', 'opencode']
    const validProvider = run.provider === undefined || validProviders.includes(run.provider as string)

    return (
      typeof run.id === 'string' &&
      typeof run.prompt === 'string' &&
      typeof run.projectDir === 'string' &&
      typeof run.model === 'string' &&
      validProvider &&
      (typeof run.resumeSessionId === 'string' || run.resumeSessionId === null) &&
      validStatus &&
      typeof run.startedAt === 'string' &&
      (typeof run.endedAt === 'string' || run.endedAt === null) &&
      (typeof run.sessionId === 'string' || run.sessionId === null) &&
      (typeof run.error === 'string' || run.error === null)
    )
  }
}
