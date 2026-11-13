import { describe, expect, test } from 'bun:test'

import { widthOf, type Span } from '../draw/text'
import { revealTab, tabStrip, type Tab } from './tab-strip'

type Act = { goto: number } | { scroll: number }

const tabs: Tab<Act>[] = Array.from({ length: 10 }, (_, k) => ({ label: `Question ${k}`, isDone: false, action: { goto: k } }))
const strip = (current: number, from: number, width = 50) => tabStrip<Act>({ tabs, current, width, from, scrollTo: n => ({ scroll: n }) })
const scrolls = (line: Span<Act>[]) => line.flatMap(span => (span.action && 'scroll' in span.action ? [span.action.scroll] : []))

describe('tabStrip', () => {
  test('the right scroll mark ends exactly at width', () => {
    for (const from of [0, 3, 7]) expect(widthOf(strip(from, from))).toBe(50)
  })

  test('the window does not move while the current tab stays inside it', () => {
    expect(revealTab(tabs, 3, 50, 2)).toBe(2)
    expect(revealTab(tabs, 2, 50, 2)).toBe(2)
  })

  test('the window moves to show a current tab outside it', () => {
    expect(revealTab(tabs, 9, 50, 0)).toBeGreaterThan(0)
    expect(revealTab(tabs, 0, 50, 5)).toBe(0)
  })

  test('scroll marks act scrollTo(lo - 1) and scrollTo(lo + 1)', () => {
    expect(scrolls(strip(3, 2))).toEqual([1, 3])
  })

  test('a mark with nothing hidden that way takes no click', () => {
    expect(scrolls(strip(0, 0))).toEqual([1])
  })
})
