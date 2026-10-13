import { describe, expect, it } from 'vitest'
import { claudeArgs, claudeTranslator } from './claude.js'
import { codexArgs, codexTranslator } from './codex.js'
import { parseClaudeAuthStatus, parseCodexLoginStatus } from './auth.js'
import type { AgentRunRequest } from './types.js'

const req = (access: 'read' | 'write'): AgentRunRequest => ({ cwd: 'C:/wt/task', prompt: 'x', role: 'implementer', access, timeoutMs: 1000, outputSchema: { type: 'object' } })

// Shapes captured from real CLI runs on 2026-10-13 (Claude Code 2.1.282, Codex CLI 0.154.0), identifiers replaced.
const CLAUDE_RESULT = { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.024066, result: '{"answer":"4","confidence":1}', structured_output: { answer: '4', confidence: 1 }, usage: { input_tokens: 2, cache_creation_input_tokens: 5828, cache_read_input_tokens: 0, output_tokens: 75 }, modelUsage: { 'claude-sonnet-5': {} }, permission_denials: [] }
const CODEX_EVENTS = [
  { type: 'thread.started', thread_id: 'thread-x' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: '{"answer":"4","confidence":1}' } },
  { type: 'turn.completed', usage: { input_tokens: 25174, cached_input_tokens: 0, output_tokens: 19, reasoning_output_tokens: 0 } }
]

describe('Claude adapter', () => {
  it('never grants shell tools and always confines file tools', () => {
    for (const access of ['read', 'write'] as const) {
      const args = claudeArgs(req(access))
      const tools = args[args.indexOf('--tools') + 1]!
      expect(tools).not.toMatch(/Bash|PowerShell|WebFetch|WebSearch/)
      expect(args).toContain('--restricted')
      expect(args).toContain('--strict-mcp-config')
      expect(args[args.indexOf('--permission-prompts') + 1]).toBe('none')
      expect(args).not.toContain('bypassPermissions')
      expect(args).not.toContain('--dangerously-skip-permissions')
    }
    expect(claudeArgs(req('read'))[claudeArgs(req('read')).indexOf('--tools') + 1]).toBe('Read,Glob,Grep')
    expect(claudeArgs(req('write'))).toContain('acceptEdits')
  })

  it('translates the real result event into usage, cost and structured output', () => {
    const t = claudeTranslator()
    const events = t.translate(CLAUDE_RESULT)
    expect(events).toContainEqual({ type: 'usage', inputTokens: 5830, outputTokens: 75, cachedTokens: 0, costUsd: 0.024066, model: 'claude-sonnet-5' })
    expect(events).toContainEqual({ type: 'structured', value: { answer: '4', confidence: 1 } })
    expect(t.conclude(0, '').status).toBe('succeeded')
  })

  it('fails when no result arrived or the result is an error', () => {
    expect(claudeTranslator().conclude(0, '').status).toBe('failed')
    const t = claudeTranslator()
    t.translate({ ...CLAUDE_RESULT, is_error: true, subtype: 'error_max_turns' })
    expect(t.conclude(0, '').status).toBe('failed')
  })
})

describe('Codex adapter', () => {
  it('uses the OS sandbox, no approvals, no network and no user MCP servers', () => {
    const read = codexArgs(req('read'), null)
    const write = codexArgs(req('write'), '/tmp/s.json')
    expect(read[read.indexOf('--sandbox') + 1]).toBe('read-only')
    expect(write[write.indexOf('--sandbox') + 1]).toBe('workspace-write')
    for (const args of [read, write]) {
      expect(args).toContain('approval_policy="never"')
      expect(args).toContain('sandbox_workspace_write.network_access=false')
      expect(args).toContain('mcp_servers={}')
      expect(args.join(' ')).not.toMatch(/danger|bypass/)
      expect(args.at(-1)).toBe('-')
    }
    expect(write).toContain('--output-schema')
  })

  it('translates real JSONL events', () => {
    const t = codexTranslator(true)
    const events = CODEX_EVENTS.flatMap((e) => t.translate(e))
    expect(events).toContainEqual({ type: 'usage', inputTokens: 25174, outputTokens: 19, cachedTokens: 0, costUsd: null, model: null })
    expect(events).toContainEqual({ type: 'structured', value: { answer: '4', confidence: 1 } })
    expect(t.conclude(0, '').status).toBe('succeeded')
  })

  it('fails on turn.failed', () => {
    const t = codexTranslator(false)
    t.translate({ type: 'turn.failed', error: { message: 'model not available' } })
    expect(t.conclude(0, '')).toEqual({ status: 'failed', detail: 'model not available' })
  })
})

describe('sign-in detection keeps no identity data', () => {
  it('reads only loggedIn and method from claude auth status', () => {
    const raw = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'someone@example.com', orgName: "someone's Organization", orgId: 'abc', subscriptionType: 'pro' })
    const state = parseClaudeAuthStatus(raw)
    expect(state).toEqual({ authenticated: true, method: 'claude.ai' })
    expect(JSON.stringify(state)).not.toMatch(/example\.com|Organization|abc|pro/)
  })

  it('handles signed-out and unknown output', () => {
    expect(parseClaudeAuthStatus(JSON.stringify({ loggedIn: false }))).toEqual({ authenticated: false, method: null })
    expect(parseClaudeAuthStatus('garbage')).toEqual({ authenticated: null, method: null })
    expect(parseCodexLoginStatus('Logged in using ChatGPT')).toEqual({ authenticated: true, method: 'ChatGPT' })
    expect(parseCodexLoginStatus('Not logged in')).toEqual({ authenticated: false, method: null })
    expect(parseCodexLoginStatus('')).toEqual({ authenticated: null, method: null })
  })
})
