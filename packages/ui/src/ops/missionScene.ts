import type { TaskStage } from '@hydra/protocol'
import type { Segment, SegStatus, Trace } from './model'

export type StationId = 'plan' | 'build' | 'review' | 'repair' | 'checks' | 'decision'
export interface Station {
  id: StationId
  title: string
  actor: string
  records: Segment[]
  status: SegStatus | 'none'
}
export const STATION: Record<TaskStage, StationId> = { plan: 'plan', implement: 'build', review: 'review', fix: 'repair', verify: 'checks', demo: 'checks', approval: 'decision', apply: 'decision' }
const belongs = (s: Segment): StationId => s.kind === 'check' || s.kind === 'checking' ? 'checks' : s.stage ? STATION[s.stage] : s.lane === 'you' ? 'decision' : 'plan'

/** Discrete timestamps only: replay never invents intermediate observations. */
export function recordedMoments(trace: Trace): { times: number[]; omitted: number } {
  const all = [...new Set([trace.start, ...trace.segments.filter(s => s.basis === 'observed').flatMap(s => [s.start, ...(s.end === null ? [] : [s.end])]), ...trace.stages.flatMap(s => [s.start, ...(s.end === null ? [] : [s.end])])])].filter(Number.isFinite).sort((a,b) => a-b)
  return { times: all.slice(-180), omitted: Math.max(0, all.length-180) }
}

/** Pure historical projection. Future status, tool ticks and completion do not leak. */
export function missionScene(trace: Trace, cursor: number | null) {
  const at = cursor ?? trace.now
  const records = trace.segments.filter(s => s.start <= at).map(s => {
    const unfinished = s.end !== null && s.end > at
    return { ...s, end: unfinished ? null : s.end, status: unfinished ? (s.kind === 'gate' ? 'waiting' : 'running') as SegStatus : s.status, ticks: s.ticks.filter(t => t.at <= at), label: unfinished && s.kind === 'check' ? 'Check in progress · result not yet recorded' : unfinished && s.kind === 'apply' ? 'Applying accepted revision · outcome not yet recorded' : s.label }
  })
  const actor = (lane: string) => trace.lanes.find(l => l.id === lane)?.actor ?? 'Not assigned'
  const stations: Station[] = [
    { id:'plan',title:'Plan',actor:actor('planner'),records:[],status:'none' },
    { id:'build',title:'Build',actor:actor('implementer'),records:[],status:'none' },
    { id:'review',title:'Review',actor:actor('reviewer'),records:[],status:'none' },
    { id:'repair',title:'Repair',actor:actor('implementer'),records:[],status:'none' },
    { id:'checks',title:'Engine checks',actor:'Hydra · runs commands',records:[],status:'none' },
    { id:'decision',title:'Your decision',actor:'You · control delivery',records:[],status:'none' }
  ]
  for (const station of stations) {
    station.records = records.filter(s => belongs(s) === station.id).sort((a,b) => a.start-b.start)
    station.status = station.records.at(-1)?.status ?? 'none'
  }
  const stages = trace.stages.filter(s => s.start <= at).sort((a,b) => a.start-b.start)
  const edges: Array<{from: StationId; to: StationId}> = []
  for(let i=1;i<stages.length;i++) {
    const from=STATION[stages[i-1]!.stage], to=STATION[stages[i]!.stage]
    if(from!==to && !edges.some(e => e.from===from && e.to===to)) edges.push({from,to})
  }
  // A recorded human gate is also a real dependency, even without an approval stage span.
  if(records.some(s=>s.kind==='gate') && stages.length) {
    const from=STATION[stages.at(-1)!.stage]
    if(from!=='decision' && !edges.some(e=>e.from===from && e.to==='decision')) edges.push({from,to:'decision'})
  }
  return { stations, edges, records, at }
}
