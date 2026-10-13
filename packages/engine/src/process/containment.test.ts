import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { isContained, killTree, reapGroup, spawnArgv, waitForExit } from './spawn.js'
import { jobSupport } from './winjob.js'
import { runJsonlProcess } from '../agents/jsonl-process.js'

// Real processes only: a parent that starts a grandchild which ignores ordinary
// termination. On Windows the grandchild is started detached (it outlives its parent's
// tree, the case taskkill /T misses); on POSIX it stays in the process group (a process
// that creates its own session can escape a group, a documented limit).

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const WIN = process.platform === 'win32'

/** Starts a parent that spawns a stubborn grandchild, prints its pid, then optionally exits. */
function family(parentExits: boolean) {
  const code = `
const { spawn } = require('child_process');
const g = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});process.on("SIGINT",()=>{});setInterval(()=>{},1000)'], { detached: ${WIN}, stdio: 'ignore' });
g.unref(); console.log(g.pid); ${parentExits ? 'setTimeout(() => process.exit(0), 100)' : 'setInterval(()=>{},1000)'};`
  const child = spawnArgv(process.execPath, ['-e', code], { cwd: process.cwd(), env: process.env, stdin: 'pipe' })
  const grandchild = new Promise<number>((resolve) => {
    let out = ''
    child.stdout!.on('data', (d) => { out += d; const n = Number(out.trim()); if (n) resolve(n) })
  })
  return { child, grandchild }
}

async function gone(pid: number, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { if (!alive(pid)) return true; await new Promise((r) => setTimeout(r, 50)) }
  return !alive(pid)
}

describe('process containment (real processes)', () => {
  it.runIf(WIN)('uses an OS job object on Windows', () => {
    expect(jobSupport()).toEqual({ available: true, reason: null })
    const { child } = family(false)
    expect(isContained(child)).toBe(true)
    void killTree(child)
  })

  it('cancelling ends the whole tree, including a grandchild that ignores termination', async () => {
    const { child, grandchild } = family(false)
    const g = await grandchild
    expect(alive(g)).toBe(true)
    expect(await killTree(child)).toBe(true)
    expect(await waitForExit(child, 5000)).toBe(true)
    expect(await gone(g)).toBe(true)
  })

  it('cleans up a descendant left behind after its parent finished', async () => {
    const { child, grandchild } = family(true)
    const g = await grandchild
    await waitForExit(child, 10_000)
    reapGroup(child)
    expect(await gone(g)).toBe(true)
  })

  it('never touches an unrelated process', async () => {
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
    const { child, grandchild } = family(false)
    await grandchild
    await killTree(child)
    expect(alive(unrelated.pid!)).toBe(true)
    unrelated.kill()
  })

  it('cancelling an agent run ends the agent and what it started', async () => {
    const code = `
const { spawn } = require('child_process');
const g = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { detached: ${WIN}, stdio: 'ignore' });
g.unref(); console.log(JSON.stringify({ type: 'pid', pid: g.pid })); setInterval(()=>{},1000);`
    const abort = new AbortController()
    let grand = 0
    const events = []
    for await (const event of runJsonlProcess({
      executable: process.execPath, args: ['-e', code], cwd: process.cwd(), env: process.env, stdin: '', timeoutMs: 60_000,
      translate: (json) => { if (json.type === 'pid') { grand = Number(json.pid); setTimeout(() => abort.abort(), 100) } return [] },
      conclude: () => ({ status: 'succeeded', detail: null })
    }, abort.signal)) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: 'finished', status: 'canceled' })
    expect(grand).toBeGreaterThan(0)
    expect(await gone(grand)).toBe(true)
  })
})

describe.runIf(WIN)('engine crash (Windows, real processes)', () => {
  it('every process the engine started dies when the engine is killed', async () => {
    // A stand-in engine: binds itself to a kill-on-close job, starts a detached stubborn process, waits.
    const winjob = new URL('../../dist/process/winjob.js', import.meta.url).href
    const code = `
import { spawn } from 'node:child_process';
const { bindChildrenToThisProcess } = await import(${JSON.stringify(winjob)});
if (!bindChildrenToThisProcess()) { console.log('nobind'); process.exit(1) }
const g = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
g.unref(); console.log(g.pid); setInterval(()=>{},1000);`
    const engine = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] })
    const g = await new Promise<number>((resolve, reject) => {
      let out = ''
      engine.stdout!.on('data', (d) => { out += d; if (out.includes('nobind')) reject(new Error('could not bind')); const n = Number(out.trim()); if (n) resolve(n) })
    })
    expect(alive(g)).toBe(true)
    engine.kill('SIGKILL') // a crash: no clean-up code runs
    expect(await gone(g)).toBe(true)
  })
})
