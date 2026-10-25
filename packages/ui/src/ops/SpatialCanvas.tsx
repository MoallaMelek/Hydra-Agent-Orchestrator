import { useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus, Search } from 'lucide-react'
import { Button } from '../design/components'
import type { Segment } from './model'
import type { missionScene, StationId } from './missionScene'
import { spatialGraph, type SpatialLayout, type SpatialNode } from './spatialGraph'

export function SpatialCanvas({scene,layout,focus,selected,statusOf,onStation,onRecord}:{scene:ReturnType<typeof missionScene>;layout:SpatialLayout;focus:StationId;selected?:string;statusOf:(id:StationId)=>string|null;onStation:(id:StationId)=>void;onRecord:(r:Segment)=>void}) {
 const graph=useMemo(()=>spatialGraph(scene,layout),[scene,layout])
 const [query,setQuery]=useState(''),[active,setActive]=useState<string|null>(null),[keyboard,setKeyboard]=useState<string|null>(null)
 const [camera,setCamera]=useState({x:0,y:0,zoom:1})
 const host=useRef<HTMLDivElement>(null),drag=useRef<{x:number;y:number;cx:number;cy:number}|null>(null)
 const needle=query.trim().toLowerCase(),matches=graph.nodes.filter(n=>(n.label+' '+n.station+' '+n.basis).toLowerCase().includes(needle))
 const activeNode=graph.nodes.find(n=>n.id===active)
 const activeId=activeNode&&(activeNode.kind==='station'?activeNode.station===focus:activeNode.record?.id===selected)?active:null
 const selectedId=activeId??selected??'station:'+focus,selectedNode=graph.nodes.find(n=>n.id===selectedId)
 const tabId=graph.nodes.some(n=>n.id===keyboard)?keyboard:selectedNode?.id??'station:'+focus
 const related=new Set(graph.edges.filter(e=>e.from===selectedId||e.to===selectedId).flatMap(e=>[e.from,e.to]))
 const activate=(n:SpatialNode)=>{setActive(n.id);setKeyboard(n.id);if(n.kind==='station')onStation(n.station);else if(n.record)onRecord(n.record)}
 const center=(n:SpatialNode)=>{setCamera({x:0,y:0,zoom:1});activate(n);if(!matchMedia('(max-width:900px)').matches)requestAnimationFrame(()=>host.current?.querySelector<HTMLButtonElement>('[data-spatial-id="'+CSS.escape(n.id)+'"]')?.focus({preventScroll:true}))}
 const zoom=(delta:number)=>setCamera(c=>({...c,zoom:Math.max(.65,Math.min(2,c.zoom+delta))}))
 return <div className={'spatial-canvas spatial-canvas--'+layout}>
  <div className="spatial-toolbar"><label><Search size={14}/><input aria-label="Search displayed scene" placeholder="Find an operation…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="row"><Button size="sm" variant="ghost" aria-label="Zoom out" icon={<Minus size={14}/>} disabled={camera.zoom<=.65} onClick={()=>zoom(-.15)}/><span>{Math.round(camera.zoom*100)}%</span><Button size="sm" variant="ghost" aria-label="Zoom in" icon={<Plus size={14}/>} disabled={camera.zoom>=2} onClick={()=>zoom(.15)}/><Button size="sm" variant="ghost" aria-label="Fit and reset canvas" icon={<Maximize2 size={14}/>} onClick={()=>setCamera({x:0,y:0,zoom:1})}/></div></div>
  {needle&&<div className="spatial-search" aria-label="Scene search results"><p>{matches.length} matches in the displayed scene</p>{matches.slice(0,20).map(n=><button key={n.id} onClick={()=>{center(n);setQuery('')}}>{n.label}<small>{n.station} · {n.basis}</small></button>)}{matches.length>20&&<p>Showing first 20; refine your search.</p>}<button onClick={()=>setQuery('')}>Clear search</button></div>}
  <div className="spatial-viewport" ref={host} role="region" aria-label="Mission relationship map" tabIndex={0} onKeyDown={e=>{
   const direction=['ArrowRight','ArrowDown'].includes(e.key)?1:['ArrowLeft','ArrowUp'].includes(e.key)?-1:0
   if(!direction)return
   if(e.target===e.currentTarget){e.preventDefault();setCamera(c=>({...c,x:c.x+(e.key==='ArrowLeft'?40:e.key==='ArrowRight'?-40:0),y:c.y+(e.key==='ArrowUp'?40:e.key==='ArrowDown'?-40:0)}));return}
   if(!(e.target instanceof HTMLButtonElement))return
   e.preventDefault();const target=e.target,index=graph.nodes.findIndex(n=>n.id===target.dataset.spatialId),next=graph.nodes[(index+direction+graph.nodes.length)%graph.nodes.length];if(next){setKeyboard(next.id);setCamera({x:0,y:0,zoom:1});requestAnimationFrame(()=>host.current?.querySelector<HTMLButtonElement>('[data-spatial-id="'+CSS.escape(next.id)+'"]')?.focus({preventScroll:true}))}
  }} onPointerDown={e=>{if(e.button!==0||(e.target as Element).closest('button'))return;drag.current={x:e.clientX,y:e.clientY,cx:camera.x,cy:camera.y};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{const d=drag.current;if(d&&Math.hypot(e.clientX-d.x,e.clientY-d.y)>4)setCamera(c=>({...c,x:d.cx+e.clientX-d.x,y:d.cy+e.clientY-d.y}))}} onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}} onPointerCancel={()=>{drag.current=null}}>
   <div className="spatial-world" style={{transform:`translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`}}>
    <svg viewBox="0 0 1100 620" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="spatial-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8" fill="currentColor"/></marker></defs>{graph.edges.map(e=>{const a=graph.nodes.find(n=>n.id===e.from)!,b=graph.nodes.find(n=>n.id===e.to)!;return <path key={e.kind+e.from+e.to} className={`spatial-edge spatial-edge--${e.kind}${e.from===selectedId||e.to===selectedId?' is-related':''}`} d={`M${a.x} ${a.y}C${(a.x+b.x)/2} ${a.y} ${(a.x+b.x)/2} ${b.y} ${b.x} ${b.y}`} markerEnd={e.kind==='transition'?'url(#spatial-arrow)':undefined}/>})}</svg>
    {graph.nodes.map(n=>{const hot=n.id===selectedId,dim=!!needle&&!matches.some(m=>m.id===n.id)||!!activeId&&!!selectedNode&&!hot&&!related.has(n.id),status=n.record?.status;return <button key={n.id} type="button" data-spatial-id={n.id} data-operation-state={n.kind==='station'?scene.stations.find(s=>s.id===n.station)!.status:status} tabIndex={n.id===tabId?0:-1} aria-label={`${n.label} · ${n.station} · ${n.basis}${status&&n.kind!=='tool'?' · '+status:''}`} aria-pressed={hot} aria-controls="mission-focus" title={`${n.label} · ${n.basis}`} className={`spatial-node spatial-node--${n.kind} spatial-node--${n.station}${n.x>780?' spatial-node--label-left':''}${dim?' is-dim':''}${n.kind!=='tool'&&(status==='failed'||status==='interrupted')?' is-failed':''}`} style={{left:n.x/11+'%',top:n.y/6.2+'%'}} onClick={()=>activate(n)}>
     <span className="spatial-node__point">{n.kind==='station'?scene.stations.find(s=>s.id===n.station)!.records.length:status==='failed'&&n.kind==='operation'?'!':n.kind==='operation'?'•':''}</span><span className="spatial-node__label">{n.label}<small>{n.kind==='station'?scene.stations.find(s=>s.id===n.station)!.actor+(statusOf(n.station)?' · '+statusOf(n.station):''):n.kind==='tool'?'reported call':n.basis+' operation'}</small></span>
    </button>})}
   </div>
  </div>
   <div className="spatial-caption"><b>{layout==='flow'?'The engineering flow':'Anatomy of a mission'}</b><span>{graph.nodes.filter(n=>n.kind==='operation').length} displayed operations · {graph.nodes.filter(n=>n.kind==='tool').length} reported calls</span></div>
  <div className="spatial-legend"><span><i/>Role—operation: membership</span><span><i className="is-dotted"/>Operation—call: reported activity</span><span><i className="is-directed"/>Arrow: recorded stage transition</span></div>
  <p className="spatial-help" role="status">{active&&!activeNode?'Selection left the displayed window. Choose a visible record.':selectedNode?`${selectedNode.label} · ${selectedNode.basis}${selectedNode.at!==undefined?' · '+new Date(selectedNode.at).toLocaleTimeString():''}`:'Select a node to inspect its evidence.'} {graph.omittedOperations>0&&`${graph.omittedOperations} operations omitted in this view. `}{graph.omittedCalls>0&&`${graph.omittedCalls} calls omitted. `}Flow shows up to 3 recent operations per role; Network up to 100 total and 200 calls. Drag background to pan. Arrow keys navigate focused nodes; Enter selects. Calls are activity, not dependency or success.</p>
 </div>
}
