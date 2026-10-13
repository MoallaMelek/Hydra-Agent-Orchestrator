// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceQuitConfirmation } from '../../App'
afterEach(cleanup)
describe('root-owned quit confirmation',()=> {
  it.each([['Keep Running','quitBackground'],['Stop All & Quit','confirmQuit']] as const)('handles %s while task chat is mounted',async(label,method)=> {
    let callback!: (count:number)=>void
    const api={onConfirmQuit:vi.fn(fn=> {callback=fn;return vi.fn()}),quitBackground:vi.fn(async()=>true),confirmQuit:vi.fn(async()=>true)}
    window.hydra=api as any
    render(<WorkspaceQuitConfirmation />); callback(2)
    const button=await screen.findByRole('button',{name:label}); expect(screen.getByRole('dialog')).toHaveTextContent('2 tasks or agents')
    fireEvent.click(button); await waitFor(()=>expect(api[method]).toHaveBeenCalledOnce()); await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
  })
  it('keeps the dialog visible when quit fails and allows cancel',async()=> {
    let callback!: (count:number)=>void
    window.hydra={onConfirmQuit:(fn:any)=> {callback=fn;return()=>{}},quitBackground:vi.fn(async()=>{throw new Error('Daemon failure')}),confirmQuit:vi.fn()} as any
    render(<WorkspaceQuitConfirmation />); callback(1); fireEvent.click(await screen.findByRole('button',{name:'Keep Running'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('Daemon failure'); fireEvent.click(screen.getByRole('button',{name:'Cancel'})); expect(screen.queryByRole('dialog')).toBeNull()
  })
})
