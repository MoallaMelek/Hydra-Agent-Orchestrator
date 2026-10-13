// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskWorkspace } from './TaskWorkspace'
import type { HydraTask } from '@shared/tasks'

const uuid = '10000000-0000-4000-8000-000000000001'
function task(overrides: Partial<HydraTask> = {}): HydraTask {
  return { id:uuid,title:'Architecture inspection',projectDir:'C:\\Projects\\sample',providers:['claude','codex'],permissionMode:'safe',intent:'analyze',intentOverride:'auto',phase:'completed',createdAt:'2026-10-06T10:00:00.000Z',updatedAt:'2026-10-06T10:00:00.000Z',messages:[{id:'user1',role:'user',content:'Explain architecture',createdAt:'2026-10-06T10:00:00.000Z'},{id:'hydra1',role:'hydra',content:'Analysis complete.\n\n```ts\nconst value = 42\n```',createdAt:'2026-10-06T10:00:00.000Z'}],attempts:[],findings:[],decisions:[],events:[],approval:null,writer:null,repairRounds:0,error:null,repository:'main',relevantFiles:[],...overrides }
}
let api: any, changed: (task: HydraTask) => void
beforeEach(() => {
  localStorage.clear()
  api = { listTasks:vi.fn(async()=>[]),listAgents:vi.fn(async()=>[]),selectDirectory:vi.fn(async()=> 'C:\\Projects\\sample'),createTask:vi.fn(async()=>task({phase:'planning'})),taskCommand:vi.fn(async()=>task()),onTaskChanged:vi.fn(callback=> {changed=callback;return vi.fn()}),onTaskActivity:vi.fn(()=>vi.fn()),onTaskText:vi.fn(()=>vi.fn()),openExternal:vi.fn() }
  window.hydra=api
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn(async()=>{})}})
})
afterEach(cleanup)
const mount = () => render(<TaskWorkspace onAgents={vi.fn()} onSettings={vi.fn()} />)
async function openTask(value = task()) { api.listTasks.mockResolvedValue([value]); mount(); await screen.findByRole('button',{name:/Architecture inspection.*sample/}); fireEvent.click(screen.getByRole('button',{name:/Architecture inspection.*sample/})) }

