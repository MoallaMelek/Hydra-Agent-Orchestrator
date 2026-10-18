/** Explicit owner-approved bounded live evaluation. Disposable repositories/profiles only. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../packages/engine/src/engine.js'
import { makeRepo, BUGGY_NODE_PROJECT, gitIn } from '../packages/engine/src/testing/fixtures.js'
import { approvalContext, newAcceptanceId, type Task } from '@hydra/protocol'

if (!process.argv.includes('--approved-live-evaluation')) throw Error('Live evaluation is disabled by default. Obtain fresh owner approval for the total provider allowance before supplying --approved-live-evaluation. Never rerun the exhausted production trial.')
const outputFile=process.argv.slice(2).find(arg=>arg!=='--approved-live-evaluation')
if (!outputFile) throw Error('Supply an output receipt path')
const dataDir=mkdtempSync(join(tmpdir(),'hydra-live-evaluation-'))
const engine=await Engine.open({dataDir,version:'production-preparation'})
const results:unknown[]=[]
let remainingReportedTokens = 50000, remainingClaudeUsd = 1, largestObservedCodexTurn = 0
const cases = [
 {name:'Claude simple question',intent:'analyze',prompt:'What does add() in math.js do? Answer in one sentence. Do not modify files.',assignment:{planner:'claude',implementer:'claude',reviewer:'claude'},dollars:0.10,tokens:5000,runs:1},
 {name:'Codex repository analysis',intent:'analyze',prompt:'Inspect math.js and math.test.js only. Identify the arithmetic defect in one sentence. Do not edit or run any commands.',assignment:{planner:'codex',implementer:'codex',reviewer:'codex'},dollars:0.10,tokens:10000,runs:1},
 {name:'Claude to Codex to Claude small bug fix',intent:'change',prompt:'Fix add() in math.js to add its two arguments and satisfy the existing math.test.js. Change only math.js; keep the public API. This is a disposable test project.',assignment:{planner:'claude',implementer:'codex',reviewer:'claude'},dollars:0.80,tokens:35000,runs:3}
]
try {
 for(const c of cases) {
  if (remainingReportedTokens <= 0 || remainingClaudeUsd <= 0 || (Object.values(c.assignment).includes('codex') && remainingReportedTokens < largestObservedCodexTurn)) {
    results.push({name:c.name,status:'not_started',reason:'Remaining reported-usage allowance cannot cover the observed provider turn reserve. Further owner approval required.'}); continue
  }
  const root=makeRepo(BUGGY_NODE_PROJECT),started=Date.now()
  const add=await engine.execute({type:'project.add',root,name:c.name});if(!add.ok)throw Error(add.error.message)
  const created=await engine.execute({type:'task.create',projectId:(add.result as {id:string}).id,title:c.name,prompt:c.prompt,intent:c.intent,depth:c.intent==='change'?'deep':'fast',mode:'developer',assignment:c.assignment,budget:{maxCostUsd:Math.min(c.dollars,remainingClaudeUsd),maxTokens:Math.min(c.tokens,remainingReportedTokens),maxWallMinutes:8,maxAgentRuns:c.runs,maxFixRounds:0}})
  if(!created.ok){results.push({name:c.name,created:false,error:created.error});continue}
  const id=(created.result as Task).id
  await engine.orchestrator.settled(id)
  if(engine.store.getTask(id)?.waitReason==='plan_approval') {await engine.execute({type:'task.approve_plan',taskId:id,approve:true});await engine.orchestrator.settled(id)}
  let t=engine.store.getTask(id)!,decision:unknown=null
  if(c.intent==='change' && t.waitReason==='final_approval') {
   const context=approvalContext(t,engine.store.listEvidence(id))
   if(context.allowed){decision=await engine.execute({type:'task.decide',taskId:id,decision:'accept',headSha:t.workspace!.headSha,acceptance:{decisionId:newAcceptanceId(),snapshot:context.snapshot}});await engine.orchestrator.settled(id);t=engine.store.getTask(id)!}
   else decision={blocked:context.unresolved}
  }
  const codexRuns=engine.store.listRuns(id).filter(r=>r.provider==='codex')
  const reportedCodexTokens=codexRuns.reduce((sum,r)=>sum+r.usage.inputTokens+r.usage.outputTokens+r.usage.cachedTokens,0)
  remainingReportedTokens -= reportedCodexTokens
  remainingClaudeUsd -= t.usage.costUsd
  largestObservedCodexTurn = Math.max(largestObservedCodexTurn,...codexRuns.map(r=>r.usage.inputTokens+r.usage.outputTokens+r.usage.cachedTokens))
  results.push({name:c.name,root,taskId:id,status:t.status,outcome:t.outcome,elapsedMs:Date.now()-started,error:t.error,usage:t.usage,answer:t.answer,evidence:engine.store.listEvidence(id).map(e=>({phase:e.phase,commitSha:e.commitSha,exitCode:e.exitCode,treeMutated:e.treeMutated,spawnError:e.spawnError})),decision,userBranch:gitIn(root,'rev-parse','HEAD')})
  writeFileSync(outputFile,JSON.stringify({dataDir,results,remainingReportedTokens,remainingClaudeUsd,budgetScope:'Allocated total: Claude $1; Codex total reported token target 50,000 INCLUDING cached input. Engine and harness count cached input as reported usage. Turn-end reporting can still overshoot and cannot guarantee a hard billing cap. No further calls after allowance exhaustion; fresh owner approval required.'},null,2))
 }
} finally {await engine.close()}
console.log(JSON.stringify({cases:results.length,results},null,2))
