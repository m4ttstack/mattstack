import { describe, expect, test } from 'bun:test'

import { widthOf, type Line } from '../draw/text'
import { SCROLL } from '../draw/theme'
import { scrollBar } from './scroll-bar'

const thumbRows = (lines: Line<never>[]) => lines.flatMap((line, n) => (line.some(span => span.bg === SCROLL.thumb) ? [n] : []))

describe('scrollBar', () => {
  test('at the top the thumb starts on the first row, rows² / total tall', () => {
    const lines = scrollBar(20, 200, 0)
    expect(lines).toHaveLength(20)
    expect(thumbRows(lines)).toEqual([0, 1])
  })

  test('at the last offset the thumb sits on the last rows', () => {
    expect(thumbRows(scrollBar(20, 200, 180))).toEqual([18, 19])
  })

  test('the rest of the column is track', () => {
    const lines = scrollBar(20, 200, 90)
    expect(lines.filter(line => line.some(span => span.bg === SCROLL.track))).toHaveLength(18)
    expect(thumbRows(lines)).toEqual([9, 10])
  })

  test('a list that fits draws no thumb and no track', () => {
    const lines = scrollBar(20, 10, 0)
    expect(lines).toHaveLength(20)
    expect(lines.every(line => line.every(span => span.bg === undefined))).toBe(true)
  })

  test('a very long list keeps a thumb one row tall', () => {
    expect(thumbRows(scrollBar(10, 10_000, 0))).toEqual([0])
  })

  test('an offset past the end keeps the thumb on the last rows', () => {
    expect(thumbRows(scrollBar(20, 200, 500))).toEqual([18, 19])
  })

  test('every line is three cells: a blank, the bar cell, a blank', () => {
    for (const lines of [scrollBar(20, 200, 0), scrollBar(20, 200, 180), scrollBar(20, 10, 0)]) {
      for (const line of lines) expect(widthOf(line)).toBe(3)
    }
    const [first] = scrollBar(20, 200, 0)
    expect(first?.map(span => span.t)).toEqual([' ', ' ', ' '])
  })
})
