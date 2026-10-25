/**
 * Shared prototype layer: loads the recorded fixture pack, builds evidence graphs with the
 * product adapter (packages/ui/src/ops/intel/graph.ts), and renders the evidence inspector.
 * Prototype code only; the product implementation lives in packages/ui.
 */
import type { Project, ProviderStatus } from '@hydra/protocol'
import { buildIntel, passedEvidence, STAGE_LABEL, type IntelGraph, type IntelNode, type Basis, type IntelKind } from '../../../packages/ui/src/ops/intel/graph'

export interface FixtureMission { scenario: string; detail: { task: any; runs: any[]; evidence: any[] }; diff: any; reviews: Array<{ at: string; review: any; reviewedSha: string | null }> }
export interface FixturePack { recordedAt: string; source: string; projects: Project[]; providers: ProviderStatus[]; engineVersion: string; missions: FixtureMission[] }
export interface LoadedMission { scenario: string; title: string; project: Project; graph: IntelGraph; raw: FixtureMission }

export const SCENARIO_NAME: Record<string, string> = {
  repair: 'Repair journey', clean: 'Applied change', 'verify-fail': 'Failing check', 'plan-gate': 'Plan approval', failure: 'Execution failure', question: 'Question'
}
export const ORDER = ['repair', 'verify-fail', 'plan-gate', 'clean', 'failure', 'question']

export async function loadPack(): Promise<{ pack: FixturePack; missions: LoadedMission[] }> {
  // data/missions.js carries the same JSON for pages opened straight from disk (file:// blocks fetch).
  const pack: FixturePack = (window as any).__HYDRA_FIXTURES ?? await fetch('data/missions.json').then((r) => r.json())
  const missions = pack.missions.map((m) => {
    const graph = buildIntel({ task: m.detail.task, runs: m.detail.runs, evidence: m.detail.evidence, diff: m.diff, reviews: m.reviews.map((r) => ({ review: r.review, reviewedSha: r.reviewedSha, at: Date.parse(r.at) })), now: Date.parse(pack.recordedAt) })
    return { scenario: m.scenario, title: m.detail.task.title, project: pack.projects.find((p) => p.id === m.detail.task.projectId)!, graph, raw: m }
  })
  missions.sort((a, b) => ORDER.indexOf(a.scenario) - ORDER.indexOf(b.scenario))
  return { pack, missions }
}

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...kids: Array<Node | string | null | undefined | false>): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') node.className = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) node.style.setProperty(sk, String(sv)); else (node.style as any)[sk] = sv } }
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) node.append(kid)
  return node
}

export const fmtDuration = (ms: number) => ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
export const fmtClock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const fmtOffset = (t: number, start: number) => { const s = Math.max(0, (t - start) / 1000); return s < 60 ? `+${s.toFixed(1)}s` : `+${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` }

export const KIND_NAME: Record<IntelKind, string> = { mission: 'Mission', stage: 'Stage', run: 'Agent run', file: 'File', revision: 'Revision', check: 'Engine check', finding: 'Review finding', decision: 'Your decision' }
export const BASIS_TEXT: Record<Basis, string> = { observed: 'Observed', derived: 'Derived', planned: 'Planned', unavailable: 'Unavailable' }
export const BASIS_HELP: Record<Basis, string> = {
  observed: 'Recorded directly by the engine.',
  derived: 'Computed from recorded facts by a stated rule.',
  planned: 'Stated intent from the plan, not an outcome.',
  unavailable: 'Known to exist but not retained in this data.'
}
export const ROLE_NAME: Record<string, string> = { planner: 'Planner', implementer: 'Implementer', reviewer: 'Reviewer', engine: 'Hydra engine', human: 'You' }
export const PROVIDER_NAME = (id: string) => id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex CLI' : id === 'scripted' ? 'Scripted fixture agent' : id
export const statusWord = (n: IntelNode) => {
  if (n.kind === 'check') return n.status === 'ok' ? 'Passed' : n.status === 'running' ? 'Running' : 'Failed'
  if (n.kind === 'finding') return n.finding!.severity[0]!.toUpperCase() + n.finding!.severity.slice(1)
  if (n.kind === 'decision') return n.status === 'blocked' ? 'Blocked' : n.status === 'waiting' ? 'Waiting for you' : n.status === 'ok' ? 'Accepted' : n.status === 'canceled' ? 'Closed' : 'Not reached'
  return { running: 'Running', ok: 'Succeeded', failed: 'Failed', waiting: 'Waiting', blocked: 'Blocked', canceled: 'Canceled', idle: '' }[n.status]
}

