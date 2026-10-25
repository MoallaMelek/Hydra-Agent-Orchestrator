/**
 * Plain-English explanations for anything you can select on a map (mission or project lens).
 *
 * Every sentence is built from the selected record and its recorded neighbours: what kind of
 * thing it is, what the records say happened to it, and why that matters for your decision.
 * Nothing here guesses at intent or invents activity; when a fact is missing, the text says so.
 */
import type { TaskStage } from '@hydra/protocol'
import { passedEvidence, STAGE_LABEL, type IntelGraph, type IntelNode } from './graph'
import { fmtDuration, fmtOffset, providerName, ROLE_NAME } from './text'

export interface Explanation {
  /** What this kind of thing is, in general. */
  what: string
  /** What the records say about this one. */
  here: string[]
  /** Why it matters, or what you can do with it. */
  next: string | null
}

export type ExplainLens = 'mission' | 'project'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const short = (s: string, max = 90) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t }
const role = (r: string | null | undefined) => (r && ROLE_NAME[r]) || 'An agent'
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const list = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
/** Quotes text and ends the sentence once, whatever punctuation the text ends with. */
const quote = (s: string, max: number) => { const t = short(s, max); return /[.!?…]$/.test(t) ? `"${t}"` : `"${t}."` }
const OWN_ACCOUNT = new Set(['claude', 'codex'])

const STAGE_WHAT: Record<TaskStage, string> = {
  plan: 'The planning step. An agent reads your project and writes down what it intends to change, before any code is written.',
  implement: 'The building step. An agent writes the change in a separate copy of your project (a Git worktree), so your own files stay untouched.',
  review: 'The review step. A second agent reads the change, compares it with what you asked for, and reports problems as findings.',
  fix: 'A repair step. The building agent goes back to fix what the review or the checks found.',
  verify: 'The checking step. Hydra itself runs your project\'s own commands (tests, build, lint) on the exact code, instead of trusting an agent that says "it works".',
  demo: 'The before-and-after step. Hydra runs the same checks on your original code and on the result, so you can see what got better or worse.',
  approval: 'The decision step. The mission stops here and waits for you.',
  apply: 'The delivery step. After you accept, Hydra moves your branch forward to the accepted revision.'
}

const STAGE_WHY: Record<TaskStage, string> = {
  plan: 'Read the plan to see what the agents intend to do. In Safe mode, and for any change Hydra rates as high risk, nothing is built until you approve the plan.',
  implement: 'Click the files and the run on this stage to see exactly what was read and edited.',
  review: 'Findings from this step go back to the building agent for a repair round when the review asks for changes.',
  fix: 'Repairs are limited to a set number of rounds, so a mission cannot loop forever.',
  verify: 'These results are the evidence behind your decision. Failed checks are listed when you decide.',
  demo: 'Look for checks that went from passing to failing: those are regressions the change introduced.',
  approval: 'Nothing reaches your project until you decide here.',
  apply: 'A recorded apply can usually be rolled back with a revert commit, depending on what happened to your branch since.'
}

const ROLE_JOB: Record<string, string> = {
  planner: 'reads the project and writes the plan',
  implementer: 'writes the code and fixes what reviews and checks find',
  reviewer: 'reads the change and reports problems it finds'
}

const SEVERITY: Record<string, string> = {
  blocker: 'a blocker: the reviewer thinks this must be fixed before the change can be accepted',
  major: 'major: an important problem the reviewer thinks should be fixed',
  minor: 'minor: a small problem worth fixing but not serious',
  nit: 'a nit: a small style or polish remark'
}

const CHECK_KIND: Array<[RegExp, string]> = [
  [/\b(pytest|unittest|jest|vitest|mocha|go test|cargo test|ctest|mvn test|gradle test|npm (run )?test|test)\b/i, 'runs your tests'],
  [/\b(lint|eslint|ruff|flake8|clippy|golangci)\b/i, 'checks code style and common mistakes (lint)'],
  [/\b(tsc|typecheck|mypy|pyright)\b/i, 'checks types'],
  [/\b(build|compile|cargo build|go build|make|cmake|mvn|gradle)\b/i, 'builds your project']
]

const PHASE: Record<string, string> = {
  pre_review: 'before the review, so the reviewer could read real results',
  verify: 'to verify the change',
  demo_base: 'on your original code, as the "before" side of the before-and-after comparison',
  demo_final: 'on the final result, as the "after" side of the before-and-after comparison'
}

