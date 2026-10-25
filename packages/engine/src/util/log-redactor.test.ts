import { describe, expect, it } from 'vitest'
import { LogRedactor } from './log-redactor.js'

describe('persisted stream redaction', () => {
  it('withholds supported credentials across every byte split, including UTF-8', () => {
    for (const secret of ['sk-ant-' + 'a'.repeat(40), 'sk-proj-' + 'a'.repeat(40), 'ghp_' + 'b'.repeat(36), 'github_pat_' + 'a'.repeat(45), 'AKIA' + 'A'.repeat(16), 'xoxb-' + 'a'.repeat(20), 'AIza' + 'a'.repeat(35), 'eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(12), 'https://user:long-secret-value@example.invalid', '--private-key\nlong-secret-value', 'password=long-secret-value', 'password=\nlong-secret-value', 'password\n=\nlong-secret-value', '--token\nlong-secret-value', 'Authorization:\nBasic\nabcdefghijklmnop', 'Authorization:\nBearer\nabcdefghijklmnop', 'Authorization: Bearer abcdefghijklmnop', '-----BEGIN PRIVATE KEY-----\nsecret-body\n-----END PRIVATE KEY-----']) {
      const input = Buffer.from(`hello é\n${secret}\nfinished\n`)
      for (let at = 0; at <= input.length; at++) {
        const r = new LogRedactor()
        const output = r.push(input.subarray(0, at)) + r.push(input.subarray(at)) + r.end()
        expect(output).not.toContain(secret)
        expect(output).not.toContain('secret-body')
        expect(output).not.toContain('long-secret-value')
        expect(output).not.toContain('abcdefghijklmnop')
        expect(output).toContain('hello é')
        expect(output).toContain('finished')
      }
    }
  })
  it('never flushes an oversize unfinished token and resumes at the next line', () => {
    const r = new LogRedactor()
    let output = r.push(Buffer.from('sk-ant-'))
    for (let i = 0; i < 100; i++) output += r.push(Buffer.from('a'.repeat(4096)))
    output += r.push(Buffer.from('\nnext line\n')) + r.end()
    expect(output).not.toContain('sk-ant-')
    expect(output).not.toContain('aaaa')
    expect(output).toContain('next line')
  })
  it('redacts EOF and keeps stdout/stderr independent', () => {
    const a = new LogRedactor(), b = new LogRedactor()
    expect(a.push(Buffer.from('token=longsecretvalue'))).toBe('')
    expect(b.push(Buffer.from('ordinary\n'))).toBe('ordinary\n')
    expect(a.end()).toBe('token=[redacted]')
  })
})
