import { describe, expect, it } from 'vitest'
import { normalizedCheckCommand, validateVerification } from './verification'
describe('verification evidence', () => {
  it('accepts exact planned checks in common CLI shell wrappers', () => {
    expect(normalizedCheckCommand('powershell.exe -NoProfile -Command "npm run test"')).toBe('npm run test')
    expect(normalizedCheckCommand('\"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\" -Command \"npm run test\"')).toBe('npm run test')
    expect(normalizedCheckCommand('/bin/bash -lc \'npm run build\'')).toBe('npm run build')
  })
  it('rejects echo, source reading, chained and unrelated commands', () => {
    for (const command of ['echo test', 'cat tests/foo', 'npm run test && echo done', 'node check.js', 'npm run deployment-test', 'npm run build; rm -rf .']) expect(normalizedCheckCommand(command)).toBeNull()
  })
  it('requires every planned check and rejects failed attempts even after a pass', () => {
    const evidence = [{ command: 'npm run test', exitCode: 0, output: '', runId: 'run' }]
    expect(validateVerification(['npm run test','npm run build'], evidence).ok).toBe(false)
    expect(validateVerification(['npm run test'], [...evidence, { ...evidence[0], exitCode: 1 }]).ok).toBe(false)
    expect(validateVerification(['npm run test'], evidence).ok).toBe(true)
  })
})