function checkDoes(label: string, argv: string[]): string {
  const text = `${label} ${argv.join(' ')}`
  return CHECK_KIND.find(([re]) => re.test(text))?.[1] ?? 'runs a command your project defines'
}

function outcomeSentence(n: IntelNode, g: IntelGraph): string {
  const t = g.task
  if (!t) return ''
  if (t.status === 'running' || t.status === 'queued') return 'It is still running.'
  if (t.status === 'waiting_input') return t.waitReason === 'plan_approval' ? 'It is waiting for you to approve the plan.' : 'It is waiting for your decision.'
  if (t.status === 'paused') return 'It is paused.'
  if (t.status === 'failed') return 'It stopped with an error before finishing.'
  if (t.status === 'canceled') return 'It was canceled.'
  switch (t.outcome) {
    case 'applied': return 'The result was applied to your branch.'
    case 'kept_branch': return 'It closed with the work kept on its own branch. Your project was not changed.'
    case 'discarded': return 'The work was discarded. Your project was not changed.'
    case 'rolled_back': return 'The result was applied and later rolled back.'
    case 'answered': return 'It was answered.'
    default: return n.status === 'ok' ? 'It finished.' : ''
  }
}

function explainMission(n: IntelNode, g: IntelGraph, lens: ExplainLens): Explanation {
  const what = 'A mission is one request you gave Hydra, and everything the agents and Hydra did to answer it.'
  if (lens === 'project') {
    const files = g.edges.filter((e) => e.from === n.id)
    const edits = files.filter((e) => e.kind === 'edit').length, reads = files.filter((e) => e.kind === 'read').length, planned = files.filter((e) => e.kind === 'planned').length
    const here = [`You asked: ${quote(n.detail || n.label, 140)}`]
    const parts = [edits ? `edited ${plural(edits, 'file')}` : '', reads ? `read ${plural(reads, 'file')}` : '', planned ? `planned to touch ${plural(planned, 'file')}` : ''].filter(Boolean)
    if (parts.length) here.push(`On this map it ${parts.join(', ')}. Lines join missions that touched the same files.`)
    here.push(n.status === 'running' ? 'It is still running.' : n.status === 'waiting' ? 'It is waiting for your decision.' : n.status === 'failed' ? 'It stopped with an error.' : n.status === 'ok' ? 'It has finished.' : 'It was closed.')
    return { what, here, next: 'Open it to see every step, check and decision on its own map.' }
  }
  const t = g.task
  const runs = g.nodes.filter((x) => x.kind === 'run').length, revisions = g.nodes.filter((x) => x.kind === 'revision' && x.revision!.role !== 'base').length, checks = g.nodes.filter((x) => x.kind === 'check').length
  const here = [`You asked: ${quote(t.prompt, 140)}`]
  const span = g.end > g.start ? ` over ${fmtDuration(g.end - g.start)}` : ''
  here.push(`${g.live ? 'So far there' : 'There'} ${runs === 1 ? 'was' : 'were'} ${plural(runs, 'agent run')}${span}, ${plural(revisions, 'new revision')} and ${plural(checks, 'check')} run by Hydra.`)
  const out = outcomeSentence(n, g); if (out) here.push(out)
  return { what, here, next: 'Click any dot on the map to see what that step did. The briefing (click empty space) sums up the whole mission.' }
}

function explainStage(n: IntelNode, g: IntelGraph): Explanation {
  const s = n.stage!
  const here: string[] = []
  const when = n.at !== null ? ` at ${fmtOffset(n.at, g.start)}` : ''
  const took = n.at !== null && n.end !== null ? `, taking ${fmtDuration(n.end - n.at)}` : ''
  const word = n.status === 'running' ? 'is running' : n.status === 'failed' ? 'failed' : n.status === 'ok' ? 'succeeded' : n.status === 'waiting' ? 'is waiting' : n.status === 'canceled' ? 'was canceled' : 'has not finished'
  here.push(`This ${lower(STAGE_LABEL[s])} step started${when} and ${word}${took}.`)
  if (n.attempt && n.attempt > 1) here.push(`It is attempt ${n.attempt}: an earlier ${lower(STAGE_LABEL[s])} step came before it, so something needed another pass.`)
  const runs = g.edges.filter((e) => e.kind === 'performs' && e.from === n.id).map((e) => g.byId.get(e.to)).filter((r): r is IntelNode => Boolean(r))
  if (runs.length) here.push(`It was done by ${list(runs.map((r) => `${role(r.actor)} on ${providerName(r.runFacts!.run.provider)}`))}.`)
  if (n.detail) here.push(`Hydra's note: ${quote(n.detail, 160)}`)
  return { what: STAGE_WHAT[s], here, next: STAGE_WHY[s] }
}

