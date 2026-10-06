import { mkdirSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'

export function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  writeFileSync(temp, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
  const fd = openSync(temp, 'r+')
  try { fsyncSync(fd) } finally { closeSync(fd) }
  renameSync(temp, path)
}
