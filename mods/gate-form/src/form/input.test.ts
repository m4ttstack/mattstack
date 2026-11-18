import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { SAMPLE } from '../../harness/sample-form'
import { toForm } from '../gate/parse'
import { keyEffect, perform } from './input'
import { answersOf, goTo, initial } from './state'

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
