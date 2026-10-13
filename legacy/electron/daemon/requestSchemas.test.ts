import { describe, expect, it } from 'vitest'
import { createAgentSchema, freeTerminalSpawnSchema, inputSchema } from './requestSchemas'

describe('daemon runtime request schemas', () => {
  const safeCreate = {
    name: 'safe agent',
    projectDir: '/tmp/project',
    provider: 'claude',
    model: 'sonnet',
    yolo: false,
    initialPrompt: ''
  }

  it('rejects full-access agent creation and unknown fields', () => {
    expect(() => createAgentSchema.parse({ ...safeCreate, yolo: true })).toThrow()
    expect(() => createAgentSchema.parse({ ...safeCreate, injected: 'value' })).toThrow()
  })

  it('bounds prompt and terminal path inputs', () => {
    expect(() => inputSchema.parse({ input: 'x'.repeat(20_001) })).toThrow()
    expect(() => freeTerminalSpawnSchema.parse({
      projectDir: '/tmp/project',
      cwd: '/tmp/project',
      extra: true
    })).toThrow()
  })
})