/** Neighbours with the edge kind that joins them. */
export function neighbours(g: IntelGraph, id: string) {
  const ins: Array<{ node: IntelNode; kind: string }> = []
  const outs: Array<{ node: IntelNode; kind: string }> = []
  for (const e of g.edges) {
    if (e.to === id && g.byId.has(e.from)) ins.push({ node: g.byId.get(e.from)!, kind: e.kind })
    if (e.from === id && g.byId.has(e.to)) outs.push({ node: g.byId.get(e.to)!, kind: e.kind })
  }
  return { ins, outs }
}

const EDGE_VERB: Record<string, [string, string]> = {
  sequence: ['came after', 'handed off to'], performs: ['ran in', 'ran'], read: ['read by', 'read'], edit: ['edited by', 'edited'],
  produced: ['produced by', 'produced'], parent: ['followed', 'followed by'], tested: ['tested by', 'tested'], reviewed: ['reviewed by', 'reviewed'],
  raised: ['raised by', 'raised'], concerns: ['flagged by', 'concerns'], planned: ['planned in', 'plans to touch'], changed: ['changed in', 'changes'], decides: ['decided by', 'decides on']
}

function diffBlock(patch: string): HTMLElement {
  const pre = el('pre', { class: 'insp-diff', tabindex: '0', 'aria-label': 'Diff' })
  for (const line of patch.split('\n').slice(0, 240)) {
    const cls = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : ''
    pre.append(el('span', { class: cls }, line + '\n'))
  }
  return pre
}

