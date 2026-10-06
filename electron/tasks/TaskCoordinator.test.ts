import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { TaskCoordinator } from './TaskCoordinator'
import type { AdapterRequest, TaskProviderAdapter } from './providerAdapters'
import type { HydraTask, TaskRole } from '@shared/tasks'
import { emptySemanticResult } from './semanticResults'

const directories: string[] = []
const coordinators: TaskCoordinator[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hydra-task-test-')); directories.push(root)
  mkdirSync(join(root, 'sub'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }))
  return root
}
const context = async () => ({ repository: '## main', files: ['README.md'], changedFiles: ['README.md'], snapshot: 'Project excerpt', fingerprint: 'same-revision', omissions: [] })
function adapter(id: 'claude' | 'codex', handler?: (request: AdapterRequest) => Promise<any>): TaskProviderAdapter {
  return { id, label: id, canWrite: true, supportsSandbox: id === 'codex', confinedFileWrites: id === 'claude', available: async () => true,
    execute: vi.fn(async request => {
      request.onRun(`run-${id}-${request.role}`)
      if (handler) return handler(request)
      const result = emptySemanticResult(); result.terminal = true; result.sessionId = `session-${id}`
      result.text = request.role === 'analysis' ? JSON.stringify({ intent: 'implement', summary: `${id} independent finding`, writerConfidence: id === 'claude' ? .9 : .6, plan: ['inspect', 'implement', 'verify'], decisions: ['Use existing architecture'] }) : request.role === 'review' ? JSON.stringify({ verdict: 'pass', findings: [], summary: 'Reviewed current changes' }) : `${id} ${request.role} result`
      if (request.role === 'verification') result.evidence = id === 'codex' ? [{ command: 'npm run test', exitCode: 0, output: 'Observed tests', runId: 'verify', kind: 'command' }] : [{ command: 'Read README.md', tool: 'Read', kind: 'file', exitCode: 0, output: 'actual file', runId: 'verify' }]
      return { runId: `run-${id}`, result }
    }) }
}
function create(root: string, adapters = [adapter('claude'), adapter('codex')], customContext = context) {
  const coordinator = new TaskCoordinator(join(root, 'store'), adapters, customContext); coordinators.push(coordinator); return coordinator
}
const payload = (root: string) => ({ projectDir: root, prompt: 'Implement a feature and verify it', providers: ['claude', 'codex'] as ('claude'|'codex')[], permissionMode: 'developer' as const, intent: 'auto' as const })
async function until(coordinator: TaskCoordinator, id: string, phase?: string): Promise<HydraTask> {
  await vi.waitFor(() => expect(phase ? coordinator.get(id).phase === phase : ['completed','blocked','failed','canceled','awaiting_approval'].includes(coordinator.get(id).phase)).toBe(true), { timeout: 5000, interval: 10 })
  return coordinator.get(id)
}
afterEach(async () => {
  for (const coordinator of coordinators.splice(0)) coordinator.shutdown()
  await new Promise(resolve => setTimeout(resolve, 10))
  for (const root of directories.splice(0)) { if (!root.startsWith(join(tmpdir(), 'hydra-task-test-'))) throw new Error('Invalid fixture cleanup'); rmSync(root, { recursive: true, force: true }) }
})

