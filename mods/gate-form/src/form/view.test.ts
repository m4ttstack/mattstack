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

// Wheel `turns` notches down from the top, then back up, returning how many notches up changed nothing on screen.
function deadTurnsAfterScrolling(form: Form, width: number, rows: number, turns: number): { dead: number; last: string } {
  let s: State = { ...initial(form), wheelAt: 0 }
  const view = { width, focused: true }
  const text = (lines: { t: string }[][]) => lines.map(textOf).join('\n')
  let wheel = 0
  let shown = ''
  const turn = (by: number) => {
    wheel += by
    const f = fittedLines(form, s, view, rows, wheel)
    // As form.tsx does: a form that first lays out paged opens on its context page.
    const page = f.contextPaged && s.contextPaged === undefined ? -1 : s.page
    s = { ...s, ctxTop: f.ctxTop, wheelAt: f.wheelAt, pageTop: f.top, followed: f.followed, contextPaged: f.contextPaged === true, page }
    const now = text(f.lines)
    const moved = now !== shown
    shown = now
    return moved
  }
  for (let n = 0; n < turns; n++) turn(1)
  const last = shown
  let dead = 0
  for (let n = 0; n < 5; n++) if (!turn(-1)) dead++
  return { dead, last }
}

const longContext = Array.from({ length: 6 }, (_, n) => `Paragraph ${n + 1}. ${'word '.repeat(60).trim()} end${n + 1}`).join('\n\n')
const oneQuestion = toForm('T', longContext, [{ id: 'a', label: 'Pick one', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] }], 'ask') as Form

test('scrolling the context box to its end and back up never turns through dead rows', () => {
  expect(deadTurnsAfterScrolling(oneQuestion, 44, 30, 80).dead).toBe(0)
})

test('when the whole page scrolls on a narrow pane, the context still reaches its last line', () => {
  expect(deadTurnsAfterScrolling(oneQuestion, 30, 12, 200).last).toContain('end6')
})

const controlled = { ...(toForm('T', undefined, [{ id: 'a', label: 'Pick one', options: [{ value: 'x', label: 'X (Recommended)' }, { value: 'y', label: 'Y' }] }], 'gate') as Form), controls: { pause: true, goBack: [] } }
const open = () => perform({ type: 'menu', hit: { type: 'toggle' } }, controlled, initial(controlled))!.state

test('a one-question gate with run controls has no review page: it submits from its question, which carries More', () => {
  const text = visibleLines(controlled, initial(controlled), VIEW, ROWS).map(textOf).join('\n')
  expect(text).toContain('More ▾')
  expect(text).not.toContain('Review')
  expect(text).not.toContain('⏎')
  expect(perform({ type: 'advance' }, controlled, initial(controlled))?.post).toEqual({ type: 'answer', formId: controlled.id, answers: { a: 'x' } })
})

test("one question's Submit takes the recommended pick, with nothing clicked first", () => {
  const submit = visibleLines(controlled, initial(controlled), VIEW, ROWS).flat().find(span => span.t.trim() === 'Submit')!
  expect(perform(submit.action!, controlled, initial(controlled))?.post).toEqual({ type: 'answer', formId: controlled.id, answers: { a: 'x' } })
})

test("one question's Submit is disabled until an option is picked", () => {
  const plain = { ...controlled, questions: controlled.questions.map(q => ({ ...q, options: q.options.map(o => ({ ...o, label: o.value })) })) }
  const submitOf = (s: State) => visibleLines(plain, s, VIEW, ROWS).flat().find(span => span.t.trim() === 'Submit')!
  expect(submitOf(initial(plain)).action).toBeUndefined()
  expect(submitOf(perform({ type: 'option', idx: 1 }, plain, initial(plain))!.state).action).toBeDefined()
})

test('a More menu opened by click on a question takes the keys, and an option click closes it', () => {
  expect(visibleLines(controlled, open(), VIEW, ROWS).map(textOf).join('\n')).toContain('Pause run')
  expect(keyEffect({ key: 'return' }, controlled, open())?.post).toEqual({ type: 'answer', formId: controlled.id, answers: { next: 'hold' } })
  expect(perform({ type: 'option', idx: 1 }, controlled, open())!.state.menu.open).toBe(false)
})

test('Chat with the More menu open closes it, so Enter cannot pause the run', () => {
  for (const armed of [perform({ type: 'chat' }, controlled, open())!, keyEffect({ key: 'x', ctrl: true }, controlled, open())!]) {
    expect(armed.state.menu.open).toBe(false)
    expect(keyEffect({ key: 'return' }, controlled, armed.state)?.post).not.toMatchObject({ answers: { next: 'hold' } })
  }
})

test('a write-in clicked with the More menu open, or just closed, takes typing at once', () => {
  const form = toForm('T', undefined, [{ id: 'a', label: 'Pick one', writeIn: true, options: [{ value: 'x', label: 'X' }] }], 'gate') as Form
  const gate = { ...form, controls: { pause: true, goBack: [] } }
  const menu = perform({ type: 'menu', hit: { type: 'toggle' } }, gate, initial(gate))!.state
  const reclicked = perform({ type: 'menu', hit: { type: 'toggle' } }, gate, menu)!.state
  const backspaced = keyEffect({ key: 'backspace' }, gate, menu)!.state
  for (const before of [menu, reclicked, backspaced]) {
    const onWriteIn = perform({ type: 'option', idx: 1 }, gate, before)!.state
    expect(keyEffect({ key: 'h' }, gate, onWriteIn)!.state.text[0]).toBe('h')
  }
})

test('More clicked open and shut on a text question leaves the keys with the text', () => {
  const form = toForm('T', undefined, [{ id: 'a', label: 'Say why', writeIn: true, options: [] }], 'gate') as Form
  const gate = { ...form, controls: { pause: true, goBack: [] } }
  const toggle: Action = { type: 'menu', hit: { type: 'toggle' } }
  const shut = perform(toggle, gate, perform(toggle, gate, initial(gate))!.state)!.state
  expect(keyEffect({ key: 'h' }, gate, shut)!.state.text[0]).toBe('h')
})

test('the context page shows the armed Chat label after a first press', () => {
  const gate = { ...oneQuestion, source: 'gate' as const }
  const paged: State = { ...initial(gate), contextPaged: true, page: -1, chatArmed: true }
  expect(visibleLines(gate, paged, { width: 60, focused: true }, 14).map(textOf).join('\n')).toContain('Press again to chat')
})
