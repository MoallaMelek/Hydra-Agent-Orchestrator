import { describe, expect, it } from 'vitest'
import { splitCommand } from './ChecksPanel'

describe('command line splitting (no shell)', () => {
  it.each([
    ['npm test', ['npm', 'test']],
    ['  python -m   pytest  ', ['python', '-m', 'pytest']],
    ['node "my tests/run.js" --flag', ['node', 'my tests/run.js', '--flag']],
    ["echo 'a b' \"\"", ['echo', 'a b', '']],
    ['', []]
  ])('%j', (line, argv) => {
    expect(splitCommand(line)).toEqual(argv)
  })
})
