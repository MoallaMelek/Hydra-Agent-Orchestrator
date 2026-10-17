import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { cleanup, tempDir } from '../testing/fixtures.js'
import { checkDefinitionDigest } from './detect.js'

const dirs: string[] = []
afterEach(() => cleanup(...dirs.splice(0)))

it.each(['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'package-lock.json', 'requirements-dev.txt'])('invalidates check approval when %s changes', (file) => {
  const dir = tempDir('hydra-definitions-')
  dirs.push(dir)
  const before = checkDefinitionDigest(dir)
  writeFileSync(join(dir, file), 'first')
  const added = checkDefinitionDigest(dir)
  expect(added).not.toBe(before)
  writeFileSync(join(dir, file), 'second')
  expect(checkDefinitionDigest(dir)).not.toBe(added)
})

it('distinguishes binary lockfile bytes that decode to the same UTF-8 replacement character', () => {
  const dir = tempDir('hydra-binary-definition-')
  dirs.push(dir)
  writeFileSync(join(dir, 'bun.lockb'), Buffer.from([0x80]))
  const before = checkDefinitionDigest(dir)
  writeFileSync(join(dir, 'bun.lockb'), Buffer.from([0x81]))
  expect(checkDefinitionDigest(dir)).not.toBe(before)
})
