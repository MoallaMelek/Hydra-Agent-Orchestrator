#!/usr/bin/env node
/**
 * Latency benchmark with real providers. For each scenario it measures, through the
 * real engine: acknowledgment, agent start, first visible output and completion, and
 * separately the same prompt sent straight to the provider CLI (pure provider latency).
 * Uses the operator's own provider account (a few cents per run).
 *
 *   npx tsc -b && node tools/bench-latency.mjs <out.json> [--runs 3] [--provider claude]
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '@hydra/engine'
import { resolveProviderExecutable } from '../packages/engine/dist/agents/resolve.js'

const args = process.argv.slice(2)
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'bench-latency.json'
const runs = Number(args.includes('--runs') ? args[args.indexOf('--runs') + 1] : 3)
const provider = args.includes('--provider') ? args[args.indexOf('--provider') + 1] : 'claude'

const SCENARIOS = [
  { id: 'greeting', prompt: 'hi', intent: 'analyze' },
  { id: 'repo-question', prompt: 'What does add() in math.js return?', intent: 'analyze' }
]

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hydra-bench-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'bench', private: true, scripts: { test: 'node --test' } }))
  writeFileSync(join(root, 'math.js'), 'function add(a, b) {\n  return a - b\n}\nmodule.exports = { add }\n')
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore' })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'b@example.invalid'); git('config', 'user.name', 'b'); git('add', '-A'); git('commit', '-qm', 'init')
  return root
}

const stats = (values) => {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  if (!v.length) return null
  const at = (q) => v[Math.min(v.length - 1, Math.ceil(q * v.length) - 1)]
  return { n: v.length, median: at(0.5), p95: at(0.95), min: v[0], max: v[v.length - 1] }
}

/** The provider alone: one CLI call, timing the first streamed text and the end. */
function direct(prompt, cwd) {
  const exe = resolveProviderExecutable(provider)
  const argv = provider === 'claude'
    ? ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', prompt]
    : ['exec', '--json', '--skip-git-repo-check', '--ephemeral', prompt]
  return new Promise((resolve) => {
    const started = Date.now()
    let first = null
    const child = spawn(exe, argv, { cwd, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    child.stdout.on('data', (chunk) => {
      if (first === null && /"(text|agent_message|assistant)"/.test(String(chunk))) first = Date.now() - started
    })
    child.on('close', () => resolve({ firstOutputMs: first, totalMs: Date.now() - started }))
  })
}

const repo = fixture()
const dataDir = mkdtempSync(join(tmpdir(), 'hydra-bench-data-'))
const openedAt = Date.now()
const engine = await Engine.open({ dataDir })
const engineOpenMs = Date.now() - openedAt
const project = await engine.execute({ type: 'project.add', root: repo })
const projectId = project.result.id

const marks = new Map() // taskId -> { started, firstOutput, done }
engine.subscribe(({ event }) => {
  const now = Date.now()
  const taskId = event.taskId ?? event.task?.id ?? event.run?.taskId
  if (!taskId || !marks.has(taskId)) return
  const m = marks.get(taskId)
  if (event.type === 'run.updated' && m.agentStart === undefined) m.agentStart = now
  if (event.type === 'run.output' && m.firstOutput === undefined && event.text.trim()) m.firstOutput = now
  if (event.type === 'task.updated' && ['completed', 'failed', 'paused', 'canceled'].includes(event.task.status) && m.done === undefined) m.done = now
})

const results = { at: new Date().toISOString(), provider, runs, engineOpenMs, scenarios: {} }
for (const scenario of SCENARIOS) {
  const hydra = []
  const providerOnly = []
  for (let i = 0; i < runs; i++) {
    const submitted = Date.now()
    const ack = await engine.execute({ type: 'task.create', projectId, prompt: scenario.prompt, intent: scenario.intent, mode: 'safe', assignment: { planner: provider, implementer: provider, reviewer: provider } })
    const ackMs = Date.now() - submitted
    const id = ack.result.id
    const m = { submitted }
    marks.set(id, m)
    while (m.done === undefined) await new Promise((r) => setTimeout(r, 50))
    const task = engine.store.getTask(id)
    hydra.push({ ackMs, toAgentStartMs: m.agentStart - submitted, firstOutputMs: m.firstOutput ? m.firstOutput - submitted : null, totalMs: m.done - submitted, status: task.status, agentRuns: task.usage.agentRuns, costUsd: task.usage.costUsd, answer: (task.answer ?? task.error ?? '').slice(0, 160) })
    providerOnly.push(await direct(scenario.prompt, repo))
    console.log(scenario.id, i, JSON.stringify(hydra.at(-1)), JSON.stringify(providerOnly.at(-1)))
  }
  results.scenarios[scenario.id] = {
    hydra: { ack: stats(hydra.map((r) => r.ackMs)), agentStart: stats(hydra.map((r) => r.toAgentStartMs)), firstOutput: stats(hydra.map((r) => r.firstOutputMs)), total: stats(hydra.map((r) => r.totalMs)), samples: hydra },
    providerOnly: { firstOutput: stats(providerOnly.map((r) => r.firstOutputMs)), total: stats(providerOnly.map((r) => r.totalMs)), samples: providerOnly }
  }
}
await engine.close()
writeFileSync(out, JSON.stringify(results, null, 2))
for (const [id, r] of Object.entries(results.scenarios)) {
  console.log(`${id}: Hydra total median ${r.hydra.total?.median} ms (first output ${r.hydra.firstOutput?.median ?? 'none'}), provider alone median ${r.providerOnly.total?.median} ms`)
}
