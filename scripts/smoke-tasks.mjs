// Opt-in authenticated smoke. Agents operate only in this isolated temporary
// fixture, never in Hydra. Output contains metadata, not CLI logs or credentials.
import { createServer } from 'vite'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const fixture = await mkdtemp(join(tmpdir(), 'hydra-live-smoke-'))
await writeFile(join(fixture, 'README.md'), '# Isolated Hydra smoke fixture\nThe answer to two plus two is four.\n')
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'hydra-smoke-fixture', private: true, scripts: { test: 'node --test' } }))
await writeFile(join(fixture, 'arithmetic.test.cjs'), 'const {test}=require("node:test");const assert=require("node:assert/strict");test("arithmetic",()=>assert.equal(2+2,4));\n')
for (const args of [['init','-q'],['add','.'],['-c','user.name=Hydra Smoke','-c','user.email=smoke@local','commit','-qm','isolated fixture']]) execFileSync('git',args,{cwd:fixture,stdio:'ignore',windowsHide:true})
const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, resolve: { alias: { '@shared': resolve('shared') } } })
const { TaskCoordinator } = await vite.ssrLoadModule('/electron/tasks/TaskCoordinator.ts')
const { HeadlessOrchestrator } = await vite.ssrLoadModule('/electron/headless/HeadlessOrchestrator.ts')
const { createTaskAdapters } = await vite.ssrLoadModule('/electron/tasks/providerAdapters.ts')
const state = await mkdtemp(join(tmpdir(), 'hydra-live-state-'))
const runs = new HeadlessOrchestrator(join(state, 'runs'))
const coordinator = new TaskCoordinator(join(state, 'tasks'), createTaskAdapters(runs))
const results = []
try {
  for (const providers of [['claude'], ['codex'], ['claude','codex']]) {
    const task = await coordinator.create({ projectDir: fixture, providers, permissionMode: 'safe', intent: 'analyze', prompt: 'Read README.md in this isolated fixture and explain its arithmetic statement in one short paragraph. Do not change files or execute write actions. Keep analysis and synthesis concise.' })
    const budget = setTimeout(() => { void coordinator.command(task.id,{action:'cancel'}) }, 180000)
    let current
    do { await new Promise(done=>setTimeout(done,500)); current=coordinator.get(task.id) } while (['planning','queued','implementation','review','repair','verification','synthesis'].includes(current.phase))
    clearTimeout(budget)
    const result = { providers, phase: current.phase, error: current.error, attempts: current.attempts.map(v=>({provider:v.provider,role:v.role,status:v.status,sessionEstablished:!!v.sessionId,error:v.error})), unifiedResponse: current.messages.some(v=>v.role==='hydra'), writerInvoked:current.attempts.some(v=>v.role==='implementation') }
    results.push(result); console.log(JSON.stringify(result))
  }
  const status = execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:fixture,encoding:'utf8',windowsHide:true}).trim()
  results.push({ trackedFixtureUnchanged: status === '' })
  await mkdir('.ai/validation',{recursive:true}); await writeFile('.ai/validation/live-smoke.json',JSON.stringify({fixture,results},null,2))
} finally { coordinator.shutdown(); runs.shutdown(); await vite.close() }
if (results.some(v=>v.phase && v.phase!=='completed')) process.exitCode=1
