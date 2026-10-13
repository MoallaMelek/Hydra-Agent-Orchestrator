import { killTree, lineSplitter, spawnArgv } from '../process/spawn.js'
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
}

/**
 * Runs a provider CLI that emits JSON lines on stdout and yields normalized events.
 * Guarantees exactly one terminal `finished` event and that the process tree is gone
 * before the iterator completes.
 */
export async function* runJsonlProcess(spec: JsonlProcessSpec, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const queue: AgentEvent[] = []
  let wake: (() => void) | null = null
  let closed = false
  const push = (event: AgentEvent) => {
    queue.push(event)
    wake?.()
  }

  if (signal.aborted) {
    yield { type: 'finished', status: 'canceled', detail: 'Canceled before start' }
    return
  }

  let child
  try {
    child = spawnArgv(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, stdin: 'pipe' })
  } catch (error) {
    yield { type: 'finished', status: 'failed', detail: `Could not start ${spec.executable}: ${(error as Error).message}` }
    return
  }

  let stderrTail = ''
  let ending: 'canceled' | 'timed_out' | null = null
  const stop = (why: 'canceled' | 'timed_out') => {
    if (ending) return
    ending = why
    void killTree(child)
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
  child.stdout?.on('data', (chunk) => lines.push(chunk))
  child.stderr?.on('data', (chunk) => { stderrTail = (stderrTail + chunk.toString()).slice(-4000) })
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
    const code = await exit
    while (queue.length) yield queue.shift()!
    if (ending === 'canceled') yield { type: 'finished', status: 'canceled', detail: 'Canceled' }
    else if (ending === 'timed_out') yield { type: 'finished', status: 'timed_out', detail: `Timed out after ${Math.round(spec.timeoutMs / 1000)}s` }
    else {
      const verdict = spec.conclude(code, stderrTail)
      yield { type: 'finished', status: verdict.status, detail: verdict.detail }
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    if (!closed) await killTree(child)
  }
}