describe('unified task workspace flows',()=> {
  it('creates a natural-language task using a selected project and automatic routing',async()=> {
    mount(); await screen.findByText('● Connected to local daemon')
    fireEvent.click(screen.getByRole('button',{name:'Browse'})); await waitFor(()=>expect(screen.getByLabelText('Project')).toHaveValue('C:\\Projects\\sample'))
    fireEvent.change(screen.getByLabelText('Message Hydra'),{target:{value:'Fix the feature'}})
    fireEvent.click(screen.getByRole('button',{name:'Send ↑'}))
    await waitFor(()=>expect(api.createTask).toHaveBeenCalledWith(expect.objectContaining({prompt:'Fix the feature',intent:'auto',permissionMode:'safe',providers:['claude','codex']})))
    expect(localStorage.getItem('hydra:task-selection')).toBe(uuid)
  })
  it('searches, opens and restores durable conversation selection across a remount',async()=> {
    await openTask(); expect(screen.getByText('Analysis complete.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search conversations'),{target:{value:'nonexistent'}})
    expect(screen.getByText('No matching conversations')).toBeInTheDocument()
    cleanup(); mount(); expect(await screen.findByText('Analysis complete.')).toBeInTheDocument()
  })
  it('renames a conversation through the durable command boundary',async()=> {
    await openTask(); fireEvent.click(document.querySelector('.task-title')!)
    fireEvent.change(screen.getByLabelText('Conversation name'),{target:{value:'Renamed conversation'}})
    fireEvent.click(screen.getByRole('button',{name:'Save'}))
    await waitFor(()=>expect(api.taskCommand).toHaveBeenCalledWith(uuid,{action:'rename',title:'Renamed conversation'}))
  })
  it('edit/resubmit preserves the original turn and submits a new message',async()=> {
    await openTask(); fireEvent.click(screen.getByRole('button',{name:'Edit & resubmit'}))
    expect(screen.getByLabelText('Message Hydra')).toHaveValue('Explain architecture')
    fireEvent.change(screen.getByLabelText('Message Hydra'),{target:{value:'Now implement it'}}); fireEvent.click(screen.getByRole('button',{name:'Send ↑'}))
    await waitFor(()=>expect(api.taskCommand).toHaveBeenCalledWith(uuid,{action:'message',prompt:'Now implement it',attachments:[]}))
  })
  it('shows blocking approval visibly and submits the precise approval ID',async()=> {
    const approval={id:'20000000-0000-4000-8000-000000000001',reason:'Project edits need approval',scope:'C:\\Projects\\sample',status:'pending' as const,createdAt:'2026-10-06T10:00:00.000Z'}
    await openTask(task({phase:'awaiting_approval',approval}))
    expect(screen.getByRole('heading',{name:'Approval required'})).toBeInTheDocument()
    expect(screen.getByLabelText('Message Hydra')).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'Approve project actions'}))
    await waitFor(()=>expect(api.taskCommand).toHaveBeenCalledWith(uuid,{action:'approve',approvalId:approval.id,approved:true}))
  })
  it('stops running tasks while the composer prevents accidental steering',async()=> {
    await openTask(task({phase:'implementation'})); expect(screen.getByLabelText('Message Hydra')).toBeDisabled()
    fireEvent.click(screen.getByRole('button',{name:'■ Stop'})); await waitFor(()=>expect(api.taskCommand).toHaveBeenCalledWith(uuid,{action:'cancel'}))
  })
  it('offers retry and continue for terminal tasks',async()=> {
    await openTask(); fireEvent.click(screen.getByRole('button',{name:'Retry'})); await waitFor(()=>expect(api.taskCommand).toHaveBeenCalledWith(uuid,{action:'retry'}))
    await waitFor(()=>expect(screen.getByRole('button',{name:'Continue'})).not.toBeDisabled()); fireEvent.click(screen.getByRole('button',{name:'Continue'})); await waitFor(()=>expect(api.taskCommand).toHaveBeenCalledWith(uuid,{action:'continue'}))
  })
  it('reconnects and reconciles missed state on window focus',async()=> {
    api.listTasks.mockRejectedValueOnce(new Error('Daemon offline')).mockResolvedValue([task()]); mount()
    expect(await screen.findByText('Daemon offline')).toBeInTheDocument()
    fireEvent(window,new Event('focus')); await screen.findByText('● Connected to local daemon')
    expect(screen.getByRole('button',{name:/Architecture inspection.*sample/})).toBeInTheDocument()
  })
  it('renders code safely and copies its exact text',async()=> {
    await openTask(); fireEvent.click(screen.getByRole('button',{name:'Copy code'})); await waitFor(()=>expect(navigator.clipboard.writeText).toHaveBeenCalledWith('const value = 42'))
  })
  it('shows daemon failures and unavailable provider details from durable state',async()=> {
    await openTask(task({phase:'failed',error:'No selected CLI is available'})); expect(screen.getByRole('alert')).toHaveTextContent('No selected CLI is available')
    changed(task({phase:'canceled',error:'Stopped'})); await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Stopped'))
  })
  it('supports text attachments and rejects secret filenames',async()=> {
    mount(); await screen.findByText('● Connected to local daemon')
    const file=new File(['notes'],'notes.md',{type:'text/plain'}); Object.defineProperty(file,'text',{value:async()=> 'notes'})
    fireEvent.change(screen.getByLabelText('Attach files'),{target:{files:[file]}}); await screen.findByRole('button',{name:'notes.md ×'})
    const secret=new File(['x'],'auth.json',{type:'application/json'}); fireEvent.change(screen.getByLabelText('Attach files'),{target:{files:[secret]}})
    expect(await screen.findByRole('alert')).toHaveTextContent('Credential and secret attachments')
  })
})
