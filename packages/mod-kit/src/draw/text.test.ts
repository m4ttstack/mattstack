import { describe, expect, test } from 'bun:test'

import { cellWidth } from './cells'
import { hang, hitAt, hoverKeyAt, sp, widthOf, wrap, type Line } from './text'

describe('wide text', () => {
  test('hitAt counts a wide span as two columns', () => {
    const line: Line<string> = [sp('🚀'), sp('x', { action: 'go' })]
    expect(hitAt(line, 1)).toBeUndefined()
    expect(hitAt(line, 2)).toBe('go')
    expect(hitAt(line, 3)).toBeUndefined()
  })

  test('hoverKeyAt finds a span after CJK text by cells', () => {
    const line: Line<string> = [sp('日本'), sp('go', { action: 'go' })]
    expect(hoverKeyAt([line], 0, 2)).toBeUndefined()
    expect(hoverKeyAt([line], 0, 4)).toBe('0:"go"')
  })

  test('widthOf sums cells', () => {
    expect(widthOf([sp('🚀'), sp('日本'), sp('ab')])).toBe(8)
  })

  test('wrap breaks by cells', () => {
    expect(wrap('日本 日本 日本', 9)).toEqual(['日本 日本', '日本'])
  })

  test('wrap hard-breaks a spaceless CJK title within the width', () => {
    const title = '日本語のタイトルです日本語のタイトルです'
    const rows = wrap(title, 10)
    expect(rows.length).toBeGreaterThan(1)
    for (const row of rows) expect(cellWidth(row)).toBeLessThanOrEqual(10)
    expect(rows.join('')).toBe(title)
  })

  test('wrap hard-breaks a long ASCII word and keeps the rest of the line', () => {
    expect(wrap('ab abcdefghijkl cd', 5)).toEqual(['ab', 'abcde', 'fghij', 'kl cd'])
  })

  test('wrap gives a grapheme wider than the row a row of its own', () => {
    expect(wrap('a 🚀 b', 1)).toEqual(['a', '🚀', 'b'])
    expect(wrap('🚀🚀', 1)).toEqual(['🚀', '🚀'])
  })

  // Each break used to measure the whole rest of the word again, so a long one took time in its length squared.
  test('wrap breaks a very long word in one pass over it, every row within the width', () => {
    const word = '日'.repeat(100_000)
    const started = performance.now()
    const rows = wrap(`ab ${word} cd`, 40)
    expect(performance.now() - started).toBeLessThan(2000)
    expect(rows[0]).toBe('ab')
    expect(rows.slice(1, -1).every(r => r === '日'.repeat(20))).toBe(true)
    expect(rows.length).toBe(1 + 100_000 / 20 + 1)
    expect(rows.at(-1)).toBe('cd')
  })

  test('hang keeps every row within the width in cells', () => {
    const rows = hang([sp('> ')], [sp('  ')], '🚀🚀 🚀🚀 🚀🚀', 12)
    for (const row of rows) expect(widthOf(row)).toBeLessThanOrEqual(12)
  })
})

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
