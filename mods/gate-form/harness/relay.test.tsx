import { expect, test } from 'claude-code/testing'

import { ABOVE, type Engine, PANE, PRESENT, drawOn, eventually, formOf, ok, relayResult, resultText, rowsOf, world } from './world'

const present = ($: Engine, gate: string) => $.tool.call({ tool: PRESENT, herd: 'hd-1', gate } as never)
const presentEach = { reply: (input: Record<string, unknown>) => ({ text: JSON.stringify(relayResult(String(input.gate))) }) }
const answeredBy = (id: string, by: string, session?: string) =>
  JSON.stringify({ ok: true, status: 'answered', row: { id, status: 'answered', answer: { answers: {}, by, answeredAt: 2, ...(session ? { session } : {}) } } })
const waitsFor = (w: ReturnType<typeof world>, id: string) => w.waits.filter(x => x.argv.slice(1).join(' ') === `gate wait ${id}`)

async function paneForm($: Engine) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const form = await formOf(pane)
  await pane.unmount()
  return form as (Awaited<ReturnType<typeof formOf>> & { relay?: true }) | undefined
}

test('herd_gate_present opens a relayed form, and the agent gets the relay instruction and no form', async ($, on) => {
  const w = world(on, presentEach)
  await drawOn($, 'terminal')
  const out = await present($, 'g1')
  expect(w.calls[0]).not.toHaveProperty('kitForm')
  const fields = JSON.parse(resultText(out))
  expect(fields.kitForm).toBeUndefined()
  expect(fields.instruction).toContain('queued in your kit form')
  expect(await paneForm($)).toMatchObject({ gateId: 'g1', status: 'open', relay: true })
})

test('three presents in one turn queue three forms, the first on screen', async ($, on) => {
  const w = world(on, presentEach)
  await drawOn($, 'terminal')
  for (const id of ['g1', 'g2', 'g3']) await present($, id)
  expect((await paneForm($))!.gateId).toBe('g1')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const id of ['g1', 'g2', 'g3']) {
    expect((await formOf(pane))!.gateId).toBe(id)
    await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  }
  await pane.unmount()
  expect(w.ran.map(argv => argv[3])).toEqual(['g1', 'g2', 'g3'])
})

test('presenting a queued gate again leaves one form for it', async ($, on) => {
  const w = world(on, presentEach)
  await drawOn($, 'terminal')
  await present($, 'g1')
  await present($, 'g2')
  await present($, 'g1')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const seen: string[] = []
  for (let i = 0; i < 3; i++) {
    const form = await formOf(pane)
    if (!form || form.status !== 'open') break
    seen.push(form.gateId!)
    await pane.post({ type: 'answer', formId: form.id, answers: { tier: 'std', why: 'no' } })
  }
  await pane.unmount()
  expect(seen.sort()).toEqual(['g1', 'g2'])
  expect(w.ran.length).toBe(2)
})

test('a relayed answer runs rt gate answer --by shepherd and submits no prompt', async ($, on) => {
  const w = world(on, presentEach)
  await drawOn($, 'terminal')
  await present($, 'g1')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  expect(w.ran).toEqual([['rt', 'gate', 'answer', 'g1', '--answers', JSON.stringify({ tier: 'std', why: 'no' }), '--by', 'shepherd', '--session', 'sess-kit']])
  expect((await formOf(pane))!.status).toBe('answered')
  await pane.unmount()
  expect(w.sent).toEqual([])
})

test('a lost race to the shepherd’s own earlier answer counts as recorded', async ($, on) => {
  const w = world(on, {
    ...presentEach,
    rt: () => ok(JSON.stringify({ ok: true, conflict: true, row: { id: 'g1', status: 'answered', answer: { answers: {}, by: 'shepherd', session: 'sess-kit', answeredAt: 1 } } })),
  })
  await drawOn($, 'terminal')
  await present($, 'g1')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  const form = (await formOf(pane))!
  await pane.unmount()
  expect(form.status).toBe('answered')
  expect(form.note).toBeUndefined()
  expect(w.sent).toEqual([])
})

