import { expect, test } from 'claude-code/testing'

import { ABOVE, ASK, HOME, OPEN, PANE, QUESTIONS, SESSION, ask, drawOn, failed, formOf, kitResult, ok, resultText, rowsOf, startSession, world } from './world'

for (const surface of ['terminal', 'desktop'] as const) {
  test(`gate_ask and gate_open carry kitForm: true on ${surface}`, async ($, on) => {
    const w = world(on)
    await drawOn($, surface)
    await ask($)
    await $.tool.call({ tool: OPEN, kind: 'plan-review', sourcePath: '/x.json' } as never)
    expect(w.calls.map(c => c.kitForm)).toEqual([true, true])
  })
}

for (const surface of ['vscode', 'mobile'] as const) {
  test(`nothing is added on ${surface}, and the result passes unchanged`, async ($, on) => {
    const w = world(on)
    await drawOn($, surface)
    const out = await ask($)
    expect(w.calls[0]!.kitForm).toBeUndefined()
    expect(JSON.parse(resultText(out)).kitForm).toBeDefined()
    expect(w.panes.size).toBe(0)
  })
}

test('nothing is added before any surface is recorded', async ($, on) => {
  const w = world(on)
  await startSession($)
  await ask($)
  expect(w.calls[0]!.kitForm).toBeUndefined()
})

for (const setting of ['off', 'unreadable', 'missing'] as const) {
  test(`with rt.gates.kitForm ${setting}, the tool input is unchanged`, async ($, on) => {
    const w = world(on, { setting })
    await drawOn($, 'terminal')
    await ask($)
    expect(w.calls[0]).not.toHaveProperty('kitForm')
    expect(w.state.settingReads).toBe(1)
  })
}

test('nothing is added before the session start has read the setting', async ($, on) => {
  const w = world(on)
  const band = await $.ui.mount({ ...ABOVE, surface: 'terminal' })
  await band.unmount()
  await ask($)
  expect(w.calls[0]).not.toHaveProperty('kitForm')
  expect(w.state.settingReads).toBe(0)
})

test('a new session start reads the setting again', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await ask($)
  w.state.setting = 'off'
  await startSession($)
  await ask($)
  expect(w.calls.map(c => c.kitForm)).toEqual([true, undefined])
  expect(w.state.settingReads).toBe(2)
})

test('nothing is added for a subagent', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await $.tool.call({ tool: ASK, questions: QUESTIONS, agentId: 'sub-1' } as never)
  expect(w.calls[0]!.kitForm).toBeUndefined()
})

test('nothing is added to a gate_open handBack', async ($, on) => {
  const w = world(on, { reply: () => ({ text: JSON.stringify({ open: {} }) }) })
  await drawOn($, 'terminal')
  await $.tool.call({ tool: OPEN, kind: 'plan-review', sourcePath: '/x.json', handBack: true } as never)
  expect(w.calls[0]!.kitForm).toBeUndefined()
})

test('a kit result opens a gate form and the agent gets every field but kitForm, plus the instruction', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  const out = await ask($)
  const fields = JSON.parse(resultText(out))
  expect(fields.kitForm).toBeUndefined()
  expect(fields).toMatchObject({ id: 'g1', paneAction: 'kit', boardOnly: false, subject: 'run:1', formChunks: [] })
  expect(fields.instruction).toContain('The gate is open in the kit form.')
  expect([...w.panes.keys()]).toEqual(['gate-form'])
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await formOf(pane)).toMatchObject({ gateId: 'g1', status: 'open' })
  await pane.unmount()
})

test('a takeover that fails hands the agent the tool’s own result, and the gate is asked once', async ($, on) => {
  const w = world(on, { openFails: true })
  await drawOn($, 'terminal')
  const out = await ask($)
  expect(JSON.parse(resultText(out))).toEqual(kitResult('g1'))
  expect(w.calls).toHaveLength(1)
})

test('a result that is not kit passes through unchanged', async ($, on) => {
  const text = JSON.stringify({ id: 'g2', paneAction: 'form', formChunks: [[]] })
  const w = world(on, { reply: () => ({ text }) })
  await drawOn($, 'terminal')
  const out = await ask($)
  expect(resultText(out)).toBe(text)
  expect(w.panes.size).toBe(0)
})

