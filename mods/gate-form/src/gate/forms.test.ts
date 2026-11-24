import { expect, test } from 'bun:test'

import type { Form, LegacyForm } from '../../types'
import { addForm, currentForm, fitForm, fromLegacy, knownForms, markGate, openCount, patchForm, waitingTitle } from './forms'

const form = (id: string, over: Partial<Form> = {}): Form => ({ id, title: id, questions: [], status: 'open', source: 'gate', gateId: `g-${id}`, ...over })

test('two gates in a row queue in open order, and the first open one is current', () => {
  const list = addForm(addForm([], form('a')), form('b'))
  expect(list.map(f => f.id)).toEqual(['a', 'b'])
  expect(currentForm(list)?.id).toBe('a')
  expect(openCount(list)).toBe(2)
})

test('a gate that supersedes another replaces that gate’s form in its place', () => {
  const list = addForm(addForm(addForm([], form('a')), form('b')), form('c', { gateId: 'g-c' }), 'g-a')
  expect(list.map(f => f.id)).toEqual(['c', 'b'])
})

test('a second form for the same gate replaces the first', () => {
  const list = addForm(addForm([], form('a')), form('a2', { gateId: 'g-a' }))
  expect(list.map(f => f.id)).toEqual(['a2'])
})

test('closed forms are dropped when a new one opens; with none open, the last one is current', () => {
  const answered = patchForm(addForm([], form('a')), 'a', { status: 'answered' })
  expect(currentForm(answered)?.id).toBe('a')
  expect(openCount(answered)).toBe(0)
  expect(addForm(answered, form('b')).map(f => f.id)).toEqual(['b'])
})

test('waitingTitle is null with no open form, the current title alone, and counts the rest', () => {
  expect(waitingTitle([])).toBeNull()
  expect(waitingTitle([form('a')])).toBe('a')
  expect(waitingTitle([form('a'), form('b')])).toBe('a, 1 more waiting')
  expect(waitingTitle([form('a', { status: 'answered' }), form('b', { status: 'cancelled' })])).toBeNull()
})

test('markGate patches only that gate’s form', () => {
  const list = markGate(addForm(addForm([], form('a')), form('b')), 'g-b', { status: 'answered', note: 'Answered on the board' })
  expect(list.map(f => [f.id, f.status])).toEqual([
    ['a', 'open'],
    ['b', 'answered'],
  ])
  expect(list[1]!.note).toBe('Answered on the board')
})

test('a stored form-3 value loads as a one-entry ask list with its Something else rows kept', () => {
  const old = { id: 'f1', title: 'Old', questions: [{ id: 'q', header: 'q', label: 'Q', multi: false, writeIn: false, options: [{ value: 'a', label: 'A' }] }], status: 'open', replyTo: 'agent' } satisfies LegacyForm
  const loaded = fromLegacy(old)
  expect(loaded).toHaveLength(1)
  expect(loaded[0]).toMatchObject({ id: 'f1', source: 'ask', status: 'open' })
  expect(loaded[0]!.questions[0]!.other).toBe(true)
  expect(fromLegacy(null)).toEqual([])
})

test('a stored demo form is dropped, whether form-3 or listed', () => {
  const old = { id: 'f1', title: 'Old', questions: [], status: 'open', replyTo: 'toast' } satisfies LegacyForm
  expect(fromLegacy(old)).toEqual([])
  const demo = { ...form('d'), source: 'demo' } as unknown as Form
  expect(knownForms([form('a'), demo]).map(f => f.id)).toEqual(['a'])
})

test('a form too large for a Client’s props sheds option descriptions, then question contexts, then its context', () => {
  const big = 'x'.repeat(400)
  const options = Array.from({ length: 5 }, (_, k) => ({ value: `v${k}`, label: 'L', description: big }))
  const questions = Array.from({ length: 4 }, (_, i) => ({ id: `q${i}`, header: `q${i}`, label: 'Q', multi: false, writeIn: false, other: false, context: big, options }))
  const whole = form('a', { questions, context: big })
  expect(fitForm(whole, 1_000_000)).toBe(whole)
  const noDescriptions = fitForm(whole, 5_000)
  expect(noDescriptions.questions[0]!.options[0]!.description).toBeUndefined()
  expect(noDescriptions.questions[0]!.context).toBe(big)
  const noContexts = fitForm(whole, 2_000)
  expect(noContexts.questions[0]!.context).toBeUndefined()
  expect(noContexts.context).toBe(big)
  const bare = fitForm(whole, 1_200)
  expect(bare.context).toBeUndefined()
  expect(JSON.stringify(bare).length).toBeLessThanOrEqual(1_200)
})
