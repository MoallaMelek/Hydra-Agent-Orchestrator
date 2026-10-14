import { describe, expect, it } from 'vitest'
import { explain } from './explain'

describe('plain-language failures', () => {
  it.each([
    ['Claude Code is not accepting work right now (usage or rate limit): You have hit your usage limit', /limit/],
    ['Codex CLI needs you to sign in again: run `codex login` in a terminal, then press Resume.', /Sign in/],
    ['Claude Code could not reach its service: fetch failed. Hydra tried twice; check your internet connection, then press Resume.', /Couldn't reach/],
    ['Claude Code could not be started. Check that it is installed (Agents & providers), then press Resume.', /couldn't start/],
    ['"pytest" is not installed or not on PATH', /"pytest" isn't installed/],
    ['EPERM: operation not permitted, unlink C:/proj/a.txt', /wasn't allowed/],
    ['Your branch has changes that conflict with this task. Nothing was applied; the task branch is unchanged.', /conflicting/],
    ['Your working tree has uncommitted changes. Commit or stash them, then accept again.', /Commit your own changes/],
    ['Budget limit reached: cost limit $2.00 reached', /Budget/]
  ])('%s', (message, title) => {
    expect(explain(message).title).toMatch(title)
  })

  it('keeps the sign-in command and falls back to the original message', () => {
    expect(explain('Codex CLI needs you to sign in again: run `codex login` in a terminal, then press Resume.').body).toContain('"codex login"')
    expect(explain('TypeError: x is undefined')).toMatchObject({ title: 'Something went wrong', body: 'TypeError: x is undefined' })
  })
})
