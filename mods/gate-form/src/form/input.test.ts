import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { DEMO } from '../gate/demo'
import { toForm } from '../gate/parse'
import { keyEffect, perform } from './input'
import { answersOf, goTo, initial } from './state'

const demo = toForm(DEMO.title, DEMO.context, DEMO.questions, 'toast') as Form
const APPROACH = demo.questions.findIndex(q => q.id === 'approach')

test('the demo form builds and has an approach question', () => {
  expect(typeof demo).toBe('object')
  expect(APPROACH).toBeGreaterThan(-1)
})

test('right from a single-choice page leaves it unanswered', () => {
  const at = goTo(demo, initial(demo), APPROACH)
  const effect = keyEffect({ key: 'right' }, demo, at)
  expect(effect?.state.page).toBe(APPROACH + 1)
  expect(effect?.state.answered[APPROACH]).toBe(false)
})

test('advance on approach marks it answered with the recommended identity', () => {
  const at = goTo(demo, initial(demo), APPROACH)
  const effect = perform({ type: 'advance' }, demo, at)
  expect(effect?.state.answered[APPROACH]).toBe(true)
  expect(answersOf(demo, effect!.state).approach).toBe('identity')
})

test('Tab acts like advance', () => {
  const at = goTo(demo, initial(demo), APPROACH)
  expect(keyEffect({ key: 'tab' }, demo, at)?.state).toEqual(perform({ type: 'advance' }, demo, at)?.state)
})

test('shift+Tab only looks back', () => {
  const at = goTo(demo, initial(demo), APPROACH)
  const effect = keyEffect({ key: 'tab', shift: true }, demo, at)
  expect(effect?.state.page).toBe(APPROACH - 1)
  expect(effect?.state.answered).toEqual(at.answered)
})

test('advance with the cursor never moved leaves an option list with no recommendation unanswered', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ]
  const form = toForm('t', undefined, [{ id: 'pick', label: 'Pick one', options }], 'toast') as Form
  const effect = perform({ type: 'advance' }, form, initial(form))
  expect(effect?.state.page).toBe(1)
  expect(effect?.state.answered[0]).toBe(false)
})