/** The evidence inspector. Every prototype uses it; styling comes from the prototype's CSS. */
export function renderInspector(g: IntelGraph, n: IntelNode | null, opts: { onSelect: (id: string) => void; onFocus?: (id: string) => void }): HTMLElement {
  if (!n) {
    const t = g.task
    return el('div', { class: 'insp insp-empty' },
      el('p', { class: 'insp-eyebrow' }, 'Mission'),
      el('h2', { class: 'insp-title' }, t.title),
      el('p', { class: 'insp-prompt' }, t.prompt),
      el('p', { class: 'insp-hint' }, 'Select anything on the map to see the record behind it. Keyboard: Tab to the map, arrow keys to move, Enter to inspect, F to focus, Esc to step back.'),
      g.gaps.length ? el('div', { class: 'insp-gaps' }, el('p', { class: 'insp-eyebrow' }, 'Not in this data'), ...g.gaps.map((x) => el('p', {}, x))) : null)
  }
  const head = el('header', { class: 'insp-head' },
    el('p', { class: 'insp-eyebrow' }, `${KIND_NAME[n.kind]}${n.actor ? ' · ' + ROLE_NAME[n.actor] : ''}`),
    el('h2', { class: 'insp-title' }, n.kind === 'file' ? n.file!.path : n.label),
    el('div', { class: 'insp-tags' },
      statusWord(n) ? el('span', { class: `insp-status s-${n.status}` }, statusWord(n)) : null,
      el('span', { class: `insp-basis b-${n.basis}`, title: BASIS_HELP[n.basis] }, BASIS_TEXT[n.basis]),
      n.at !== null ? el('span', { class: 'insp-time' }, fmtOffset(n.at, g.start)) : null,
      n.end !== null && n.at !== null ? el('span', { class: 'insp-time' }, fmtDuration(n.end - n.at)) : null))
  const body = el('div', { class: 'insp-body' })
  const facts = (rows: Array<[string, string | Node]>) => el('dl', { class: 'insp-facts' }, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))

  if (n.kind === 'run') {
    const f = n.runFacts!
    body.append(facts([['Provider', PROVIDER_NAME(f.run.provider)], ['Stage', `${STAGE_LABEL[f.run.stage as keyof typeof STAGE_LABEL]}${n.attempt && n.attempt > 1 ? ` · attempt ${n.attempt}` : ''}`], ['Reported calls', `${f.reads} read · ${f.edits} edit · ${f.searches} search · ${f.commands.length} command`], ['Tokens', `${(f.run.usage.inputTokens + f.run.usage.outputTokens).toLocaleString()}${f.run.usage.costUsd ? ` · $${f.run.usage.costUsd.toFixed(3)}` : ' · unpriced'}`]]))
    const list = el('ol', { class: 'insp-ops' })
    for (const a of f.activity) list.append(el('li', {}, el('span', { class: `op op-${a.kind}` }, a.tool), ' ', el('code', {}, a.target), el('span', { class: 'insp-dim' }, ' ' + fmtOffset(Date.parse(a.at), g.start))))
    body.append(el('h3', {}, 'Reported tool calls'), f.activity.length ? list : el('p', { class: 'insp-dim' }, 'No tool calls were reported for this run.'))
    body.append(el('p', { class: 'insp-note' }, 'Tool calls are what the provider CLI reported: names and targets only. Hydra never records file contents or model reasoning.'))
  }
  if (n.kind === 'file') {
    const f = n.file!
    body.append(facts([['Planned', f.planned ? 'Named in the plan' : 'Not named in the plan'], ['Reported', `${f.reads} read · ${f.edits} edit`], ['Touched by', f.touchedBy.map((r) => ROLE_NAME[r]).join(', ') || 'No agent reported touching it'], ['In final change', f.diff ? `${f.diff.status} · +${f.diff.additions} −${f.diff.deletions}` : 'Not in the final diff'], ['Findings', String(f.findings)]]))
    if (f.diff?.patch) body.append(el('h3', {}, 'Change against your branch'), diffBlock(f.diff.patch))
  }
  if (n.kind === 'check') {
    const e = n.evidence!
    body.append(facts([['Command', el('code', {}, e.argv.join(' '))], ['Revision', el('code', {}, e.commitSha.slice(0, 10))], ['When', n.detail], ['Exit', e.spawnError ? `Could not start: ${e.spawnError}` : e.timedOut ? 'Timed out' : String(e.exitCode)], ['Duration', fmtDuration(e.durationMs)], ['Output', `${e.outputBytes.toLocaleString()} bytes${e.outputTruncated ? ' · truncated' : ''} · sha256 ${e.outputSha256.slice(0, 12)}`]]))
    if (e.treeMutated) body.append(el('p', { class: 'insp-warn' }, 'The check modified tracked files, so Hydra treats this result as untrustworthy.'))
    body.append(el('h3', {}, passedEvidence(e) ? 'Output (tail)' : 'Why it failed (output tail)'), el('pre', { class: 'insp-log', tabindex: '0' }, e.outputTail.split('\n').slice(-40).join('\n') || '(no output)'))
  }
  if (n.kind === 'finding') {
    const f = n.finding!
    body.append(el('p', { class: 'insp-lead' }, f.issue), facts([['Suggestion', f.suggestion || '—'], ['File', f.file ?? 'No file named'], ['Review', `Review ${f.review + 1}${f.reviewedSha ? ` of ${f.reviewedSha.slice(0, 7)}` : ''}`]]))
  }
  if (n.kind === 'revision') {
    const r = n.revision!
    const checks = g.nodes.filter((x) => x.kind === 'check' && x.evidence!.commitSha.startsWith(r.short))
    body.append(facts([['Commit', el('code', {}, r.sha)], ['Role', n.detail], ['Checks on it', checks.length ? `${checks.filter((c) => c.status === 'ok').length} passed · ${checks.filter((c) => c.status === 'failed').length} failed` : 'None ran on this revision']]))
    body.append(el('p', { class: 'insp-note' }, 'Revisions are listed in the order they appeared in records. Git ancestry is not part of this data, so the chain between them is derived.'))
  }
  if (n.kind === 'stage') {
    body.append(facts([['Note', n.detail || '—'], ['Status', n.stageRecord!.status]]))
  }
  if (n.kind === 'decision') {
    const d = n.decision!
    if (d.acceptance) body.append(facts([['Accepted revision', el('code', {}, d.acceptance.revision.slice(0, 10))], ['By', `${d.acceptance.actor} · ${d.acceptance.source}`], ['Evidence bound', `${d.acceptance.evidenceIds.length} check results`], ['Receipt', el('code', {}, d.acceptance.decisionId)]]))
    else if (d.waiting === 'final_approval') {
      body.append(el('p', { class: 'insp-lead' }, d.allowed ? 'Checks and review cover this exact revision. Accepting fast-forwards your branch to it.' : 'Hydra will refuse acceptance until these are resolved:'))
      if (!d.allowed) body.append(el('ul', { class: 'insp-unresolved' }, ...d.unresolved.map((u) => el('li', {}, u))))
      body.append(el('div', { class: 'insp-actions' }, el('button', { class: 'btn btn-primary', disabled: !d.allowed, title: d.allowed ? '' : 'Blocked by the engine policy' }, 'Accept revision'), el('button', { class: 'btn' }, 'Request changes'), el('button', { class: 'btn btn-quiet' }, 'Reject')), el('p', { class: 'insp-note' }, 'Prototype: decision buttons are inert. In Hydra they send the existing engine command, which re-checks the same policy.'))
    } else if (d.waiting === 'plan_approval') {
      const plan = g.task.plan
      if (plan) body.append(el('p', { class: 'insp-lead' }, plan.summary), el('h3', {}, 'Steps'), el('ol', { class: 'insp-list' }, ...plan.steps.map((s: string) => el('li', {}, s))), el('h3', {}, 'Risks'), el('ul', { class: 'insp-list' }, ...plan.risks.map((s: string) => el('li', {}, s))))
      body.append(el('div', { class: 'insp-actions' }, el('button', { class: 'btn btn-primary' }, 'Approve plan'), el('button', { class: 'btn' }, 'Revise')), el('p', { class: 'insp-note' }, 'Prototype: inert controls.'))
    } else body.append(el('p', {}, 'No decision has been requested yet.'))
  }
  if (n.kind === 'mission') body.append(el('p', { class: 'insp-prompt' }, g.task.prompt))

  const { ins, outs } = neighbours(g, n.id)
  if (ins.length || outs.length) {
    const rel = el('ul', { class: 'insp-rel' })
    for (const { node, kind } of ins) rel.append(el('li', {}, el('span', { class: 'insp-dim' }, (EDGE_VERB[kind]?.[0] ?? kind) + ' '), el('button', { class: 'linkish', onclick: () => opts.onSelect(node.id) }, node.kind === 'file' ? node.file!.path : node.label)))
    for (const { node, kind } of outs) rel.append(el('li', {}, el('span', { class: 'insp-dim' }, (EDGE_VERB[kind]?.[1] ?? kind) + ' '), el('button', { class: 'linkish', onclick: () => opts.onSelect(node.id) }, node.kind === 'file' ? node.file!.path : node.label)))
    body.append(el('h3', {}, 'Connections'), rel)
  }
  return el('div', { class: 'insp' }, head, body)
}

export function fixtureBanner(pack: FixturePack): HTMLElement {
  return el('div', { class: 'fixture-banner', role: 'note' }, el('b', {}, 'Recorded fixture'), ` · real Hydra engine at commit ${String((pack as any).engineCommit ?? "unknown").slice(0, 7)} (alpha.6 line), Git worktrees and check processes · agents are the scripted test adapter, so tool calls and review text are scripted, not model activity · recorded ${new Date(pack.recordedAt).toLocaleString()}`)
}

/** Deterministic PRNG for layouts and the labelled density simulation. */
export function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } }
