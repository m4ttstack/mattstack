import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { DEMO } from '../gate/demo'
import { toForm } from '../gate/parse'
import { perform, type Action } from './input'
import { goTo, initial } from './state'
import { visibleLines } from './view'

const demo = toForm(DEMO.title, DEMO.context, DEMO.questions, 'toast') as Form
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

test('the review page has no hint line', () => {
  const text = pageLines(demo.questions.length).map(textOf).join('\n')
  expect(text).toContain('Submit your answers?')
  expect(text).not.toContain('pages')
  expect(text).not.toContain('click the form')
})

test('a question page has the hint line', () => {
  expect(pageLines(0).map(textOf).join('\n')).toContain('←→ pages')
})
