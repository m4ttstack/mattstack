import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { treeSignature } from '../build-lib'

const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('treeSignature', () => {
  test('ignores node_modules and changes with content or mtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sig-'))
    made.push(dir)
    const file = join(dir, 'a.ts')
    writeFileSync(file, 'one')
    const first = treeSignature([dir])
    mkdirSync(join(dir, 'node_modules'))
    writeFileSync(join(dir, 'node_modules', 'x.js'), 'x')
    expect(treeSignature([dir])).toBe(first)
    writeFileSync(file, 'three')
    const second = treeSignature([dir])
    expect(second).not.toBe(first)
    utimesSync(file, new Date(1000), new Date(2000))
    expect(treeSignature([dir])).not.toBe(second)
  })
})
