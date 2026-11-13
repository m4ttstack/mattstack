import { describe, expect, test } from 'bun:test'

import { FILL } from '../draw/theme'
import type { Line } from '../draw/text'
import { selectList, type Choice, type SelectSpec } from './select-list'

const textOf = (line: Line<number>) => line.map(span => span.t).join('')

function spec(choices: Choice[], over: Partial<SelectSpec<number>> = {}): SelectSpec<number> {
  return { choices, cursor: 0, multi: false, isPicked: () => false, cursorIsChoice: false, writeIn: '', width: 60, focused: true, actionFor: idx => idx, ...over }
}

const named = (n: number): Choice[] => Array.from({ length: n }, (_, i) => ({ label: `Choice ${i}` }))
const rowsOf = (lines: Line<number>[], idx: number) => lines.filter(line => line.action === idx)

describe('selectList', () => {
  test('every choice takes at least two rows, focused or not', () => {
    const choices = [...named(3), { label: 'Described', description: 'with text' }]
    for (const cursor of [0, 3]) {
      const lines = selectList(spec(choices, { cursor }))
      choices.forEach((_, idx) => expect(rowsOf(lines, idx).length).toBeGreaterThanOrEqual(2))
    }
  })

  test('a focused write-in row keeps its label and its second row is the input field', () => {
    const choices: Choice[] = [{ label: 'Pick' }, { label: 'Something else', description: 'type here', isWriteIn: true }]
    const rows = rowsOf(selectList(spec(choices, { cursor: 1 })), 1)
    expect(textOf(rows[0] as Line<number>)).toContain('Something else')
    expect((rows[1] as Line<number>).some(span => span.bg === FILL.field.bg)).toBe(true)
  })

  test('more than 8 choices show how many are hidden each side', () => {
    const lines = selectList(spec(named(12), { cursor: 6 }))
    expect(lines.some(line => textOf(line).includes('↑ 2 more'))).toBe(true)
    expect(lines.some(line => textOf(line).includes('↓ 2 more'))).toBe(true)
  })

  test('a single choice draws the chosen mark only when the cursor is a choice', () => {
    const drawn = (cursorIsChoice: boolean) => selectList(spec(named(3), { cursorIsChoice })).some(line => textOf(line).includes('●'))
    expect(drawn(true)).toBe(true)
    expect(drawn(false)).toBe(false)
  })
})
