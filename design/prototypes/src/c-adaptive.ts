/**
 * Concept C — Adaptive Intelligence Workspace.
 * The workspace reorganises around the mission's current phase. Planning shows the plan as a
 * structure (steps → likely files → acceptance criteria); building shows the operation stream
 * beside the files it touched; review compares review attempts and their findings; proof is a
 * check × revision matrix; decide is a calm brief of what accepting will do. The phase rail
 * follows the recorded state; you can pin any phase.
 */
import { STAGE_LABEL, passedEvidence, type IntelGraph, type IntelNode } from '../../../packages/ui/src/ops/intel/graph'
import { loadPack, el, renderInspector, fixtureBanner, fmtOffset, fmtDuration, SCENARIO_NAME, PROVIDER_NAME, type LoadedMission } from './shared'

type Phase = 'plan' | 'build' | 'review' | 'proof' | 'decide' | 'answer'
const PHASE_NAME: Record<Phase, string> = { plan: 'Plan', build: 'Build', review: 'Review', proof: 'Proof', decide: 'Decide', answer: 'Answer' }

function phaseOf(g: IntelGraph): Phase {
  const t = g.task
  if (t.intent === 'analyze') return 'answer'
  if (t.status === 'waiting_input' && t.waitReason === 'plan_approval') return 'plan'
  if (t.status === 'waiting_input' || t.status === 'completed') return 'decide'
  if (t.status === 'failed') { const last = t.stages.at(-1); return last?.stage === 'plan' ? 'plan' : last?.stage === 'review' ? 'review' : last?.stage === 'verify' ? 'proof' : 'build' }
  const st = t.stage
  return st === 'plan' ? 'plan' : st === 'implement' || st === 'fix' ? 'build' : st === 'review' ? 'review' : st === 'verify' || st === 'demo' ? 'proof' : 'decide'
}

function phaseState(g: IntelGraph, p: Phase): { word: string; tone: 'done' | 'active' | 'you' | 'stop' | 'idle'; count?: number } {
  const t = g.task
  const st = (names: string[]) => t.stages.filter((s: any) => names.includes(s.stage))
  if (p === 'plan') { const s = st(['plan']); if (t.waitReason === 'plan_approval' && t.status === 'waiting_input') return { word: 'Your approval', tone: 'you' }; return s.length ? { word: s.at(-1)!.status === 'failed' ? 'Failed' : 'Done', tone: s.at(-1)!.status === 'failed' ? 'stop' : 'done' } : { word: 'Not reached', tone: 'idle' } }
  if (p === 'build') { const s = st(['implement', 'fix']); if (!s.length) return { word: 'Not reached', tone: 'idle' }; const last = s.at(-1)!; return { word: last.status === 'failed' ? 'Failed' : last.status === 'running' ? 'Running' : s.length > 1 ? `${s.length} rounds` : 'Done', tone: last.status === 'failed' ? 'stop' : last.status === 'running' ? 'active' : 'done', count: s.length } }
  if (p === 'review') { const s = st(['review']); if (!s.length) return { word: 'Not reached', tone: 'idle' }; const v = t.review?.verdict; return { word: v === 'approve' ? 'Approved' : v === 'changes_requested' ? 'Changes requested' : 'Running', tone: v === 'approve' ? 'done' : v ? 'stop' : 'active', count: s.length } }
  if (p === 'proof') { const s = st(['verify']); if (!s.length) return { word: 'Not reached', tone: 'idle' }; const failed = /failed/.test(s.at(-1)!.note ?? ''); return { word: failed ? 'Check failed' : 'Passed', tone: failed ? 'stop' : 'done' } }
  if (p === 'decide') { const d = g.byId.get('decision'); if (!d || t.waitReason === 'plan_approval') return { word: 'Not reached', tone: 'idle' }; return { word: d.status === 'ok' ? 'Accepted' : d.status === 'blocked' ? 'Blocked' : d.status === 'waiting' ? 'Your decision' : d.status === 'canceled' ? 'Closed' : 'Not reached', tone: d.status === 'ok' ? 'done' : d.status === 'blocked' ? 'stop' : d.status === 'waiting' ? 'you' : 'idle' } }
  return { word: t.answer ? 'Answered' : 'Running', tone: t.answer ? 'done' : 'active' }
}

