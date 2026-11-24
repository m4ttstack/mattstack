import { expect, test } from 'bun:test'
import { widthOf } from '@mattstack/mod-kit'

import type { Form } from '../../types'
import { gateForm } from '../gate/parse'
import { keyEffect, perform, type Action, type Effect } from './input'
import { afterAttempt, goTo, initial, type State } from './state'
import { visibleLines } from './view'

const QUESTIONS = [
  { id: 'tier', label: 'Plan tier', multi: false, options: [{ value: 'std', label: 'Standard' }, { value: 'light', label: 'Light' }] },
  { id: 'why', label: 'Anything to add?', multi: false, writeIn: true, options: [{ value: 'no', label: 'No' }] },
]
const kitResult = (controls: { pause: boolean; goBack: string[] }) => ({ id: 'g1', paneAction: 'kit', kitForm: { questions: QUESTIONS, controls } })
const gate = gateForm(kitResult({ pause: true, goBack: ['plan', 'provision', 'implement'] }), 'plan-review') as Form
const bare = gateForm(kitResult({ pause: false, goBack: [] }), 'plan-review') as Form
const REVIEW = gate.questions.length

const textOf = (line: { t: string }[]) => line.map(s => s.t).join('')
const linesAt = (form: Form, s: State, width = 70) => visibleLines(form, s, { width, focused: true }, 80)
const screen = (form: Form, s: State, width = 70) => linesAt(form, s, width).map(textOf).join('\n')
const atReview = (form: Form) => goTo(form, initial(form), form.questions.length)
const answeredAll = (form: Form): State => ({ ...atReview(form), answered: form.questions.map(() => true), chosen: ['std', 'no'] })
const run = (form: Form, s: State, ...actions: Action[]): Effect | undefined =>
  actions.reduce<Effect | undefined>((effect, action) => (effect ? perform(action, form, effect.state) ?? { state: effect.state } : undefined), { state: s })
const keys = (form: Form, s: State, ...names: string[]): Effect | undefined =>
  names.reduce<Effect | undefined>((effect, key) => (effect ? keyEffect({ key }, form, effect.state) ?? { state: effect.state, post: effect.post } : undefined), { state: s })

test('Type something shows only on the writeIn question', () => {
  expect(screen(gate, goTo(gate, initial(gate), 0))).not.toContain('Type something.')
  expect(screen(gate, goTo(gate, initial(gate), 1))).toContain('Type something.')
})

test('Submit is disabled until every question is answered', () => {
  const s = atReview(gate)
  expect(perform({ type: 'send' }, gate, s)).toBeUndefined()
  expect(keyEffect({ key: 'return' }, gate, s)?.post).toBeUndefined()
  const nav = linesAt(gate, s).find(line => textOf(line).includes('Chat about this'))
  const submit = nav?.find(span => span.t.trim() === 'Submit')
  expect(submit).toBeDefined()
  expect(submit?.action).toBeUndefined()
  const sent = keyEffect({ key: 'return' }, gate, answeredAll(gate))
  expect(sent?.post).toEqual({ type: 'answer', formId: gate.id, answers: { tier: 'std', why: 'no' } })
})

test('More offers Pause run and a Go back to stage heading with one row per stage', () => {
  const s = atReview(gate)
  expect(screen(gate, s)).toContain('More ▾')
  const open = run(gate, s, { type: 'menu', hit: { type: 'toggle' } })!.state
  expect(screen(gate, open)).toContain('Pause run')
  expect(screen(gate, open)).toContain('Go back to stage')
  expect(screen(gate, open)).not.toContain('▸')
  for (const stage of ['plan', 'provision', 'implement']) expect(screen(gate, open)).toContain(stage)
})

test('More is absent when the gate offers no run controls', () => {
  expect(screen(bare, atReview(bare))).not.toContain('More')
})

test('Pause run sends only next: hold', () => {
  const picked = run(gate, atReview(gate), { type: 'menu', hit: { type: 'toggle' } }, { type: 'menu', hit: { type: 'row', at: 0 } })
  expect(picked?.post).toEqual({ type: 'answer', formId: gate.id, answers: { next: 'hold' } })
  expect(picked?.state.phase).toBe('submitted')
})