test('a spilled result reads the gate from rt gate list', async ($, on) => {
  const row = { id: 'g7', kind: 'plan-review', questions: QUESTIONS, context: null, presentation: 'kit', status: 'open', nudge: { session: SESSION }, openedAt: 3 }
  const w = world(on, {
    reply: () => ({ text: 'Output too large; saved to /tmp/out.txt' }),
    rt: argv => (argv[1] === 'gate' && argv[2] === 'list' ? ok(JSON.stringify({ ok: true, gates: [row] })) : { deny: 'unexpected' }),
  })
  await drawOn($, 'terminal')
  const out = await ask($)
  expect(w.ran[0]!.slice(1)).toEqual(['gate', 'list', '--open', '--json'])
  expect(resultText(out)).toContain('Output too large; saved to /tmp/out.txt')
  expect(resultText(out)).toContain('end your turn holding at gate `g7`')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await formOf(pane)).toMatchObject({ gateId: 'g7' })
  await pane.unmount()
})

test('rt is tried on PATH first, then under ~/.local/bin', async ($, on) => {
  const row = { id: 'g7', kind: 'k', questions: QUESTIONS, presentation: 'kit', status: 'open', nudge: { session: SESSION }, openedAt: 3 }
  const w = world(on, {
    reply: () => ({ text: 'spilled' }),
    rt: argv => (argv[0] === 'rt' ? { deny: 'not found' } : ok(JSON.stringify({ ok: true, gates: [row] }))),
  })
  await drawOn($, 'terminal')
  await ask($)
  expect(w.ran.map(argv => argv[0])).toEqual(['rt', `${HOME}/.local/bin/rt`])
})

test('Submit records the answer with rt gate answer and wakes the agent', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const form = (await formOf(pane))!
  await pane.post({ type: 'answer', formId: form.id, answers: { tier: 'std', why: 'no' } })
  expect(w.ran).toEqual([['rt', 'gate', 'answer', 'g1', '--answers', JSON.stringify({ tier: 'std', why: 'no' }), '--by', 'pane', '--session', SESSION]])
  expect(w.sent).toEqual(['Gate g1 was answered in the kit form. Call gate_reconcile for it.'])
  expect((await formOf(pane))!.status).toBe('answered')
  await pane.unmount()
})

test('a run control is sent as the answer', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { next: 'go-back', to: 'plan' } })
  expect(w.ran[0]!.slice(4, 6)).toEqual(['--answers', JSON.stringify({ next: 'go-back', to: 'plan' })])
  await pane.unmount()
})

test('a failed answer keeps the form open with the error and wakes nobody', async ($, on) => {
  const w = world(on, { rt: () => failed('rt gate: gate g1 is closed (abandoned)\n') })
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  expect(await formOf(pane)).toMatchObject({ status: 'open', error: 'Not recorded: gate g1 is closed (abandoned)' })
  expect(w.sent).toEqual([])
  const key = (await pane.find({ type: 'Client' }))!.key!
  expect((await rowsOf(pane, key)).join('\n')).toContain('gate g1 is closed (abandoned)')
  await pane.unmount()
})

test('an answer that overruns is never sent again, and the form says it may be recorded', async ($, on) => {
  const w = world(on, {
    rt: async argv => {
      if (argv[2] !== 'answer') return { deny: 'unexpected' }
      await w.clock.sleep(15_000)
      return { deny: 'rt is still running at its timeout' }
    },
  })
  const clock = w.clock
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const posting = pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  await clock.settle()
  await clock.advance(15_000)
  await posting
  expect(w.ran.map(argv => argv[0])).toEqual(['rt'])
  expect(await formOf(pane)).toMatchObject({ status: 'open' })
  expect((await formOf(pane))!.error).toContain('may already be recorded')
  expect(w.sent).toEqual([])
  await pane.unmount()
})