function explainAgent(n: IntelNode): Explanation {
  const a = n.agent!
  const job = ROLE_JOB[a.role] ?? 'does one job in the mission'
  const here = [`Here the ${ROLE_NAME[a.role] ?? a.role} role was played by ${providerName(a.provider)}${OWN_ACCOUNT.has(a.provider) ? ', signed in with your own account' : ''}.`]
  const made = [a.revisions ? `produced ${plural(a.revisions, 'revision')}` : '', a.findings ? `raised ${plural(a.findings, 'finding')}` : ''].filter(Boolean)
  here.push(`It ran ${plural(a.runs.length, 'time')} and reported ${plural(a.toolCalls, 'tool call')}, ${a.edits ? `including ${plural(a.edits, 'edit')}` : 'none of them edits'}.`)
  if (made.length) here.push(`It ${list(made)}.`)
  here.push(`It was active for ${fmtDuration(a.activeMs)} in total.`)
  return { what: `An agent is an AI coding tool doing one job in this mission. The ${ROLE_NAME[a.role] ?? a.role} ${job}.`, here, next: 'Agents never talk to each other directly. Hydra hands each run the result of the step before (the plan, a revision, review findings), shown as arrows on the map.' }
}

function explainRun(n: IntelNode, g: IntelGraph): Explanation {
  const f = n.runFacts!, r = f.run
  const stage = `${lower(STAGE_LABEL[r.stage])}${n.attempt && n.attempt > 1 ? ` (attempt ${n.attempt})` : ''}`
  const took = n.at !== null && n.end !== null ? ` for ${fmtDuration(n.end - n.at)}` : n.status === 'running' ? ', and is still working' : ''
  const here = [`${role(r.role)} on ${providerName(r.provider)} worked on the ${stage} step${took}.`]
  here.push(`It reported ${plural(f.reads, 'file read')}, ${plural(f.edits, 'edit')}, ${plural(f.searches, 'search', 'searches')} and ${plural(f.commands.length, 'command')}.`)
  const got = g.edges.filter((e) => e.kind === 'handoff' && e.to === n.id), gave = g.edges.filter((e) => e.kind === 'handoff' && e.from === n.id)
  for (const e of got) here.push(`It started from ${e.label} handed over by ${role(g.byId.get(e.from)?.actor)}.`)
  for (const e of gave) here.push(`It handed ${e.label} to ${role(g.byId.get(e.to)?.actor)}.`)
  if (r.error) here.push(`It ended with an error: ${quote(r.error, 160)}`)
  return { what: 'An agent run is one session of an AI tool working on a single step. Each run is a separate program that starts, works, and stops.', here, next: 'The list below shows every tool call it reported, in order. Hydra sees what the tool did (files read, edits, commands), not the model\'s private reasoning.' }
}

function explainFile(n: IntelNode, g: IntelGraph, lens: ExplainLens): Explanation {
  const f = n.file!
  const what = 'A file in your project that this work planned to change, read, or changed.'
  if (lens === 'project') {
    const here = [`${f.path} is linked to ${plural(f.edits, 'mission')} that edited it and ${plural(f.reads, 'mission')} that only read it.`]
    if (n.basis === 'planned') here.push('So far it only appears in a plan: no recorded run has touched it yet.')
    return { what: 'A file in this project. Lines join it to the missions that touched it.', here, next: 'A file shared by several missions is where their changes could overlap. Open a mission to see what it did to this file.' }
  }
  const here: string[] = []
  here.push(f.planned ? 'The plan named this file as one it would likely touch.' : 'The plan did not name this file.')
  const who = f.touchedBy.map((r) => ROLE_NAME[r] ?? r)
  if (f.edits || f.reads) here.push(`Agents reported ${plural(f.reads, 'read')} and ${plural(f.edits, 'edit')}${who.length ? ` (by ${list(who)})` : ''}.`)
  else here.push('No agent reported reading or editing it.')
  if (f.diff) here.push(`In the final change it is ${f.diff.status}: ${plural(f.diff.additions, 'line')} added and ${plural(f.diff.deletions, 'line')} removed.`)
  if (f.findings) here.push(`The reviewer raised ${plural(f.findings, 'finding')} about it.`)
  const removed = Boolean(g.task?.workspace?.removed)
  const next = f.diff ? 'The diff below is exactly what would change in this file if you accept.'
    : f.edits ? (removed ? 'The separate copy of the project was removed after the mission, so the line-by-line diff is no longer available. The reported edits remain.' : 'Its line-by-line diff appears here once Hydra has the final change.')
    : 'It was only read or planned, so it stays faint on the map.'
  return { what, here, next }
}