test('a relayed gate answered on the board leaves the queue and submits no prompt', async ($, on) => {
  const w = world(on, { ...presentEach, holdWaits: true })
  await drawOn($, 'terminal')
  await present($, 'g1')
  await present($, 'g2')
  await eventually(() => w.waits.length === 2)
  await waitsFor(w, 'g1')[0]!.end(answeredBy('g1', 'board'))
  expect(await eventually(async () => (await paneForm($))?.gateId === 'g2')).toBe(true)
  expect(w.sent).toEqual([])
  expect(w.ran).toEqual([])
})

test('a relayed gate the shepherd answered with herd_gate_answer closes without waking anyone', async ($, on) => {
  const w = world(on, { ...presentEach, holdWaits: true })
  await drawOn($, 'terminal')
  await present($, 'g1')
  await eventually(() => w.waits.length === 1)
  await w.waits[0]!.end(answeredBy('g1', 'shepherd', 'sess-kit'))
  expect(await eventually(async () => (await paneForm($))?.status === 'answered')).toBe(true)
  expect((await paneForm($))!.note).toBeUndefined()
  expect(w.sent).toEqual([])
})

test('a relayed gate the form cannot draw passes through untouched, with no band, so the shepherd falls back to AskUserQuestion', async ($, on) => {
  const broken = { ...relayResult('g1'), kitForm: { questions: [], controls: { pause: false, goBack: [] } } }
  const w = world(on, { reply: () => ({ text: JSON.stringify(broken) }) })
  await drawOn($, 'terminal')
  const out = await present($, 'g1')
  expect(JSON.parse(resultText(out))).toEqual(broken)
  expect(w.panes.size).toBe(0)
  expect(w.toasts).toEqual([])
  expect(w.waits).toEqual([])
})

test('a spilled relay result passes through untouched and draws nothing', async ($, on) => {
  const w = world(on, { reply: () => ({ text: 'Output saved to /tmp/spill.json' }), files: { '/tmp/spill.json': JSON.stringify(relayResult('g1')) } })
  await drawOn($, 'terminal')
  const out = await present($, 'g1')
  expect(resultText(out)).toBe('Output saved to /tmp/spill.json')
  expect(w.panes.size).toBe(0)
  expect(w.ran).toEqual([])
})

test('a board-only presented gate puts its band in the shepherd’s pane, named by the gate’s kind, and passes through', async ($, on) => {
  const board = { id: 'g1', kind: 'respond-plan', subject: 'run:9', presentation: 'wait', paneAction: 'wait', boardOnly: true }
  const w = world(on, { reply: () => ({ text: JSON.stringify(board) }) })
  await drawOn($, 'terminal')
  const out = await present($, 'g1')
  expect(JSON.parse(resultText(out))).toEqual(board)
  expect(w.panes.size).toBe(0)
  const band = await $.ui.mount({ ...ABOVE, surface: 'terminal' })
  const key = (await band.find({ type: 'Client' }))!.key!
  expect((await rowsOf(band, key)).join('\n')).toContain('Respond plan is waiting on the board')
  await band.unmount()
})

test('presenting a gate already on screen keeps that form, picks and all', async ($, on) => {
  world(on, presentEach)
  await drawOn($, 'terminal')
  await present($, 'g1')
  const before = (await paneForm($))!.id
  const out = await present($, 'g1')
  expect(JSON.parse(resultText(out)).instruction).toContain('queued in your kit form')
  expect((await paneForm($))!.id).toBe(before)
})

test('with rt.gates.kitForm off, herd_gate_present passes through untouched', async ($, on) => {
  const w = world(on, { ...presentEach, setting: 'off' })
  await drawOn($, 'terminal')
  const out = await present($, 'g1')
  expect(JSON.parse(resultText(out))).toEqual(relayResult('g1'))
  expect(w.panes.size).toBe(0)
})
