import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { DEMO } from '../gate/demo'
import { toForm } from '../gate/parse'
import { keyEffect, perform, type Action } from './input'
import { goTo, initial, type State } from './state'
import { fittedLines, visibleLines } from './view'

const demo = toForm(DEMO.title, DEMO.context, DEMO.questions, 'demo') as Form
const VIEW = { width: 60, focused: true }
const ROWS = 80

const textOf = (line: { t: string }[]) => line.map(s => s.t).join('')
const pageLines = (page: number) => visibleLines(demo, goTo(demo, initial(demo), page), VIEW, ROWS)

test('Chat about this sits on the same row on every question page', () => {
  const rows = demo.questions.map((_, page) => pageLines(page).findIndex(line => textOf(line).includes('Chat about this')))
  expect(rows[0]).toBeGreaterThan(-1)
  expect(new Set(rows).size).toBe(1)
})

test('the N chip on the tab strip scrolls one tab and keeps the page', () => {
  const s = goTo(demo, initial(demo), 2)
  const chip = visibleLines(demo, s, VIEW, ROWS)
    .flat()
    .find(span => span.t.includes('›') && span.action?.type === 'scroll-tabs')
  expect(chip).toBeDefined()
  const effect = perform(chip!.action as Action, demo, s)
  expect(effect?.state.tabsFrom).toBe(s.tabsFrom + 1)
  expect(effect?.state.page).toBe(2)
})

test('the review page hints at its buttons, not at pages', () => {
  const text = pageLines(demo.questions.length).map(textOf).join('\n')
  expect(text).toContain('Submit your answers?')
  expect(text).not.toContain('pages')
  expect(text).toContain('enter presses')
})

test('a question page has the hint line', () => {
  expect(pageLines(0).map(textOf).join('\n')).toContain('←→ pages')
})

// A short pane: the approach page (seven choices) does not fit in 24 rows, so it scrolls.
const SHORT = 24
const APPROACH = 1
const settle = (s: State, wheel?: number): State => {
  const fitted = fittedLines(demo, s, VIEW, SHORT, wheel)
  return { ...s, pageTop: fitted.top, followed: fitted.followed, wheelAt: fitted.wheelAt }
}
const down = (s: State, times: number): State => {
  let at = s
  for (let n = 0; n < times; n += 1) at = settle(keyEffect({ key: 'down' }, demo, at)!.state)
  return at
}

test('a page too tall for the pane scrolls to keep the cursor in view, with a scroll bar, cutting nothing', () => {
  const end = down(settle(goTo(demo, initial(demo), APPROACH)), 6)
  const fitted = fittedLines(demo, end, VIEW, SHORT)
  expect(fitted.lines).toHaveLength(SHORT)
  expect(fitted.top).toBeGreaterThan(0)
  const text = fitted.lines.map(textOf).join('\n')
  expect(text).toContain('Something else')
  expect(text).not.toContain('…')
  expect(text).toContain('Chat about this')
})

test('the wheel scrolls a long page, and the cursor pulls the window back only once it moves', () => {
  const start = settle(goTo(demo, initial(demo), APPROACH), 0)
  const from = start.pageTop ?? 0
  const wheeled = settle(start, 5)
  expect(wheeled.pageTop).toBe(from + 5)
  // A redraw with no new wheel turn keeps the wheel's place.
  expect(settle(wheeled, 5).pageTop).toBe(from + 5)
  // Past the end it stops at the last row.
  expect(settle(wheeled, 500).pageTop).toBeLessThan(500)
  // At the last choice, the wheel back to the top leaves the cursor below the window until the cursor moves.
  const last = down(start, 6)
  const top = settle({ ...last, wheelAt: 0 }, -500)
  expect(top.pageTop).toBe(0)
  const moved = settle(keyEffect({ key: 'up' }, demo, top)!.state, -500)
  expect(moved.pageTop).toBeGreaterThan(0)
})

test('on a short pane the gate context is kept, wrapped in full, and the page scrolls up to it', () => {
  const s = settle(goTo(demo, initial(demo), APPROACH), 0)
  const flat = (lines: { t: string }[][]) => lines.map(textOf).join(' ').replace(/[│├└┌]/g, ' ').replace(/\s+/g, ' ')
  const context = (demo.context ?? '').split('\n').filter(line => line.trim() !== '')
  expect(context.length).toBeGreaterThan(0)
  let seen = ''
  for (let wheel = 0; wheel <= 40; wheel += 1) seen += ` ${flat(fittedLines(demo, { ...s, pageTop: 0, wheelAt: 0 }, VIEW, SHORT, wheel).lines)}`
  for (const line of context) expect(seen.replace(/\s+/g, ' ')).toContain(line.replace(/^[-\s]+/, '').trim())
  expect(flat(fittedLines(demo, s, VIEW, SHORT).lines)).toContain(context[0]!.trim())
})