function explainRevision(n: IntelNode, g: IntelGraph): Explanation {
  const r = n.revision!
  const built = g.edges.some((e) => e.kind === 'produced' && e.to === n.id) || g.nodes.some((x) => x.kind === 'stage' && (x.stage === 'implement' || x.stage === 'fix'))
  const kindLine = r.role === 'head' && !built ? 'No agent has changed the code yet, so this is still your starting point.'
    : r.role === 'base' ? 'This is your starting point: your code as it was when the mission began.'
    : r.role === 'head' ? 'This is the latest version the agents produced. It is the one your decision is about.'
    : r.role === 'applied' ? 'This is the version that was applied to your branch.'
    : 'This is an in-between version an agent produced during the mission.'
  const here = [kindLine]
  const by = g.edges.find((e) => e.kind === 'produced' && e.to === n.id), byRun = by ? g.byId.get(by.from) : undefined
  if (byRun) here.push(`It was produced by ${role(byRun.actor)} during ${lower(STAGE_LABEL[byRun.runFacts!.run.stage])}.`)
  const checks = g.nodes.filter((x) => x.kind === 'check' && x.evidence!.commitSha.startsWith(r.short))
  const passed = checks.filter((c) => c.status === 'ok').length, failed = checks.filter((c) => c.status === 'failed').length
  here.push(checks.length ? `Hydra ran ${plural(checks.length, 'check')} on it: ${passed} passed and ${failed} failed.` : 'Hydra ran no checks on this exact version.')
  if (checks.length && checks.every((c) => c.evidence!.phase === 'demo_base')) here.push('These are the "before" results: they show which problems were already there before the mission changed anything.')
  const reviewed = g.edges.filter((e) => e.kind === 'reviewed' && e.to === n.id).length
  if (reviewed) here.push(`A reviewer read it ${plural(reviewed, 'time')}.`)
  return { what: `A revision is a saved snapshot of the code (a Git commit, here ${r.short}) at one moment in the mission.`, here, next: 'Comparing revisions from left to right shows how the work changed after each review and repair.' }
}

function explainCheck(n: IntelNode): Explanation {
  const e = n.evidence!
  const cmd = short(e.argv.join(' '), 80)
  const here = [`Hydra ran \`${cmd}\` on revision ${e.commitSha.slice(0, 7)}${PHASE[e.phase] ? ` ${PHASE[e.phase]}` : ''}. This command ${checkDoes(e.label, e.argv)}.`]
  if (e.spawnError) here.push(`It could not start: ${short(e.spawnError, 120)}. Usually that means a tool the command needs is not installed.`)
  else if (e.timedOut) here.push(`It ran out of time after ${fmtDuration(e.durationMs)} and was stopped, so it counts as failed.`)
  else if (e.exitCode === 0) here.push(`It passed: the command finished with exit code 0 in ${fmtDuration(e.durationMs)}.`)
  else here.push(`It failed: the command finished with exit code ${e.exitCode} after ${fmtDuration(e.durationMs)}. Any code other than 0 means the command reported a problem.`)
  if (e.treeMutated) here.push('It also changed tracked files while running, so Hydra does not trust this result as evidence.')
  if (!e.required) here.push('This check is marked optional.')
  const next = passedEvidence(e)
    ? 'A pass is real evidence that this command succeeded on this exact code. It does not prove the change is correct.'
    : e.spawnError ? 'Fix the missing tool or edit the command in the project\'s checks, then run the mission again.'
    : 'The output below shows what went wrong. Failed checks are listed when you decide, so you see them before accepting anything.'
  return { what: 'A check is a command Hydra itself runs on the code, such as your tests, build or linter. The result comes from the real exit code, not from what an agent says.', here, next }
}

function explainFinding(n: IntelNode, g: IntelGraph): Explanation {
  const f = n.finding!
  const here = [`The reviewer rated it ${SEVERITY[f.severity] ?? f.severity}.`]
  here.push(`It comes from review ${f.review + 1}${f.reviewedSha ? ` of revision ${f.reviewedSha.slice(0, 7)}` : ''}${f.file ? ` and is about ${f.file}` : ''}.`)
  const fixedLater = g.nodes.some((x) => x.kind === 'stage' && x.stage === 'fix' && x.at !== null && n.at !== null && x.at > n.at)
  if (fixedLater) here.push('A repair step ran after this review, so the building agent was given this finding to work on.')
  return { what: 'A finding is a problem the reviewer agent reported after reading the change.', here, next: 'A finding is the reviewer\'s opinion, not proof. Check it against the code and the check results before you decide.' }
}

