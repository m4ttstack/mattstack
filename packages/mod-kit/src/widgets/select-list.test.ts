import { describe, expect, test } from 'bun:test'

import { FILL } from '../draw/theme'
import type { Line } from '../draw/text'
import { selectList, type Choice, type SelectSpec } from './select-list'

const textOf = (line: Line<number>) => line.map(span => span.t).join('')

function spec(choices: Choice[], over: Partial<SelectSpec<number>> = {}): SelectSpec<number> {
  return { choices, cursor: 0, multi: false, isPicked: () => false, writeIn: '', width: 60, focused: true, actionFor: idx => idx, ...over }
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

  test('a focused write-in is one row: the label is the placeholder and typing fills the same row', () => {
    const choices: Choice[] = [{ label: 'Pick' }, { label: 'Something else', isWriteIn: true }]
    const empty = rowsOf(selectList(spec(choices, { cursor: 1 })), 1)
    expect(empty.length).toBe(1)
    expect(textOf(empty[0] as Line<number>)).toContain('Something else')
    expect((empty[0] as Line<number>).some(span => span.bg === FILL.field.bg)).toBe(true)
    const typed = rowsOf(selectList(spec(choices, { cursor: 1, writeIn: 'my words' })), 1)
    expect(typed.length).toBe(1)
    expect(textOf(typed[0] as Line<number>)).toContain('my words')
  })

  test('more than 8 choices show how many are hidden each side', () => {
    const lines = selectList(spec(named(12), { cursor: 6 }))
    expect(lines.some(line => textOf(line).includes('↑ 2 more'))).toBe(true)
    expect(lines.some(line => textOf(line).includes('↓ 2 more'))).toBe(true)
  })

  test('the pick is separate from the cursor: a single pick draws the chosen mark wherever the cursor is', () => {
    const drawn = (cursor: number) => selectList(spec(named(3), { cursor, isPicked: idx => idx === 2 })).some(line => textOf(line).includes('●'))
    expect(drawn(0)).toBe(true)
    expect(drawn(2)).toBe(true)
    expect(selectList(spec(named(3))).some(line => textOf(line).includes('●'))).toBe(false)
  })

  test('focused, the cursor row shows ❯ in the gutter; unfocused shows none', () => {
    const text = (focused: boolean) => selectList(spec(named(3), { cursor: 1, focused })).map(textOf).join('\n')
    expect(text(true)).toContain('❯ ')
    expect(text(false)).not.toContain('❯')
  })

  test('rail false leaves the rail span empty', () => {
    const lines = selectList(spec(named(2), { rail: false }))
    expect(lines.every(line => line[0]!.t === '')).toBe(true)
  })

  test('spaced puts a blank row between choices', () => {
    const count = (spaced: boolean) => selectList(spec(named(3), { spaced })).length
    expect(count(true)).toBe(count(false) + 2)
  })

  test('an unaccepted default pick draws a dim ●, not the green one', () => {
    const mark = (isDefault: boolean) => selectList(spec(named(2), { isPicked: idx => idx === 0, isDefault: () => isDefault })).flat().find(span => span.t === '●')!
    expect(mark(true).dim).toBe(true)
    expect(mark(false).dim).toBeFalsy()
  })
})
