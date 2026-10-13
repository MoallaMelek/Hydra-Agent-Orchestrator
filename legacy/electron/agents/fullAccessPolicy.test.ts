import { describe, expect, it } from 'vitest'
import { getProvider } from './providers'

describe('full-access provider policy', () => {
  it('never emits Claude or Codex permission-bypass flags', () => {
    const base = {
      id: 'agent-1',
      name: 'test',
      projectDir: '/tmp/project',
      model: 'test-model',
      yolo: true,
      isManager: false,
      sessionId: null,
      initialPrompt: '',
      createdAt: new Date(0).toISOString(),
      status: 'idle' as const,
      pid: null,
      restartCount: 0,
      startedAt: null,
      lastActivityAt: new Date(0).toISOString(),
      workMode: 'local' as const,
      worktreePath: null,
      worktreeBranch: null
    }

    const claudeArgs = getProvider('claude').buildArgs({ ...base, provider: 'claude' })
    const codexArgs = getProvider('codex').buildArgs({ ...base, provider: 'codex' })
    expect(claudeArgs).not.toContain('--dangerously-skip-permissions')
    expect(codexArgs).not.toContain('--full-auto')
  })
})