function explainDecision(n: IntelNode, g: IntelGraph): Explanation {
  const d = n.decision!
  const what = 'This is your decision point. Nothing reaches your project until you accept a specific revision here.'
  const here: string[] = []
  if (d.acceptance) here.push(`You accepted revision ${d.acceptance.revision.slice(0, 7)}. The receipt records the ${plural(d.acceptance.evidenceIds.length, 'check result')} it was bound to.`)
  else if (d.waiting === 'plan_approval') here.push('The plan is ready and nothing has been built yet. Approving it lets the agents start.')
  else if (d.waiting === 'final_approval') here.push(d.allowed ? 'Checks and review cover the latest revision. Accepting moves your branch forward to it.' : `Hydra will not let you accept yet: ${plural(d.unresolved.length, 'problem')} still need${d.unresolved.length === 1 ? 's' : ''} attention (listed below).`)
  else if (d.outcome) here.push(outcomeSentence(n, g) || `It closed: ${d.outcome.replace('_', ' ')}.`)
  else here.push('The mission has not reached a decision yet.')
  const next = d.acceptance || d.outcome ? null
    : d.waiting === 'plan_approval' ? 'Approve plan & checks lets the implementer edit files in the separate copy and lets Hydra run the listed check commands. Reject ends the mission and discards that copy.'
    : d.waiting === 'final_approval' ? 'Accept moves your branch forward to this revision. Request changes sends your note to the implementer, then the change is reviewed and checked again. Reject discards the work. Keep branch keeps it on its own branch without changing your project.'
    : null
  return { what, here, next }
}

/** Explains a selected node in plain English, from its records only. */
export function explainNode(n: IntelNode, g: IntelGraph, lens: ExplainLens = 'mission'): Explanation {
  switch (n.kind) {
    case 'mission': return explainMission(n, g, lens)
    case 'stage': return explainStage(n, g)
    case 'agent': return explainAgent(n)
    case 'run': return explainRun(n, g)
    case 'file': return explainFile(n, g, lens)
    case 'revision': return explainRevision(n, g)
    case 'check': return explainCheck(n)
    case 'finding': return explainFinding(n, g)
    case 'decision': return explainDecision(n, g)
  }
}

const tail = (s: string, lines: number, chars: number) => { const t = s.split('\n').slice(-lines).join('\n'); return t.length > chars ? t.slice(-chars) : t }