test('Go back to stage plan sends next: go-back with to: plan', () => {
  const picked = run(gate, atReview(gate), { type: 'menu', hit: { type: 'toggle' } }, { type: 'menu', hit: { type: 'row', at: 2 } })
  expect(picked?.post).toEqual({ type: 'answer', formId: gate.id, answers: { next: 'go-back', to: 'plan' } })
})

test('keyboard: left selects More, Enter opens it, arrows move past the heading, Enter picks', () => {
  const picked = keys(gate, atReview(gate), 'left', 'return', 'down', 'down', 'return')
  expect(picked?.post).toEqual({ type: 'answer', formId: gate.id, answers: { next: 'go-back', to: 'provision' } })
})

test('keyboard: left closes the menu, then pages back from More, the first button', () => {
  const open = keys(gate, atReview(gate), 'left', 'return')!.state
  expect(open.menu.open).toBe(true)
  const closed = keyEffect({ key: 'left' }, gate, open)!.state
  expect(keyEffect({ key: 'backspace' }, gate, open)!.state.menu.open).toBe(false)
  expect(closed.menu.open).toBe(false)
  expect(closed.page).toBe(REVIEW)
  expect(keyEffect({ key: 'left' }, gate, closed)!.state.page).toBe(REVIEW - 1)
})

test('the review page has no Back button: left from the first button pages back, right stays, Enter submits', () => {
  const s = answeredAll(bare)
  const nav = linesAt(bare, s).find(line => textOf(line).includes('Submit'))!
  expect(textOf(nav)).not.toContain('Back')
  const back = keyEffect({ key: 'left' }, bare, s)!.state
  expect(back.page).toBe(REVIEW - 1)
  expect(back.onNav).toBeUndefined()
  expect(keyEffect({ key: 'right' }, bare, s)!.state.page).toBe(REVIEW)
  expect(keyEffect({ key: 'return' }, bare, s)?.post).toEqual({ type: 'answer', formId: bare.id, answers: { tier: 'std', why: 'no' } })
})

for (const [name, form] of [['with', gate], ['without', bare]] as const) {
  for (const width of [70, 40]) {
    test(`Submit starts in the column Next and Review did, ${name} run controls, at ${width} columns`, () => {
      const columnOf = (page: number, word: string) => {
        const row = linesAt(form, { ...answeredAll(form), page }, width).map(textOf).findLast(line => line.includes(word))!
        return row.indexOf(word)
      }
      expect(columnOf(0, 'Next →')).toBe(columnOf(1, 'Review →'))
      expect(columnOf(REVIEW, 'Submit')).toBe(columnOf(1, 'Review →'))
    })
  }
}

test('a question page keeps its Back button', () => {
  expect(screen(gate, goTo(gate, initial(gate), 1))).toContain('Back')
})

test('Ctrl-X twice on a gate form sets it aside and keeps it open', () => {
  const s = goTo(gate, initial(gate), 0)
  const armed = keyEffect({ key: 'x', ctrl: true }, gate, s)!
  const aside = keyEffect({ key: 'x', ctrl: true }, gate, armed.state)!
  expect(aside.post).toMatchObject({ type: 'chat', formId: gate.id })
  expect(aside.state.phase).toBe('active')
})

test('a failed answer puts the form back in play with its picks', () => {
  const sent = keyEffect({ key: 'return' }, gate, answeredAll(gate))!.state
  expect(sent.phase).toBe('submitted')
  expect(afterAttempt(gate, sent)).toBe(sent)
  const failed = { ...gate, error: 'gate g1 is closed (abandoned)', attempt: 1 }
  const back = afterAttempt(failed, sent)
  expect(back.phase).toBe('active')
  expect(back.answered).toEqual(sent.answered)
  expect(screen(failed, back)).toContain('gate g1 is closed (abandoned)')
})

for (const width of [76, 40]) {
  test(`at ${width} columns every line fits with the menu open`, () => {
    const open = run(gate, atReview(gate), { type: 'menu', hit: { type: 'toggle' } })!.state
    const lines = linesAt(gate, open, width)
    for (const line of lines) expect(widthOf(line), textOf(line)).toBeLessThanOrEqual(width)
    expect(lines.map(textOf).join('\n')).toContain('implement')
    for (let page = 0; page < gate.questions.length; page += 1) {
      for (const line of linesAt(gate, goTo(gate, initial(gate), page), width)) expect(widthOf(line), textOf(line)).toBeLessThanOrEqual(width)
    }
  })
}