describe('canonical TaskCoordinator', () => {
  it('chooses a restricted Claude writer dynamically and a sandboxed Codex verifier', async () => {
    const root = fixture(), coordinator = create(root)
    const task = await coordinator.create(payload(root)), done = await until(coordinator, task.id)
    expect(done.phase).toBe('completed'); expect(done.writer).toBe('claude')
    expect(done.attempts.find(v => v.role === 'review')?.provider).toBe('codex')
    expect(done.attempts.find(v => v.role === 'verification')?.provider).toBe('codex')
    expect(done.messages.at(-1)?.content).toContain('Observed verification commands')
    expect(done.events.map(v => v.sequence)).toEqual(done.events.map((_, index) => index + 1))
  })
  it('starts independent analyses in parallel without sharing newly generated answers', async () => {
    const root = fixture(); const releases: (() => void)[] = []; const prompts: string[] = []
    const providers = ['claude','codex'].map(id => { const base = adapter(id as 'claude'|'codex'); const execute = base.execute; base.execute = async request => {
      if (request.role === 'analysis') { prompts.push(request.prompt); await new Promise<void>(resolve => releases.push(resolve)) }
      return execute(request)
    }; return base })
    const coordinator = create(root, providers), task = await coordinator.create({ ...payload(root), intent: 'analyze' })
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    expect(prompts[0]).toBe(prompts[1]); expect(prompts[0]).not.toContain('independent finding')
    releases.forEach(resolve => resolve()); expect((await until(coordinator, task.id)).phase).toBe('completed')
  })
  it('serializes writers for aliases of the same canonical project', async () => {
    const root = fixture(); let active = 0, maximum = 0
    const base = adapter('codex'); const execute = base.execute
    base.execute = async request => { if (request.role === 'implementation') { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 25)); active-- } return execute(request) }
    const coordinator = create(root, [base]); const options = { ...payload(root), providers: ['codex'] as ('codex')[] }
    const first = await coordinator.create(options), second = await coordinator.create({ ...options, projectDir: join(root, 'sub', '..') })
    await Promise.all([until(coordinator, first.id), until(coordinator, second.id)])
    expect(maximum).toBe(1); expect(coordinator.get(first.id).projectDir).toBe(coordinator.get(second.id).projectDir)
  })
  it('synthesizes from canonical review and verification rather than incidental failed attempts', async () => {
    const root=fixture(),claude=adapter('claude'),codex=adapter('codex'),originalWriter=claude.execute,originalPeer=codex.execute
    claude.execute=async request=>{const result=await originalWriter(request);if(request.role==='implementation')result.result.text='INCIDENTAL_FAILED_REVIEW: a manual CLI login failed';return result}
    codex.execute=async request=>{if(request.role==='synthesis'){expect(request.prompt).toContain('authoritativeReview');expect(request.prompt).toContain('"independentProvider":true');expect(request.prompt).not.toContain('INCIDENTAL_FAILED_REVIEW')}return originalPeer(request)}
    const coordinator=create(root,[claude,codex]),task=await coordinator.create(payload(root))
    const done=await until(coordinator,task.id);expect(done.phase).toBe('completed');expect(done.messages.at(-1)?.content).toContain('Independent provider review passed')
  })
  it('requires a fresh task-specific Safe approval and rejects stale approval IDs', async () => {
    const root = fixture(), coordinator = create(root), task = await coordinator.create({ ...payload(root), permissionMode: 'safe' })
    const awaiting = await until(coordinator, task.id, 'awaiting_approval')
    expect(awaiting.attempts.some(v => v.role === 'implementation')).toBe(false)
    await expect(coordinator.command(task.id, { action: 'approve', approvalId: '00000000-0000-4000-8000-000000000000', approved: true })).rejects.toThrow('stale')
    await coordinator.command(task.id, { action: 'approve', approvalId: awaiting.approval!.id, approved: true })
    expect((await until(coordinator, task.id)).phase).toBe('completed')
    await coordinator.command(task.id, { action: 'message', prompt: 'Add another feature' })
    expect((await until(coordinator, task.id, 'awaiting_approval')).approval?.id).not.toBe(awaiting.approval?.id)
  })
  it('denies approval without executing a writer', async () => {
    const root = fixture(), coordinator = create(root), task = await coordinator.create({ ...payload(root), permissionMode: 'safe' })
    const awaiting = await until(coordinator, task.id)
    await coordinator.command(task.id, { action: 'approve', approvalId: awaiting.approval!.id, approved: false })
    expect(coordinator.get(task.id).phase).toBe('blocked'); expect(coordinator.get(task.id).attempts.some(v => v.role === 'implementation')).toBe(false)
  })
  it('routes questions to analysis and a later natural-language turn to implementation', async () => {
    const root = fixture(), coordinator = create(root), task = await coordinator.create({ ...payload(root), prompt: 'Explain the architecture' })
    const analysis = await until(coordinator, task.id)
    expect(analysis.intent).toBe('analyze'); expect(analysis.attempts.some(v => v.role === 'implementation')).toBe(false)
    await coordinator.command(task.id, { action: 'message', prompt: 'Now implement the feature' })
    expect((await until(coordinator, task.id)).intent).toBe('implement')
  })
  it('bounds review/fix/re-review and leaves disagreement unresolved', async () => {
    const root = fixture(), reviewer = adapter('codex'); const execute = reviewer.execute
    reviewer.execute = async request => { const result = await execute(request); if (request.role === 'review') result.result.text = JSON.stringify({ verdict: 'changes_required', findings: ['Specific remaining bug'] }); return result }
    const coordinator = create(root, [adapter('claude'), reviewer]), task = await coordinator.create(payload(root)), done = await until(coordinator, task.id)
    expect(done.phase).toBe('blocked'); expect(done.repairRounds).toBe(1); expect(done.findings.every(v => v.disposition === 'unresolved')).toBe(true)
    expect(done.attempts.filter(v => v.role === 'review')).toHaveLength(2)
    expect(done.attempts.some(v => v.role === 'verification')).toBe(false)
  })
  it('completes a single bounded repair when re-review passes', async () => {
    const root = fixture(), reviewer = adapter('codex'); let count = 0; const execute = reviewer.execute
    reviewer.execute = async request => { const result = await execute(request); if (request.role === 'review' && count++ === 0) result.result.text = JSON.stringify({ verdict: 'changes_required', findings: ['Fix regression'] }); return result }
    const coordinator = create(root, [adapter('claude'), reviewer]), task = await coordinator.create(payload(root)), done = await until(coordinator, task.id)
    expect(done.phase).toBe('completed'); expect(done.repairRounds).toBe(1); expect(done.findings[0].disposition).toBe('addressed')
  })
  it('rejects malformed review results rather than claiming completion', async () => {
    const root = fixture(), reviewer = adapter('codex'); const execute = reviewer.execute
    reviewer.execute = async request => { const result = await execute(request); if (request.role === 'review') result.result.text = 'Looks good'; return result }
    const coordinator = create(root, [adapter('claude'), reviewer]), task = await coordinator.create(payload(root))
    expect((await until(coordinator, task.id)).error).toContain('structured verdict')
  })
  it('rejects incidental text and missing or failed intended check evidence', async () => {
    const root = fixture(), verifier = adapter('codex'); const execute = verifier.execute
    verifier.execute = async request => { const result = await execute(request); if (request.role === 'verification') result.result.evidence = [{ command: 'echo test', exitCode: 0, output: 'test', runId: 'fake' }]; return result }
    const coordinator = create(root, [verifier]), task = await coordinator.create({ ...payload(root), providers: ['codex'] })
    expect((await until(coordinator, task.id)).phase).toBe('blocked'); expect(coordinator.get(task.id).error).toContain('npm run test')
  })
  it('cancels a running task, records attempt termination, and releases project ownership', async () => {
    const root = fixture(), base = adapter('codex'), execute = base.execute
    base.execute = async request => { if (request.role === 'implementation') return new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('Stopped process')), { once: true })); return execute(request) }
    const coordinator = create(root, [base]), task = await coordinator.create({ ...payload(root), providers: ['codex'] })
    await until(coordinator, task.id, 'implementation'); await coordinator.command(task.id, { action: 'cancel' })
    const done = await until(coordinator, task.id, 'canceled')
    expect(done.attempts.at(-1)?.status).toBe('canceled'); expect(coordinator.ownsProject(root)).toBe(false)
  })
  it('reports a failed cancellation as failure rather than claiming stopped', async () => {
    const root=fixture(),base=adapter('codex'),execute=base.execute
    base.execute=async request=>{if(request.role==='implementation'){if(request.signal.aborted)throw new Error('Cancellation failed: process tree still active');return new Promise((_,reject)=>request.signal.addEventListener('abort',()=>reject(new Error('Cancellation failed: process tree still active')),{once:true}))}return execute(request)}
    const coordinator=create(root,[base]),task=await coordinator.create({...payload(root),providers:['codex']})
    await until(coordinator,task.id,'implementation');await new Promise(resolve=>setTimeout(resolve,30));await coordinator.command(task.id,{action:'cancel'})
    const done=await until(coordinator,task.id);expect(done.phase).toBe('failed');expect(done.messages.at(-1)?.content).toContain('Task failed');expect(done.attempts.at(-1)?.status).toBe('failed')
  })
  it('surfaces unavailable CLIs and preserves failed attempts', async () => {
    const root = fixture(), unavailable = adapter('codex'); unavailable.available = async () => false
    const coordinator = create(root, [unavailable]), task = await coordinator.create({ ...payload(root), providers: ['codex'] })
    expect((await until(coordinator, task.id)).error).toContain('No selected CLI')
    expect(coordinator.get(task.id).events.some(v => v.text.includes('unavailable'))).toBe(true)
  })
  it('contains provider failure without marking a task complete', async () => {
    const root = fixture(), broken = adapter('codex', async () => { throw new Error('Authentication unavailable') })
    const coordinator = create(root, [broken]), task = await coordinator.create({ ...payload(root), providers: ['codex'] })
    const done = await until(coordinator, task.id); expect(done.phase).toBe('failed'); expect(done.attempts[0].error).toBe('Authentication unavailable')
  })
  it('persists messages, decisions, rename and results across reconstruction', async () => {
    const root = fixture(), coordinator = create(root), task = await coordinator.create(payload(root)); await until(coordinator, task.id)
    await coordinator.command(task.id, { action: 'rename', title: 'Durable conversation' })
    const restored = create(root).get(task.id)
    expect(restored.title).toBe('Durable conversation'); expect(restored.messages).toHaveLength(2); expect(restored.decisions).toContain('Use existing architecture')
    const next = await coordinator.create({ ...payload(root), prompt: 'Explain prior decisions' })
    expect(next.decisions).toContain('Use existing architecture')
  })
  it('reconciles active persisted tasks and attempts to interrupted on restart', async () => {
    const root = fixture(), base = adapter('codex', async request => new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(new Error('Canceled')), { once: true })))
    const coordinator = create(root, [base]), task = await coordinator.create({ ...payload(root), providers: ['codex'] })
    await vi.waitFor(() => expect(coordinator.get(task.id).attempts).toHaveLength(1))
    const restored = create(root).get(task.id)
    expect(restored.phase).toBe('interrupted'); expect(restored.attempts[0].status).toBe('failed')
  })
  it('isolates unreadable history without throwing in daemon construction or overwriting it', async () => {
    const root = fixture(); mkdirSync(join(root, 'store')); writeFileSync(join(root, 'store', 'tasks.json'), '{invalid')
    const coordinator = create(root)
    expect(() => coordinator.list()).toThrow('history is unreadable')
    await expect(coordinator.create(payload(root))).rejects.toThrow('history is unreadable')
    expect(readFileSync(join(root, 'store', 'tasks.json'), 'utf8')).toBe('{invalid')
  })
  it('blocks unsupported Autonomous Claude writes but permits truthful restricted-file verification', async () => {
    const root = fixture(), coordinator = create(root, [adapter('claude')])
    const blocked = await coordinator.create({ ...payload(root), providers: ['claude'], permissionMode: 'autonomous' })
    expect((await until(coordinator, blocked.id)).phase).toBe('blocked')
    const scoped = await coordinator.create({ ...payload(root), providers: ['claude'] })
    const done = await until(coordinator, scoped.id)
    expect(done.phase).toBe('completed'); expect(done.messages.at(-1)?.content).toContain('NOT verified')
  })
  it('refuses project writes when an interactive writer already exists', async () => {
    const root = fixture(), coordinator = create(root); coordinator.setExternalWriterCheck(() => true)
    const task = await coordinator.create(payload(root)); const done = await until(coordinator, task.id)
    expect(done.phase).toBe('failed'); expect(done.error).toContain('interactive agent')
    expect(done.attempts.some(v => v.role === 'implementation')).toBe(false)
  })
  it('blocks certification if project fingerprint changes after review', async () => {
    const root = fixture(); let calls = 0
    const coordinator = create(root, [adapter('codex')], async () => ({ ...await context(), fingerprint: ++calls >= 4 ? 'changed-after-review' : 'reviewed' }))
    const task = await coordinator.create({ ...payload(root), providers: ['codex'] })
    expect((await until(coordinator, task.id)).error).toContain('changed after review')
  })
})
