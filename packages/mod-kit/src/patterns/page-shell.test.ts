import { expect, test } from 'bun:test'

import { sp, type Line } from '../draw/text'
import { fitToRows, navRow, padToHeight, reviewList, type Drawn } from './page-shell'

const line = (t: string): Line<never> => [sp(t)]
const lines = (...ts: string[]) => ts.map(line)
const text = (ls: Line<unknown>[]) => ls.map(l => l.map(s => s.t).join(''))
const FILLER = line('|')

test('padToHeight pads a 3-line page to 7', () => {
  const padded = padToHeight(lines('a', 'b', 'c'), 7, FILLER)
  expect(text(padded)).toEqual(['a', 'b', 'c', '|', '|', '|', '|'])
})

test('padToHeight never trims a page already taller', () => {
  const page = lines('a', 'b', 'c', 'd')
  expect(text(padToHeight(page, 2, FILLER))).toEqual(['a', 'b', 'c', 'd'])
})

test('padToHeight gives each filler row a line of its own', () => {
  const [, first, second] = padToHeight(lines('a'), 3, FILLER)
  expect(first).not.toBe(second)
})

const drawn = (head: number, page: number, foot: number): Drawn<never> => ({
  head: lines(...Array.from({ length: head }, (_, i) => `h${i}`)),
  page: lines(...Array.from({ length: page }, (_, i) => `p${i}`)),
  foot: lines(...Array.from({ length: foot }, (_, i) => `f${i}`)),
})

test('fitToRows keeps a drawing that fits, head then page then foot', () => {
  const fitted = fitToRows(drawn(2, 2, 1), 20, () => drawn(0, 0, 0))
  expect(text(fitted)).toEqual(['h0', 'h1', 'p0', 'p1', 'f0'])
})

test('fitToRows redraws without context when the body overflows', () => {
  const redrawn = drawn(1, 2, 1)
  const fitted = fitToRows(drawn(8, 5, 2), 10, () => redrawn)
  expect(text(fitted)).toEqual(['h0', 'p0', 'p1', 'f0'])
})

test('fitToRows cuts the start of the body when even the redraw overflows', () => {
  const fitted = fitToRows(drawn(2, 10, 2), 8, () => drawn(2, 10, 2))
  expect(fitted).toHaveLength(8)
  expect(text(fitted).slice(0, 2)).toEqual(['h0', 'h1'])
  expect(text(fitted).at(-1)).toBe('f1')
})

test('fitToRows pads the page to the wanted height, room allowing', () => {
  const fitted = fitToRows(drawn(1, 2, 1), 20, () => drawn(0, 0, 0), { height: 5, filler: FILLER })
  expect(text(fitted)).toEqual(['h0', 'p0', 'p1', '|', '|', '|', 'f0'])
})

test('fitToRows pads no further than the room leaves', () => {
  const fitted = fitToRows(drawn(1, 2, 1), 8, () => drawn(0, 0, 0), { height: 50, filler: FILLER })
  expect(fitted).toHaveLength(8)
  expect(text(fitted).at(-1)).toBe('f0')
})

test('navRow puts the back and next buttons left and the aside button at the right edge', () => {
  const row = navRow({ back: { label: 'Back', action: 'back' }, next: { label: 'Next', action: 'next' }, aside: { label: 'Chat', action: 'chat' } }, 60)
  const shown = row.map(s => s.t).join('')
  expect(shown.indexOf('Back')).toBeLessThan(shown.indexOf('Next'))
  expect(shown.indexOf('Next')).toBeLessThan(shown.indexOf('Chat'))
  expect(shown).toHaveLength(60)
  expect(row.at(-1)?.action).toBe('chat')
  expect(row.map(s => s.action).filter(Boolean)).toEqual(['back', 'next', 'chat'])
})

test('reviewList marks each item done or not and makes open items clickable', () => {
  const items = [
    { label: 'Pick one', summary: 'Yes', action: 'go-1' },
    { label: 'Pick two', action: 'go-2' },
  ]
  const shown = reviewList(items, 40)
  expect(text(shown).join('\n')).toContain('not answered')
  expect(shown.filter(l => l.action === 'go-1').length).toBeGreaterThan(0)
  expect(shown.filter(l => l.action === 'go-2').length).toBeGreaterThan(0)
  expect(reviewList(items.map(i => ({ label: i.label, summary: i.summary })), 40).some(l => l.action !== undefined)).toBe(false)
})