async function main() {
  const { pack, missions } = await loadPack()
  const root = document.getElementById('app')!
  let m: LoadedMission = missions[0]!
  let g = m.graph
  let phase: Phase = phaseOf(g)
  let pinned = false
  let fileFilter: string | null = null

  const missionPicker = el('select', { id: 'mission', 'aria-label': 'Mission' }, ...missions.map((x, i) => el('option', { value: String(i) }, `${SCENARIO_NAME[x.scenario] ?? x.scenario} — ${x.title}`)))
  const follow = el('button', { class: 'btn btn-quiet', 'aria-pressed': 'true', title: 'Follow the phase the mission is in' }, 'Following the mission')
  const themeBtn = el('button', { class: 'btn btn-quiet', 'aria-label': 'Switch light or dark' }, 'Dark')
  const rail = el('nav', { class: 'rail', 'aria-label': 'Mission phases' })
  const lens = el('section', { class: 'lens', 'aria-live': 'polite' })
  const drawer = el('aside', { class: 'drawer', 'aria-label': 'Evidence', hidden: true })
  const title = el('h1', { class: 'm-title' })
  const sub = el('p', { class: 'm-sub' })

  root.append(fixtureBanner(pack),
    el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('b', {}, 'Hydra'), el('span', { class: 'dim' }, 'C · Adaptive workspace')),
      missionPicker, el('span', { class: 'grow' }), follow, themeBtn),
    el('main', { class: 'work' }, el('div', { class: 'mhead' }, title, sub), rail, lens),
    drawer)

  function transition(fn: () => void) {
    const d = document as any
    if (d.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) d.startViewTransition(fn); else fn()
  }

  function load(i: number) { m = missions[i]!; g = m.graph; if (!pinned) phase = phaseOf(g); fileFilter = null; drawer.hidden = true; render() }

  function render() {
    title.textContent = g.task.title
    sub.replaceChildren(el('span', {}, m.project.name), ' · ', el('span', {}, g.task.intent === 'analyze' ? 'Question' : `Change in ${g.task.mode} mode`), ' · ', el('span', { class: 'mono' }, `${fmtDuration(g.end - g.start)} recorded`), ' · ', el('span', {}, `assigned ${PROVIDER_NAME(g.task.assignment.planner)}`))
    renderRail()
    lens.replaceChildren(lensFor(phase))
    lens.dataset.phase = phase
  }

  function renderRail() {
    rail.replaceChildren()
    const phases: Phase[] = g.task.intent === 'analyze' ? ['answer'] : ['plan', 'build', 'review', 'proof', 'decide']
    const live = phaseOf(g)
    phases.forEach((p, i) => {
      const s = phaseState(g, p)
      rail.append(el('button', { class: `phase t-${s.tone} ${p === phase ? 'on' : ''}`, 'aria-current': p === phase ? 'step' : undefined, onclick: () => { pinned = p !== live; follow.setAttribute('aria-pressed', String(!pinned)); follow.textContent = pinned ? 'Return to the current phase' : 'Following the mission'; transition(() => { phase = p; render() }) } },
        el('span', { class: 'ph-n mono' }, String(i + 1).padStart(2, '0')),
        el('span', { class: 'ph-name' }, PHASE_NAME[p]),
        el('span', { class: 'ph-state' }, s.word),
        p === live ? el('span', { class: 'ph-now' }, 'now') : null))
    })
  }

  function open(id: string) {
    const n = g.byId.get(id) ?? null
    drawer.replaceChildren(el('div', { class: 'drawer-head' }, el('button', { class: 'btn btn-quiet', onclick: () => { drawer.hidden = true } }, 'Close')), renderInspector(g, n, { onSelect: open }))
    drawer.hidden = false
    ;(drawer.querySelector('button') as HTMLButtonElement)?.focus()
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) drawer.hidden = true })

  const nodeBtn = (n: IntelNode, kids: Array<Node | string | null>, cls = '') => el('button', { class: `nb ${cls}`, onclick: () => open(n.id) }, ...kids)

  // ---------- lenses ----------
  function lensFor(p: Phase): HTMLElement {
    if (p === 'answer') return answerLens()
    if (p === 'plan') return planLens()
    if (p === 'build') return buildLens()
    if (p === 'review') return reviewLens()
    if (p === 'proof') return proofLens()
    return decideLens()
  }

  function answerLens() {
    const run = g.nodes.find((n) => n.kind === 'run')
    return el('div', { class: 'l-answer' },
      el('p', { class: 'eyebrow' }, 'Answer'),
      el('div', { class: 'answer prose' }, g.task.answer ?? 'No answer recorded yet.'),
      run ? el('p', { class: 'note' }, `${run.runFacts!.activity.length} files and searches were reported while answering. `, nodeBtn(run, ['See what was read'], 'linky')) : null)
  }

  function planLens() {
    const plan = g.task.plan
    if (!plan) return el('div', { class: 'empty' }, 'The planner has not produced a plan yet.')
    const files = g.nodes.filter((n) => n.kind === 'file' && n.file!.planned)
    const later = g.nodes.filter((n) => n.kind === 'file' && !n.file!.planned && n.file!.edits)
    const review = g.task.review
    const crit = (c: string) => review?.acceptanceCriteriaMet.find((x: any) => x.criterion === c)
    const waiting = g.task.status === 'waiting_input' && g.task.waitReason === 'plan_approval'
    return el('div', { class: 'l-plan' },
      el('p', { class: 'lede' }, plan.summary),
      el('div', { class: 'plan-grid' },
        el('div', { class: 'col' }, el('h2', {}, 'Steps'), el('ol', { class: 'steps' }, ...plan.steps.map((s: string) => el('li', {}, s)))),
        el('div', { class: 'col' }, el('h2', {}, 'Files it expects to touch'),
          el('ul', { class: 'files' }, ...files.map((f) => el('li', {}, nodeBtn(f, [el('span', { class: 'mono' }, f.file!.path), el('span', { class: `tag ${f.file!.edits ? 'tag-done' : 'tag-idle'}` }, f.file!.edits ? `edited ${f.file!.edits}×` : f.file!.reads ? 'read only' : 'not touched yet')])))),
          later.length ? el('p', { class: 'note' }, `Also edited, not in the plan: ${later.map((f) => f.file!.path).join(', ')}`) : null),
        el('div', { class: 'col' }, el('h2', {}, 'Done when'), el('ul', { class: 'criteria' }, ...plan.acceptanceCriteria.map((c: string) => { const r = crit(c); return el('li', { class: r ? (r.met ? 'met' : 'unmet') : '' }, el('span', { class: 'mark-c', 'aria-hidden': 'true' }, r ? (r.met ? '✓' : '✕') : '·'), el('span', {}, c, r ? el('span', { class: 'note' }, ` — reviewer: ${r.met ? 'met' : 'not met'}`) : null)) })))),
      plan.risks.length ? el('div', { class: 'risks' }, el('h2', {}, 'Risks the planner named'), el('ul', {}, ...plan.risks.map((r: string) => el('li', {}, r)))) : null,
      waiting ? el('div', { class: 'yourturn' }, el('p', {}, el('b', {}, 'Your turn. '), 'Safe mode stops here until you approve the plan. Nothing has been changed in your repository.'), el('div', { class: 'actions' }, el('button', { class: 'btn btn-primary' }, 'Approve plan'), el('button', { class: 'btn' }, 'Revise the request')), el('p', { class: 'note' }, 'Prototype: inert controls.')) : null)
  }

  function buildLens() {
    const runs = g.nodes.filter((n) => n.kind === 'run' && (n.stage === 'implement' || n.stage === 'fix'))
    const files = g.nodes.filter((n) => n.kind === 'file').sort((a, b) => (b.file!.edits * 3 + (b.file!.diff ? 5 : 0)) - (a.file!.edits * 3 + (a.file!.diff ? 5 : 0)))
    const stream = el('ol', { class: 'stream' })
    for (const r of runs) {
      stream.append(el('li', { class: 'run-head' }, nodeBtn(r, [el('b', {}, `${STAGE_LABEL[r.stage!]}${r.attempt && r.attempt > 1 ? ' · round ' + r.attempt : ''}`), el('span', { class: 'note' }, ` ${PROVIDER_NAME(r.runFacts!.run.provider)} · ${r.status === 'ok' ? 'finished' : r.status} · ${r.end && r.at ? fmtDuration(r.end - r.at) : ''}`)])))
      for (const a of r.runFacts!.activity) {
        if (fileFilter && a.target !== fileFilter) continue
        stream.append(el('li', { class: `op-row k-${a.kind}` }, el('span', { class: 'mono t' }, fmtOffset(Date.parse(a.at), g.start)), el('span', { class: 'verb' }, a.kind === 'edit' ? 'edited' : a.kind === 'read' ? 'read' : a.kind === 'search' ? 'searched' : a.kind === 'command' ? 'ran' : 'used'), el('code', {}, a.target)))
      }
      if (r.status === 'failed') stream.append(el('li', { class: 'op-row k-fail' }, el('span', { class: 'mono t' }, ''), el('span', { class: 'verb' }, 'failed'), el('span', {}, r.runFacts!.run.error ?? 'The run failed.')))
    }
    if (!runs.length) stream.append(el('li', { class: 'note' }, 'No build run has started.'))
    const grid = el('div', { class: 'tiles' }, ...files.map((f) => {
      const ff = f.file!
      const tot = ff.diff ? ff.diff.additions + ff.diff.deletions : 0
      return el('button', { class: `tile ${ff.diff ? 'changed' : ''} ${fileFilter === ff.path ? 'on' : ''} ${f.basis === 'planned' ? 'planned' : ''}`, onclick: () => { fileFilter = fileFilter === ff.path ? null : ff.path; transition(render) }, ondblclick: () => open(f.id) },
        el('span', { class: 'mono path' }, ff.path),
        el('span', { class: 'counts' }, `${ff.reads} read · ${ff.edits} edit`),
        ff.diff ? el('span', { class: 'bar', 'aria-label': `+${ff.diff.additions} −${ff.diff.deletions}` }, el('i', { class: 'a', style: { width: `${(ff.diff.additions / Math.max(tot, 1)) * 100}%` } }), el('i', { class: 'd', style: { width: `${(ff.diff.deletions / Math.max(tot, 1)) * 100}%` } })) : el('span', { class: 'note' }, f.basis === 'planned' ? 'planned, not touched' : 'not in the final change'),
        ff.findings ? el('span', { class: 'flag' }, `${ff.findings} finding${ff.findings === 1 ? '' : 's'}`) : null)
    }))
    return el('div', { class: 'l-build' },
      el('div', { class: 'col-stream' }, el('h2', {}, fileFilter ? `Operations on ${fileFilter}` : 'Reported operations'), el('p', { class: 'note' }, 'Tool calls as the provider reported them: names and targets only.'), stream),
      el('div', { class: 'col-files' }, el('h2', {}, 'Files'), el('p', { class: 'note' }, 'Select a file to filter the operations; double-click for its diff.'), grid))
  }

  function reviewLens() {
    const reviews = m.raw.reviews
    if (!reviews.length) return el('div', { class: 'empty' }, 'No review has been recorded yet.')
    const findingsOf = (ri: number) => g.nodes.filter((n) => n.kind === 'finding' && n.finding!.review === ri)
    const cols = reviews.map((r, ri) => {
      const later = reviews[ri + 1]
      const list = findingsOf(ri)
      return el('article', { class: `review ${r.review.verdict}` },
        el('header', {}, el('p', { class: 'eyebrow' }, `Review ${ri + 1} of `, el('span', { class: 'mono' }, (r.reviewedSha ?? '').slice(0, 7))), el('h2', {}, r.review.verdict === 'approve' ? 'Approved' : 'Changes requested'), el('p', { class: 'note' }, fmtOffset(Date.parse(r.at), g.start))),
        el('ul', { class: 'findings' }, ...list.map((f) => {
          const again = later ? later.review.findings.some((x: any) => x.issue === f.finding!.issue) : null
          return el('li', { class: `sev-${f.finding!.severity}` }, nodeBtn(f, [el('span', { class: 'sev' }, f.finding!.severity), el('span', { class: 'issue' }, f.label), el('span', { class: 'mono file' }, f.finding!.file ?? ''), later ? el('span', { class: `tag ${again ? 'tag-stop' : 'tag-done'}` }, again ? 'raised again next review' : 'not raised in the next review') : null]))
        }), list.length ? null : el('li', { class: 'note' }, 'No findings.')))
    })
    const crits = [...new Set(reviews.flatMap((r) => r.review.acceptanceCriteriaMet.map((c: any) => c.criterion)))]
    const matrix = el('table', { class: 'matrix' }, el('thead', {}, el('tr', {}, el('th', {}, 'Acceptance criterion'), ...reviews.map((_, i) => el('th', {}, `Review ${i + 1}`)))),
      el('tbody', {}, ...crits.map((c) => el('tr', {}, el('td', {}, c), ...reviews.map((r) => { const x = r.review.acceptanceCriteriaMet.find((y: any) => y.criterion === c); return el('td', { class: x ? (x.met ? 'met' : 'unmet') : '' }, x ? (x.met ? '✓ met' : '✕ not met') : '—') })))))
    return el('div', { class: 'l-review' }, el('div', { class: 'reviews' }, ...cols), el('h2', {}, 'Criteria across reviews'), el('div', { class: 'tablewrap' }, matrix),
      el('p', { class: 'note' }, '"Not raised in the next review" compares finding text between reviews. It is derived; the reviewer does not mark findings resolved.'))
  }

  function proofLens() {
    const revs = g.nodes.filter((n) => n.kind === 'revision').sort((a, b) => a.revision!.index - b.revision!.index)
    const checks = g.nodes.filter((n) => n.kind === 'check')
    const labels = [...new Set(checks.map((c) => c.label))]
    if (!labels.length) return el('div', { class: 'empty' }, 'No checks have run yet.')
    const head = revs.find((r) => r.revision!.role === 'head' || r.revision!.role === 'applied')
    const t = el('table', { class: 'matrix proof' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Check'), ...revs.map((r) => el('th', { class: r === head ? 'head' : '' }, el('span', { class: 'mono' }, r.revision!.short), el('span', { class: 'note' }, r.revision!.role === 'base' ? ' your branch' : r === head ? ' proposed' : ''))))),
      el('tbody', {}, ...labels.map((l) => el('tr', {}, el('td', {}, el('code', {}, l)), ...revs.map((r) => {
        const here = checks.filter((c) => c.label === l && c.evidence!.commitSha.startsWith(r.revision!.short))
        return el('td', { class: r === head ? 'head' : '' }, ...here.map((c) => nodeBtn(c, [passedEvidence(c.evidence!) ? '✓' : '✕', el('span', { class: 'note' }, ` ${c.evidence!.phase === 'demo_base' ? 'original' : c.evidence!.phase === 'pre_review' ? 'pre-review' : 'verify'}`)], `cell ${c.status}`)), here.length ? null : el('span', { class: 'note' }, '—'))
      })))))
    return el('div', { class: 'l-proof' }, el('p', { class: 'lede' }, 'Every result is bound to the exact revision it ran on. Acceptance only counts verify results on the proposed revision.'), el('div', { class: 'tablewrap' }, t))
  }

  function decideLens() {
    const d = g.byId.get('decision')
    const files = g.nodes.filter((n) => n.kind === 'file' && n.file!.diff)
    const head = g.nodes.find((n) => n.kind === 'revision' && (n.revision!.role === 'head' || n.revision!.role === 'applied'))
    const base = g.nodes.find((n) => n.kind === 'revision' && n.revision!.role === 'base')
    const atHead = g.nodes.filter((n) => n.kind === 'check' && head && n.evidence!.commitSha.startsWith(head.revision!.short) && n.evidence!.phase === 'verify')
    const nits = g.task.review?.findings ?? []
    if (!d) return el('div', { class: 'empty' }, g.task.status === 'failed' ? `The mission stopped: ${g.task.error ?? 'a stage failed'}. Nothing was changed in your repository.` : 'The mission has not reached a decision.')
    const status = d.decision!
    return el('div', { class: `l-decide ${d.status}` },
      el('p', { class: 'eyebrow' }, d.status === 'ok' ? 'Delivered' : d.status === 'blocked' ? 'Blocked by Hydra' : 'Your decision'),
      el('h2', { class: 'big' }, d.status === 'ok' ? `Applied ${head?.revision!.short ?? ''} to ${g.task.applied?.targetBranch ?? 'your branch'}` : d.status === 'blocked' ? 'This revision cannot be accepted yet' : `Accept ${head?.revision!.short ?? 'this revision'}?`),
      el('div', { class: 'brief' },
        el('section', {}, el('h3', {}, 'What changes'), files.length ? el('ul', {}, ...files.map((f) => el('li', {}, nodeBtn(f, [el('code', {}, f.file!.path), el('span', { class: 'note' }, ` +${f.file!.diff!.additions} −${f.file!.diff!.deletions}`)], 'linky')))) : el('p', { class: 'note' }, g.gaps.find((x) => /workspace|diff/i.test(x)) ?? 'No file changes.')),
        el('section', {}, el('h3', {}, 'What proves it'), atHead.length ? el('ul', {}, ...atHead.map((c) => el('li', {}, nodeBtn(c, [c.status === 'ok' ? '✓ ' : '✕ ', el('code', {}, c.label), el('span', { class: 'note' }, ` at ${head!.revision!.short}`)], `linky ${c.status}`)))) : el('p', { class: 'note' }, 'No verify results at this revision.')),
        el('section', {}, el('h3', {}, 'What remains'), status.unresolved.length && d.status !== 'ok' ? el('ul', { class: 'unresolved' }, ...status.unresolved.map((u) => el('li', {}, u))) : el('ul', {}, ...nits.map((f: any) => el('li', {}, el('span', { class: 'note' }, f.severity + ': '), f.issue)), nits.length ? null : el('li', { class: 'note' }, 'Nothing open.'))),
        el('section', {}, el('h3', {}, d.status === 'ok' ? 'Receipt' : 'What accepting does'), d.status === 'ok' && status.acceptance ? el('p', {}, `Accepted by ${status.acceptance.actor} from the ${status.acceptance.source}, bound to ${status.acceptance.evidenceIds.length} check results. Receipt `, el('code', {}, status.acceptance.decisionId.slice(0, 8))) : el('p', {}, `Fast-forwards your branch from `, el('code', {}, base?.revision!.short ?? 'base'), ` to `, el('code', {}, head?.revision!.short ?? 'head'), `. Hydra re-checks the same evidence when you click, and refuses if anything changed.`))),
      d.status === 'waiting' || d.status === 'blocked' ? el('div', { class: `actions ${d.status === 'waiting' ? 'yourturn' : ''}` }, el('button', { class: 'btn btn-primary', disabled: d.status === 'blocked' }, 'Accept revision'), el('button', { class: 'btn' }, 'Request changes'), el('button', { class: 'btn btn-quiet' }, 'Reject'), el('span', { class: 'note' }, 'Prototype: inert controls.')) : null)
  }

  // ---------- controls ----------
  missionPicker.addEventListener('change', () => transition(() => load(Number(missionPicker.value))))
  follow.addEventListener('click', () => { pinned = false; follow.setAttribute('aria-pressed', 'true'); follow.textContent = 'Following the mission'; transition(() => { phase = phaseOf(g); render() }) })
  themeBtn.addEventListener('click', () => { const dark = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; themeBtn.textContent = dark ? 'Light' : 'Dark' })
  ;(window as any).hydraProto = { mission: (i: number) => { missionPicker.value = String(i); load(i) }, phase: (p: Phase) => { pinned = true; phase = p; render() }, open, dark: () => themeBtn.click() }
  load(0)
}
Promise.allSettled([document.fonts.load('500 14px "Red Hat Text"'), document.fonts.load('700 20px "Red Hat Display"')]).then(main)