/** The raw record behind a node, as text for the explaining agent (data, never instructions). */
export function factsFor(n: IntelNode, g: IntelGraph, lens: ExplainLens = 'mission'): string {
  const out: string[] = []
  const t = g.task
  if (t) {
    out.push(`Mission: ${t.title}`, `The developer asked: ${short(t.prompt, 1500)}`)
    if (t.plan?.summary) out.push(`Plan summary: ${short(t.plan.summary, 1200)}`)
  }
  out.push(`Selected: ${n.kind} "${short(n.label, 200)}"; status ${n.status}; known as ${n.basis}.`)
  if (n.at !== null && g.start) out.push(`Recorded at ${fmtOffset(n.at, g.start)} into the mission${n.end !== null ? `, lasting ${fmtDuration(n.end - n.at)}` : ''}.`)
  switch (n.kind) {
    case 'check': {
      const e = n.evidence!
      out.push(`Command: ${e.argv.join(' ')} (in ${e.cwd || '.'})`, `Phase: ${e.phase}; revision ${e.commitSha.slice(0, 7)}; required: ${e.required}`)
      out.push(e.spawnError ? `Could not start: ${e.spawnError}` : e.timedOut ? 'Timed out' : `Exit code: ${e.exitCode}`)
      if (e.treeMutated) out.push('The check modified tracked files while running.')
      out.push('Output (last lines):', tail(e.outputTail, 80, 6000) || '(no output)')
      break
    }
    case 'finding': {
      const f = n.finding!
      out.push(`Severity: ${f.severity}`, `Issue: ${short(f.issue, 2000)}`, `Suggestion: ${short(f.suggestion || '-', 1500)}`, `File: ${f.file ?? 'none named'}`, `From review ${f.review + 1}${f.reviewedSha ? ` of revision ${f.reviewedSha.slice(0, 7)}` : ''}`)
      break
    }
    case 'run': {
      const f = n.runFacts!, r = f.run
      out.push(`Role: ${r.role} on ${providerName(r.provider)}; stage ${r.stage}${n.attempt && n.attempt > 1 ? ` attempt ${n.attempt}` : ''}; run status ${r.status}`)
      if (r.error) out.push(`Error: ${short(r.error, 800)}`)
      for (const e of g.edges.filter((x) => x.kind === 'handoff' && (x.to === n.id || x.from === n.id))) out.push(e.to === n.id ? `Received ${e.label} from ${g.byId.get(e.from)?.label ?? 'an earlier run'}` : `Handed ${e.label} to ${g.byId.get(e.to)?.label ?? 'a later run'}`)
      out.push('Reported tool calls (tool, target):', ...f.activity.slice(0, 60).map((a) => `${a.kind} ${a.tool} ${short(a.target, 200)}`))
      if (f.activity.length > 60) out.push(`… ${f.activity.length - 60} more`)
      break
    }
    case 'file': {
      const f = n.file!
      out.push(`Path: ${f.path}`, `Named in plan: ${f.planned}`, lens === 'project' ? `Missions that edited it: ${f.edits}; missions that only read it: ${f.reads}` : `Reported reads: ${f.reads}; edits: ${f.edits}; by: ${f.touchedBy.join(', ') || 'nobody'}`)
      if (f.diff) out.push(`In the final change: ${f.diff.status}, +${f.diff.additions} −${f.diff.deletions}`, 'Diff:', tail(f.diff.patch, 160, 5000))
      for (const x of g.nodes.filter((x) => x.kind === 'finding' && x.finding!.file === f.path).slice(0, 5)) out.push(`Review finding about it (${x.finding!.severity}): ${short(x.finding!.issue, 400)}`)
      if (lens === 'project') out.push('Missions linked to it:', ...g.edges.filter((e) => e.to === n.id).map((e) => `${e.kind}: ${g.byId.get(e.from)?.label ?? e.from}`))
      break
    }
    case 'revision': {
      const r = n.revision!
      out.push(`Commit: ${r.sha}; role: ${r.role}`)
      for (const c of g.nodes.filter((x) => x.kind === 'check' && x.evidence!.commitSha.startsWith(r.short))) out.push(`Check on it: ${c.evidence!.argv.join(' ')} (${c.evidence!.phase}) → ${passedEvidence(c.evidence!) ? 'passed' : 'failed'}`)
      break
    }
    case 'stage': out.push(`Stage: ${n.stage}; attempt ${n.attempt ?? 1}; note: ${n.detail || '-'}`); break
    case 'agent': { const a = n.agent!; out.push(`Role ${a.role} on ${providerName(a.provider)}; runs: ${a.runs.map((id) => g.byId.get(id)?.label ?? id).join(', ')}; ${a.toolCalls} tool calls, ${a.edits} edits, ${a.revisions} revisions, ${a.findings} findings`); break }
    case 'decision': { const d = n.decision!; out.push(`Waiting for: ${d.waiting ?? 'nothing'}; outcome: ${d.outcome ?? 'none'}; acceptance allowed: ${d.allowed}`, ...d.unresolved.map((u) => `Unresolved: ${u}`)); break }
    case 'mission': if (lens === 'project') out.push(`Request: ${short(n.detail, 1500)}`, 'Files on the map:', ...g.edges.filter((e) => e.from === n.id).map((e) => `${e.kind}: ${g.byId.get(e.to)?.file?.path ?? e.to}`)); break
  }
  out.push('Hydra\'s own summary:', ...explainNode(n, g, lens).here)
  const text = out.join('\n')
  return text.length > 15_500 ? text.slice(0, 15_500) : text
}

/** The file a node is about, when there is one (repository-relative). */
export function fileFor(n: IntelNode): string | null {
  if (n.kind === 'file') return n.file!.path
  if (n.kind === 'finding') return n.finding!.file ?? null
  return null
}

/** The first sentence says what the thing is; it leads, the rest follows as normal text. */
export function leadSentence(text: string): [string, string] {
  const t = text.trim()
  const m = /^([\s\S]*?[.!?])(\s+)(?=[A-Z`"'(])/.exec(t)
  return m && m[1]!.length >= 20 ? [m[1]!, t.slice(m[0].length)] : [t, '']
}
