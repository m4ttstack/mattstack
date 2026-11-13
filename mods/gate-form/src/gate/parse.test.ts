import { expect, test } from 'bun:test'

import type { Form } from '../../types'
import { agentFields, formFromRow, gateForm, readKitResult, spilledGate } from './parse'
import { GATE_INSTRUCTION } from './reply'

const QUESTIONS = [
  { id: 'tier', label: 'Plan tier', multi: false, options: [{ value: 'std', label: 'Standard' }, { value: 'light', label: 'Light' }] },
  { id: 'why', label: 'Anything to add?', multi: false, writeIn: true, options: [{ value: 'no', label: 'No' }] },
]
const CONTROLS = { pause: true, goBack: ['plan', 'provision'] }
const KIT = { id: 'g1', presentation: 'kit', paneAction: 'kit', boardOnly: false, subject: 'run:1', supersededId: null, formChunks: [], runErrors: ['x'], kitForm: { questions: QUESTIONS, context: 'Some context', controls: CONTROLS } }

test('a kit result reads as its fields', () => {
  const read = readKitResult(JSON.stringify(KIT))
  expect(read.kind).toBe('kit')
})

test('a result without paneAction kit passes', () => {
  expect(readKitResult(JSON.stringify({ ...KIT, paneAction: 'form', kitForm: undefined })).kind).toBe('other')
  expect(readKitResult(JSON.stringify([1, 2])).kind).toBe('other')
})

test('a result that is not JSON reads as spilled', () => {
  expect(readKitResult('Output saved to /tmp/x.txt').kind).toBe('spilled')
})

test('a kit result opens a gate form with its id, controls and context', () => {
  const form = gateForm(KIT, 'plan-review') as Form
  expect(form).toMatchObject({ source: 'gate', gateId: 'g1', title: 'plan-review', context: 'Some context', controls: CONTROLS, status: 'open' })
  expect(form.questions.map(q => q.id)).toEqual(['tier', 'why'])
})

test('Something else shows only on writeIn questions of a gate', () => {
  const form = gateForm(KIT, 'plan-review') as Form
  expect(form.questions.map(q => q.other)).toEqual([false, true])
})

test('a gate that asks its own next question gets no run controls', () => {
  const withNext = { ...KIT, kitForm: { ...KIT.kitForm, questions: [...QUESTIONS, { id: 'next', label: 'Next?', multi: false, options: [{ value: 'proceed', label: 'Go' }] }] } }
  expect((gateForm(withNext, 'k') as Form).controls).toBeUndefined()
})

test('empty controls give no controls', () => {
  const none = { ...KIT, kitForm: { ...KIT.kitForm, controls: { pause: false, goBack: [] } } }
  expect((gateForm(none, 'k') as Form).controls).toBeUndefined()
})

test('the agent keeps every field but kitForm, plus the instruction', () => {
  const fields = agentFields(KIT)
  expect(fields.kitForm).toBeUndefined()
  const { kitForm: _, ...rest } = KIT
  expect(fields).toMatchObject(rest)
  expect(fields.instruction).toBe(GATE_INSTRUCTION('g1'))
  expect(GATE_INSTRUCTION('g1')).toBe('The gate is open in the kit form. Open any boards first (per `boards_to_open`), then end your turn holding at gate `g1`. The answer arrives as your next input.')
})

const ROW = { id: 'g9', kind: 'plan-review', questions: QUESTIONS, context: 'Row context', presentation: 'kit', status: 'open', nudge: { session: 'sess-1' }, openedAt: 5 }

test('a spilled result finds this session’s newest open kit gate the mod has no form for', () => {
  const gates = [ROW, { ...ROW, id: 'g10', openedAt: 9 }, { ...ROW, id: 'g11', openedAt: 12, nudge: { session: 'other' } }, { ...ROW, id: 'g12', openedAt: 15, presentation: 'wait' }, { ...ROW, id: 'g13', openedAt: 20, status: 'answered' }]
  expect(spilledGate(JSON.stringify({ ok: true, gates }), 'sess-1', [])?.id).toBe('g10')
  expect(spilledGate(JSON.stringify({ ok: true, gates }), 'sess-1', ['g10'])?.id).toBe('g9')
  expect(spilledGate('not json', 'sess-1', [])).toBeUndefined()
})

test('a listed gate opens a form with no run controls', () => {
  const form = formFromRow(ROW) as Form
  expect(form).toMatchObject({ source: 'gate', gateId: 'g9', title: 'plan-review', context: 'Row context' })
  expect(form.controls).toBeUndefined()
})
