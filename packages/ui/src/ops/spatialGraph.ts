import type { Segment } from './model'
import type { missionScene, StationId } from './missionScene'
export type SpatialLayout='flow'|'network'
export interface SpatialNode { id:string;station:StationId;kind:'station'|'operation'|'tool';label:string;basis:Segment['basis'];record?:Segment;at?:number;x:number;y:number }
export interface SpatialEdge {from:string;to:string;kind:'transition'|'membership'|'activity'}
const centers:Record<StationId,[number,number]>={plan:[180,160],build:[550,145],review:[900,160],repair:[900,455],checks:[550,470],decision:[180,455]}
/** Bounded typed relationships, two deterministic arrangements; never causal inference. */
export function spatialGraph(scene:ReturnType<typeof missionScene>,layout:SpatialLayout){
 const recent=[...scene.records].sort((a,b)=>a.start-b.start||(a.id<b.id?-1:a.id>b.id?1:0)).slice(-100),nodes:SpatialNode[]=[],edges:SpatialEdge[]=[]
 for(const [i,s] of scene.stations.entries()){
  const [x,y]=layout==='network'?centers[s.id]:[170,70+i*95]
  nodes.push({id:'station:'+s.id,station:s.id,kind:'station',label:s.title,basis:'observed',x,y})
  const members=recent.filter(r=>s.records.some(item=>item.id===r.id))
  for(const [j,r] of (layout==='flow'?members.slice(-3):members).entries()){
   const angle=j*2.3999632297,radius=65+Math.sqrt(j)*18
   nodes.push({id:r.id,station:s.id,kind:'operation',record:r,label:r.label,basis:r.basis,x:layout==='network'?Math.max(80,Math.min(1020,x+Math.cos(angle)*radius)):620,y:layout==='network'?Math.max(45,Math.min(575,y+Math.sin(angle)*radius)):y+(j-1)*27})
   edges.push({from:'station:'+s.id,to:r.id,kind:'membership'})
  }
 }
 const displayed=nodes.filter(n=>n.record),all=displayed.flatMap(n=>n.record!.ticks.map((tick,i)=>({n,tick,i})))
 const eligible=layout==='flow'?displayed.flatMap(n=>n.record!.ticks.map((tick,i)=>({n,tick,i})).slice(-2)):all
 const calls=eligible.sort((a,b)=>a.tick.at-b.tick.at||a.n.id.localeCompare(b.n.id)||a.i-b.i).slice(-200)
 for(const {n,tick,i} of calls){
  const angle=i*2.3999632297,radius=32+Math.sqrt(i%12)*10
  nodes.push({id:n.id+'/tool/'+i,station:n.station,kind:'tool',record:n.record,label:'Reported '+tick.kind+' call',basis:'observed',at:tick.at,x:Math.max(24,Math.min(1076,layout==='flow'?850+i%2*100:n.x+Math.cos(angle)*radius)),y:Math.max(24,Math.min(596,n.y+Math.sin(angle)*radius))})
  edges.push({from:n.id,to:n.id+'/tool/'+i,kind:'activity'})
 }
 for(const e of scene.edges)edges.push({from:'station:'+e.from,to:'station:'+e.to,kind:'transition'})
 return {nodes,edges,omittedOperations:scene.records.length-displayed.length,omittedCalls:scene.records.reduce((count,r)=>count+r.ticks.length,0)-calls.length}
}
