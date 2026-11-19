import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { SAMPLE } from '../../harness/sample-form'
import { toForm } from '../gate/parse'
import { keyEffect, optionClick, perform } from './input'
import { answersOf, choicesOf, goTo, initial } from './state'

const sample = toForm(SAMPLE.title, SAMPLE.context, SAMPLE.questions, 'ask') as Form
const APPROACH = sample.questions.findIndex(q => q.id === 'approach')

test('the sample form builds and has an approach question', () => {
  expect(typeof sample).toBe('object')
  expect(APPROACH).toBeGreaterThan(-1)
})

test('right from a single-choice page leaves it unanswered', () => {
  const at = goTo(sample, initial(sample), APPROACH)
  const effect = keyEffect({ key: 'right' }, sample, at)
  expect(effect?.state.page).toBe(APPROACH + 1)
  expect(effect?.state.answered[APPROACH]).toBe(false)
})

test('advance on approach marks it answered with the recommended identity', () => {
  const at = goTo(sample, initial(sample), APPROACH)
  const effect = perform({ type: 'advance' }, sample, at)
  expect(effect?.state.answered[APPROACH]).toBe(true)
  expect(answersOf(sample, effect!.state).approach).toBe('identity')
})

test('Tab only looks ahead: it pages on and never answers', () => {
  const at = goTo(sample, initial(sample), APPROACH)
  const effect = keyEffect({ key: 'tab' }, sample, at)
  expect(effect?.state.page).toBe(APPROACH + 1)
  expect(effect?.state.answered).toEqual(at.answered)
})

test('shift+Tab only looks back', () => {
  const at = goTo(sample, initial(sample), APPROACH)
  const effect = keyEffect({ key: 'tab', shift: true }, sample, at)
  expect(effect?.state.page).toBe(APPROACH - 1)
  expect(effect?.state.answered).toEqual(at.answered)
})

test('advance with the cursor never moved leaves an option list with no recommendation unanswered', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ]
  const form = toForm('t', undefined, [{ id: 'pick', label: 'Pick one', options }, { id: 'other', label: 'Another', options }], 'ask') as Form
  const effect = perform({ type: 'advance' }, form, initial(form))
  expect(effect?.state.page).toBe(1)
  expect(effect?.state.answered[0]).toBe(false)
})

const writeInIdx = choicesOf(sample.questions[APPROACH]!).length - 1
const onWriteIn = () => {
  const picked = perform({ type: 'option', idx: 0 }, sample, goTo(sample, initial(sample), APPROACH))!.state
  return { ...picked, cursor: picked.cursor.map((c, i) => (i === APPROACH ? writeInIdx : c)), lastClick: undefined }
}

test('Enter on an empty write-in keeps the page, even with another option picked', () => {
  expect(keyEffect({ key: 'return' }, sample, onWriteIn())?.state.page).toBe(APPROACH)
})

test('a blank write-in is never an answer: a space alone, or text backspaced away', () => {
  const fresh = initial(sample)
  const spaced = keyEffect({ key: ' ' }, sample, { ...onWriteIn(), answered: fresh.answered, chosen: fresh.chosen })!.state
  expect(spaced.answered[APPROACH]).toBe(false)
  let typed = keyEffect({ key: 'x' }, sample, onWriteIn())!.state
  expect(answersOf(sample, typed).approach).toEqual({ writeIn: 'x' })
  typed = keyEffect({ key: 'backspace' }, sample, typed)!.state
  expect(typed.answered[APPROACH]).toBe(false)
  expect(answersOf(sample, typed).approach).toBeUndefined()
})

test('a double click on an empty write-in does not move on with the earlier pick', () => {
  const first = optionClick(sample, onWriteIn(), writeInIdx, 1000)!.state
  expect(optionClick(sample, first, writeInIdx, 1100)!.state.page).toBe(APPROACH)
})

test('a key between two clicks on the same option breaks the double click', () => {
  const clicked = perform({ type: 'option', idx: 1 }, sample, goTo(sample, initial(sample), APPROACH))!.state
  expect(clicked.lastClick).toBeDefined()
  expect(keyEffect({ key: 'down' }, sample, clicked)!.state.lastClick).toBeUndefined()
})

test('a pick-any question starts with its (Recommended) options ticked as defaults, which Next accepts', () => {
  const options = [
    { value: 'a', label: 'Alpha (Recommended)' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma (Recommended)' },
  ]
  const form = toForm('t', undefined, [{ id: 'push', label: 'Push which?', multi: true, options }, { id: 'more', label: 'More', options }], 'gate') as Form
  const s = initial(form)
  expect(s.picked[0]).toEqual(['a', 'c'])
  expect(s.answered[0]).toBe(false)
  const next = perform({ type: 'advance' }, form, s)!.state
  expect(next.answered[0]).toBe(true)
  expect(answersOf(form, next).push).toEqual(['a', 'c'])
})
