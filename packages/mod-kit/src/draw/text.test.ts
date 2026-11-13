import { describe, expect, test } from 'bun:test'

import { hang, hitAt, hoverKeyAt, sp, type Line } from './text'

describe('hang', () => {
  test('keeps the first-row prefix and indents wrapped rows with rest', () => {
    const rows = hang([sp('A  ')], [sp('   ')], 'hello world foo bar', 13)
    expect(rows.length).toBeGreaterThan(1)
    expect(rows[0]?.[0]?.t).toBe('A  ')
    for (const row of rows.slice(1)) expect(row[0]?.t).toBe('   ')
    expect(rows.map(row => row.slice(1).map(span => span.t).join('')).join(' ')).toBe('hello world foo bar')
  })
})

describe('hitAt', () => {
  const line: Line<string> = Object.assign([sp('ab'), sp('cd', { action: 'span' }), sp('ef')], { action: 'line' })

  test('returns a span action inside its x-range', () => {
    expect(hitAt(line, 2)).toBe('span')
    expect(hitAt(line, 3)).toBe('span')
  })

  test('falls back to the line action outside any span action', () => {
    expect(hitAt(line, 0)).toBe('line')
    expect(hitAt(line, 4)).toBe('line')
    expect(hitAt(undefined, 0)).toBeUndefined()
  })
})

describe('hoverKeyAt', () => {
  test('the same span action on two rows gives two different keys', () => {
    const lines: Line<string>[] = [[sp('go', { action: 'next' })], [sp('go', { action: 'next' })]]
    const first = hoverKeyAt(lines, 0, 0)
    const second = hoverKeyAt(lines, 1, 0)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first).not.toBe(second)
  })
})
