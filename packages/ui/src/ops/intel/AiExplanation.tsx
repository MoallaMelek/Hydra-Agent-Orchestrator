import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import type { ExplainRequest, ExplainResult } from '@hydra/protocol'
import { useApp } from '../../app/context'
import { Button } from '../../design/components'
import { factsFor, fileFor, leadSentence, modelName, type ExplainLens } from './explain'
import type { IntelGraph, IntelNode } from './graph'
import { providerName } from './text'

const AUTO_KEY = 'hydra.explain.auto'
const CACHE_PREFIX = 'hydra.explain.v2.'
const memory = new Map<string, ExplainResult>()

const readAuto = () => { try { return localStorage.getItem(AUTO_KEY) !== 'off' } catch { return true } }
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0).toString(36) }
function cached(key: string): ExplainResult | null {
  const hit = memory.get(key); if (hit) return hit
  try { const raw = localStorage.getItem(CACHE_PREFIX + key); if (raw) { const v = JSON.parse(raw) as ExplainResult; memory.set(key, v); return v } } catch { /* storage unavailable */ }
  return null
}
function remember(key: string, value: ExplainResult): void {
  memory.set(key, value)
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value)) } catch { /* storage full or unavailable */ }
}

function Prose({ text }: { text: string }) {
  const [lead, rest] = leadSentence(text)
  return <>
    <p className="insp-ai__lead">{lead}</p>
    {rest.split(/\n{2,}/).filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
  </>
}

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; result: ExplainResult; fresh: boolean } | { kind: 'error'; message: string }

/**
 * A plain-English explanation of the selected record, written on the spot by the user's own
 * provider CLI from this project's files and the record. Labelled as AI-written; cached per
 * record so a second look costs nothing. Paused while replaying (records change every frame).
 */
export function AiExplanation({ node: n, graph: g, projectId, lens = 'mission', replaying = false }: { node: IntelNode; graph: IntelGraph; projectId: string | null; lens?: ExplainLens; replaying?: boolean }) {
  const { store } = useApp()
  const canExplain = Boolean(store.transport.explain) && Boolean(projectId)
  const request = useMemo<ExplainRequest | null>(() => projectId ? {
    projectId,
    taskId: lens === 'project' ? (n.kind === 'mission' ? n.id.slice(5) : null) : g.task?.id ?? null,
    kind: n.kind, title: (n.kind === 'file' ? n.file!.path : n.label).slice(0, 300), facts: factsFor(n, g, lens), file: fileFor(n)
  } : null, [n, g, projectId, lens])
  const key = request ? hash(`${request.projectId}|${request.taskId}|${n.id}|${request.facts}`) : ''
  const [auto, setAuto] = useState(readAuto)
  const [state, setState] = useState<State>({ kind: 'idle' })
  // Rewrite bypasses the cache for this record only.
  const [force, setForce] = useState({ key: '', n: 0 })
  const nonce = force.key === key ? force.n : 0

  useEffect(() => {
    if (!request || !canExplain) return
    const hit = nonce === 0 ? cached(key) : null
    if (hit) { setState({ kind: 'done', result: hit, fresh: false }); return }
    if (nonce === 0 && (!auto || replaying)) { setState({ kind: 'idle' }); return }
    const abort = new AbortController()
    // A short pause, so moving across the map does not start a run for every dot passed.
    const timer = setTimeout(() => {
      setState({ kind: 'busy' })
      store.transport.explain!(request, abort.signal)
        .then((result) => { remember(key, result); setState({ kind: 'done', result, fresh: true }) })
        .catch((e: Error) => { if (!abort.signal.aborted) setState({ kind: 'error', message: e.message }) })
    }, nonce ? 0 : 450)
    return () => { clearTimeout(timer); abort.abort() }
  }, [key, nonce, auto, replaying, canExplain])

  if (!canExplain) return null
  const toggle = () => { const next = !auto; setAuto(next); try { localStorage.setItem(AUTO_KEY, next ? 'on' : 'off') } catch { /* ignore */ } }
  return <section className="insp-ai" aria-label="Explained for this project" aria-busy={state.kind === 'busy'}>
    <h3><Sparkles size={13} aria-hidden /> In your project</h3>
    {state.kind === 'busy' && <div className="insp-ai__busy" role="status"><span className="insp-ai__dots" aria-hidden /><span>Reading your project to explain this…</span></div>}
    {state.kind === 'done' && <Prose text={state.result.text} />}
    {state.kind === 'error' && <p className="insp-warn" role="alert">{state.message}</p>}
    {state.kind === 'idle' && <p className="faint">{replaying ? 'Explanations wait while you replay, because the record changes at every moment.' : 'Not explained yet.'}</p>}
    <div className="insp-ai__foot">
      <span className="faint">{state.kind === 'done' ? `Written by ${providerName(state.result.provider)}${state.result.model ? ` (${modelName(state.result.model)})` : ''} from ${state.result.readFrom === 'workspace' ? 'the mission\'s copy of your project' : 'your project folder'} and this record. AI-written, so it can be wrong.` : 'Written on request by your own Claude Code or Codex, read-only.'}</span>
      <span className="row">
        {state.kind !== 'busy' && <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => setForce((f) => ({ key, n: f.key === key ? f.n + 1 : 1 }))}>{state.kind === 'done' ? 'Rewrite' : 'Explain'}</Button>}
        <label className="insp-ai__auto"><input type="checkbox" checked={auto} onChange={toggle} /> Explain when I click</label>
      </span>
    </div>
  </section>
}
