import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { SAMPLE } from '../../harness/sample-form'
import { toForm } from '../gate/parse'
import { keyEffect, perform, type Action } from './input'
import { goTo, initial, type State } from './state'
import { fittedLines, visibleLines } from './view'

const sample = toForm(SAMPLE.title, SAMPLE.context, SAMPLE.questions, 'ask') as Form
const VIEW = { width: 60, focused: true }
const ROWS = 80

const textOf = (line: { t: string }[]) => line.map(s => s.t).join('')
const pageLines = (page: number) => visibleLines(sample, goTo(sample, initial(sample), page), VIEW, ROWS)

test('Chat about this sits on the same row on every question page', () => {
  const rows = sample.questions.map((_, page) => pageLines(page).findIndex(line => textOf(line).includes('Chat about this')))
  expect(rows[0]).toBeGreaterThan(-1)
  expect(new Set(rows).size).toBe(1)
})

test('the review page has no keys hint, only its question and buttons', () => {
  const text = pageLines(sample.questions.length).map(textOf).join('\n')
  expect(text).toContain('Submit your answers?')
  expect(text).not.toContain('pages')
  expect(text).not.toContain('enter submit')
})

test('a question page has a progress line with ☐ per question, ⏎ for review and no keys hint', () => {
  const text = pageLines(0).map(textOf).join('\n')
  expect(text).not.toContain('←→ pages')
  expect(text).toContain('☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ⏎  question 1 of 8')
  expect(text).toContain('8 to answer')
})

// A short pane: the approach page (seven choices) does not fit in 24 rows, so it scrolls.
const SHORT = 24
const APPROACH = 1
const settle = (s: State, wheel?: number): State => {
  const fitted = fittedLines(sample, s, VIEW, SHORT, wheel)
  return { ...s, pageTop: fitted.top, followed: fitted.followed, wheelAt: fitted.wheelAt }
}
const down = (s: State, times: number): State => {
  let at = s
  for (let n = 0; n < times; n += 1) at = settle(keyEffect({ key: 'down' }, sample, at)!.state)
  return at
}

test('a page too tall for the pane scrolls to keep the cursor in view, with a scroll bar, cutting nothing', () => {
  const end = down(settle(goTo(sample, initial(sample), APPROACH)), 6)
  const fitted = fittedLines(sample, end, VIEW, SHORT)
  expect(fitted.lines).toHaveLength(SHORT)
  expect(fitted.top).toBeGreaterThan(0)
  const text = fitted.lines.map(textOf).join('\n')
  expect(text).toContain('Type something.')
  expect(text).not.toContain('…')
  expect(text).toContain('Chat about this')
})

test('the wheel scrolls a long page, and the cursor pulls the window back only once it moves', () => {
  const start = settle(goTo(sample, initial(sample), APPROACH), 0)
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
  const moved = settle(keyEffect({ key: 'up' }, sample, top)!.state, -500)
  expect(moved.pageTop).toBeGreaterThan(0)
})

test('on a short pane the gate context is kept, as light markdown, and the page scrolls up to it', () => {
  const s = settle(goTo(sample, initial(sample), APPROACH), 0)
  const flat = (lines: { t: string }[][]) => lines.map(textOf).join(' ').replace(/[│├└┌]/g, ' ').replace(/\s+/g, ' ')
  const context = (sample.context ?? '').split('\n').filter(line => line.trim() !== '')
  expect(context.length).toBeGreaterThan(0)
  let seen = ''
  for (let wheel = 0; wheel <= 40; wheel += 1) seen += ` ${flat(fittedLines(sample, { ...s, pageTop: 0, wheelAt: 0 }, VIEW, SHORT, wheel).lines)}`
  for (const line of context) expect(seen.replace(/\s+/g, ' ')).toContain(line.replace(/^[-\s]+/, '').replace(/:$/, '').trim())
  expect(flat(fittedLines(sample, s, VIEW, SHORT).lines)).toContain(context[0]!.trim())
})

test('the title rides in the brand bar as mattstack · title, for a plugin form and a gate or ask form alike', () => {
  const header = (form: Form) => textOf(visibleLines(form, initial(form), VIEW, ROWS)[0]!)
  expect(header({ ...sample, source: 'plugin' })).toContain(`mattstack · ${sample.title}`)
  expect(header(sample)).toContain(`mattstack · ${sample.title}`)
  expect(header(sample)).not.toContain('decision gate')
})
