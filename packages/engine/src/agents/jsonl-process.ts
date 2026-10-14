import type { ChildProcess } from 'node:child_process'
import { killTree, lineSplitter, reapGroup, spawnArgv } from '../process/spawn.js'
import type { AgentEvent } from './types.js'

export interface JsonlProcessSpec {
  executable: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  stdin: string
  timeoutMs: number
  /** Maps one stdout JSON object to zero or more normalized events. */
  translate: (json: Record<string, unknown>) => AgentEvent[]
  /** Decides the final status once the process has closed. */
  conclude: (exitCode: number | null, stderrTail: string) => { status: 'succeeded' | 'failed'; detail: string | null }
  /** A process started ahead of time with the same arguments; used instead of spawning. */
  prestarted?: ChildProcess
  /** How long a stopped process may take to exit before it is reported as still running. */
  stopDeadlineMs?: number
}

/** How long a process may take to exit after being told to stop before Hydra reports it. */
const STOP_DEADLINE_MS = 10_000

/**
 * Runs a provider CLI that emits JSON lines on stdout and yields normalized events.
 * Guarantees exactly one terminal `finished` event and that the process tree is gone
 * before the iterator completes.
 */
export async function* runJsonlProcess(spec: JsonlProcessSpec, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const queue: AgentEvent[] = []
  let wake: (() => void) | null = null
  let closed = false
  let abandoned = false
  const push = (event: AgentEvent) => {
    if (abandoned) return
    queue.push(event)
    wake?.()
  }
  const deadlineMs = spec.stopDeadlineMs ?? STOP_DEADLINE_MS

  if (signal.aborted) {
    // A process handed over to this run is ours to clean up, even if it never ran.
    if (spec.prestarted) await killTree(spec.prestarted)
    yield { type: 'finished', status: 'canceled', detail: 'Canceled before start' }
    return
  }

  let child: ChildProcess
  if (spec.prestarted) child = spec.prestarted
  else {
    try {
      child = spawnArgv(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, stdin: 'pipe' })
    } catch (error) {
      yield { type: 'finished', status: 'failed', detail: `Could not start ${spec.executable}: ${(error as Error).message}` }
      return
    }
  }

  let stderrTail = ''
  let ending: 'canceled' | 'timed_out' | null = null
  let unstoppable = false
  /** Resolves false if something the process started may have survived the stop. */
  let stopping: Promise<boolean> | null = null
  const stop = (why: 'canceled' | 'timed_out') => {
    if (ending) return
    ending = why
    stopping = killTree(child)
    // Never report a stop that did not happen: if the process outlives the deadline, say so.
    const deadline = setTimeout(() => { if (!closed) { unstoppable = true; closed = true; wake?.() } }, deadlineMs)
    deadline.unref?.()
  }
  const onAbort = () => stop('canceled')
  signal.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => stop('timed_out'), spec.timeoutMs)
  timer.unref?.()

  push({ type: 'started', pid: child.pid ?? null, command: spec.executable })

  const lines = lineSplitter((line) => {
    let json: unknown
    try { json = JSON.parse(line) } catch { return } // non-JSON diagnostics are ignored
    if (json && typeof json === 'object') for (const event of spec.translate(json as Record<string, unknown>)) push(event)
  })
  const onStdout = (chunk: Buffer) => lines.push(chunk)
  const onStderr = (chunk: Buffer) => { stderrTail = (stderrTail + chunk.toString()).slice(-4000) }
  child.stdout?.on('data', onStdout)
  child.stderr?.on('data', onStderr)
  /** Stops reading a process this run no longer follows; its output is drained and discarded. */
  const detach = () => {
    abandoned = true
    queue.length = 0
    child.stdout?.off('data', onStdout)
    child.stderr?.off('data', onStderr)
    child.stdout?.resume()
    child.stderr?.resume()
  }
  child.stdin?.on('error', () => { /* child may exit before reading stdin */ })
  child.stdin?.end(spec.stdin)

  const exit = new Promise<number | null>((resolve) => {
    child.on('error', (error) => { stderrTail += `\n${error.message}`; resolve(null) })
    child.on('close', (code) => resolve(code))
  }).then((code) => {
    lines.end()
    closed = true
    wake?.()
    return code
  })

  try {
    while (true) {
      while (queue.length) yield queue.shift()!
      if (closed) break
      await new Promise<void>((resolve) => { wake = resolve })
      wake = null
    }
    if (unstoppable) {
      const pending = queue.splice(0)
      detach()
      for (const event of pending) yield event
      yield { type: 'finished', status: 'failed', detail: `Process ${child.pid ?? '?'} did not exit within ${Math.round(deadlineMs / 1000)}s of being stopped and may still be running; end it in your task manager.` }
      return
    }
    const code = await exit
    reapGroup(child)
    while (queue.length) yield queue.shift()!
    const leftovers = stopping && !(await stopping) ? '; some processes it started may still be running, end them in your task manager' : ''
    if (ending === 'canceled') yield { type: 'finished', status: 'canceled', detail: `Canceled${leftovers}` }
    else if (ending === 'timed_out') yield { type: 'finished', status: 'timed_out', detail: `Timed out after ${Math.round(spec.timeoutMs / 1000)}s${leftovers}` }
    else {
      const verdict = spec.conclude(code, stderrTail)
      yield { type: 'finished', status: verdict.status, detail: verdict.detail }
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    if (!closed) await killTree(child)
    detach()
  }
}
