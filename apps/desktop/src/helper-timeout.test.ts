import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type * as ChildProcess from 'node:child_process'
const mock = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async original => ({ ...await original<typeof ChildProcess>(), spawn: mock.spawn }))
import { launchInstallHelper } from './installHelper.js'

it('kills a stalled launcher after ten seconds without granting install permission', async () => {
  vi.useFakeTimers()
  const dir = mkdtempSync(join(tmpdir(), 'hydra-helper-deadline-'))
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  mock.spawn.mockReturnValue(child)
  try {
    const result = launchInstallHelper(join(dir, 'handoff.json'), { installer: 'fixture.exe', executable: 'fixture.exe', sha256: '0'.repeat(64), target: '2.0.0', previous: '1.0.0', backup: 'fixture.db' })
    const check = expect(result).rejects.toThrow('launcher timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await check
    expect(child.kill).toHaveBeenCalledOnce()
    const pointer = JSON.parse(readFileSync(join(dir, 'handoff.json'), 'utf8'))
    expect(JSON.parse(readFileSync(join(dir, pointer.attemptJournal), 'utf8')).installApproved).toBe(false)
    const retry = launchInstallHelper(join(dir, 'handoff.json'), { installer: 'retry.exe', executable: 'fixture.exe', sha256: '1'.repeat(64), target: '2.0.1', previous: '1.0.0', backup: 'fixture.db' })
    const retryCheck = expect(retry).rejects.toThrow('launcher timed out')
    await vi.advanceTimersByTimeAsync(10_000)
    await retryCheck
    const newest = JSON.parse(readFileSync(join(dir, 'handoff.json'), 'utf8'))
    expect(newest.attemptJournal).not.toBe(pointer.attemptJournal)
    expect(JSON.parse(readFileSync(join(dir, pointer.attemptJournal), 'utf8')).installApproved).toBe(false)
  } finally { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }) }
})