const conflict = (by: string, session?: string) => ok(JSON.stringify({ ok: true, conflict: true, row: { id: 'g1', status: 'answered', answer: { answers: {}, by, answeredAt: 1, ...(session ? { session } : {}) } } }))

test('a lost race to this pane’s own earlier answer counts as recorded and wakes the agent', async ($, on) => {
  const w = world(on, { rt: () => conflict('pane', SESSION) })
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  expect(await formOf(pane)).toMatchObject({ status: 'answered' })
  expect(w.sent).toEqual(['Gate g1 was answered in the kit form. Call gate_reconcile for it.'])
  await pane.unmount()
})

test('a lost race to another surface closes the form as answered elsewhere and wakes nobody', async ($, on) => {
  const w = world(on, { rt: () => conflict('board') })
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  expect(await formOf(pane)).toMatchObject({ status: 'answered', note: 'Already answered elsewhere' })
  expect(w.sent).toEqual([])
  const key = (await pane.find({ type: 'Client' }))!.key!
  expect((await rowsOf(pane, key)).join('\n')).toContain('Already answered elsewhere')
  await pane.unmount()
})

test('an answer rt recorded counts even when its output will not parse', async ($, on) => {
  const w = world(on, { rt: () => ok('recorded, in words') })
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  expect(await formOf(pane)).toMatchObject({ status: 'answered' })
  expect(w.sent).toEqual(['Gate g1 was answered in the kit form. Call gate_reconcile for it.'])
  await pane.unmount()
})

test('Ctrl-X leaves the gate open and tells the agent', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'chat', formId: (await formOf(pane))!.id, draft: {} })
  expect(w.sent).toEqual(["The user set gate g1 aside to talk about it first. Don't present it again; it stays open in the kit form."])
  expect(w.ran).toEqual([])
  expect(w.panes.size).toBe(0)
  const band = await $.ui.mount({ ...ABOVE, surface: 'terminal' })
  expect(await band.find({ type: 'Client' })).toBeDefined()
  await band.unmount()
  await pane.unmount()
})

test('two gates queue in open order; answering the first shows the second', async ($, on) => {
  let n = 0
  const w = world(on, { reply: () => ({ text: JSON.stringify(kitResult(`g${++n}`)) }) })
  await drawOn($, 'terminal')
  await ask($)
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await formOf(pane))!.gateId).toBe('g1')
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  expect((await formOf(pane))!.gateId).toBe('g2')
  expect(w.sent).toEqual(['Gate g1 was answered in the kit form. Call gate_reconcile for it.'])
  await pane.unmount()
})

test('a result with supersededId replaces that gate’s form', async ($, on) => {
  let n = 0
  world(on, { reply: () => (++n === 1 ? { text: JSON.stringify(kitResult('g1')) } : { text: JSON.stringify(kitResult('g2', { supersededId: 'g1' })) }) })
  await drawOn($, 'terminal')
  await ask($)
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await formOf(pane))!.gateId).toBe('g2')
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  expect((await formOf(pane))!.status).toBe('answered')
  await pane.unmount()
})

test('in an 80-column pane the review page and its open menu fit the width', async ($, on) => {
  world(on)
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })
  const key = (await pane.find({ type: 'Client' }))!.key!
  const at = async (word: string) => {
    const rows = await rowsOf(pane, key)
    const y = rows.findIndex(r => r.includes(word))
    return { y, x: y < 0 ? -1 : [...rows[y]!.slice(0, rows[y]!.indexOf(word))].length + 1 }
  }
  const click = async (word: string) => {
    const cell = await at(word)
    expect(cell.y, word).toBeGreaterThan(-1)
    await pane.pointer({ type: 'down', ...cell, button: 'left' })
    await pane.pointer({ type: 'up', ...cell, button: 'left' })
  }
  await click('Submit')
  await click('More actions')
  await click('Go back to stage')
  const rows = await rowsOf(pane, key)
  for (const row of rows) expect([...row].length, row).toBeLessThanOrEqual(78)
  const text = rows.join('\n')
  for (const word of ['Pause run', 'Go back to stage ▸', 'plan', 'provision']) expect(text).toContain(word)
  await pane.unmount()
})
