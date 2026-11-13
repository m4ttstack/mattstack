import { expect, mock, test } from 'claude-code/testing'

type Body = Parameters<Parameters<typeof test>[1]>
type Engine = Body[0]
type On = Body[1]
type Node = { children?: unknown[] }

const ASK = 'mcp__plugin_mattstack_mattstack__gate_ask'
const OPEN = 'mcp__plugin_mattstack_mattstack__gate_open'
const SESSION = 'sess-kit'
const HOME = '/home/tester'

const QUESTIONS = [
  { id: 'tier', label: 'Plan tier', multi: false, options: [{ value: 'std', label: 'Standard' }, { value: 'light', label: 'Light' }] },
  { id: 'why', label: 'Anything to add?', multi: false, writeIn: true, options: [{ value: 'no', label: 'No' }] },
]
const CONTROLS = { pause: true, goBack: ['plan', 'provision'] }

const kitResult = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  presentation: 'kit',
  boardOnly: false,
  subject: 'run:1',
  supersededId: null,
  paneAction: 'kit',
  formChunks: [],
  kitForm: { questions: QUESTIONS, context: 'Pick a tier.', controls: CONTROLS },
  ...over,
})

const PANE = {
  plugin: 'gate-form',
  component: 'Pane',
  requestId: 'gate-form',
  props: { title: 'Gate', isFocused: true, bodyColumns: 70, placement: 'inline', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

const ABOVE = {
  plugin: 'gate-form',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
const failed = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })

type ToolReply = { text: string; result?: unknown }
type Answer = (argv: readonly string[]) => ReturnType<typeof ok> | { deny: string }

// What sits beneath the plugin: the pane list, the mattstack tool, `rt`, the prompt and the session.
function world(on: On, opts: { reply?: (input: Record<string, unknown>) => ToolReply; rt?: Answer; openFails?: boolean } = {}) {
  const panes = new Map<string, string>()
  const calls: Record<string, unknown>[] = []
  const ran: string[][] = []
  const sent: string[] = []
  on('ui.open', (_, e) => {
    if (opts.openFails) throw new Error('no room for a pane')
    panes.set(e.id, e.title ?? e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...panes].map(([id, title]) => ({ id, title, isShown: true, isFocused: false, isPlaced: true })) }))
  on('session.id', () => ({ value: SESSION }))
  mock.env(on, { HOME })
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })
  on('tool.call', (_, e) => {
    calls.push(e as Record<string, unknown>)
    const reply = opts.reply?.(e as Record<string, unknown>) ?? { text: JSON.stringify(kitResult('g1')) }
    return { result: reply.result ?? [{ type: 'text', text: reply.text }], text: reply.text }
  })
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    return opts.rt?.(e.argv) ?? ok(JSON.stringify({ ok: true, conflict: false }))
  })
  return { panes, calls, ran, sent }
}

// The band records the surface the session draws on; tool.call carries none.
async function drawOn($: Engine, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile') {
  const band = await $.ui.mount({ ...ABOVE, surface })
  await band.unmount()
}

const ask = ($: Engine, over: Record<string, unknown> = {}) => $.tool.call({ tool: ASK, questions: QUESTIONS, kind: 'plan-review', ...over } as never)

const shown = (node: unknown): string => (typeof node === 'string' ? node : ((node as Node).children ?? []).map(shown).join(''))
async function rowsOf(ui: { drawn: (scope?: { in?: string }) => Promise<unknown> }, key: string): Promise<string[]> {
  return (((await ui.drawn({ in: key })) as Node).children ?? []).map(shown)
}
const formOf = async (ui: { find: (q: { type: string }) => Promise<{ props: Record<string, unknown>; key?: string } | undefined> }) =>
  ((await ui.find({ type: 'Client' }))?.props.props as { form: { id: string; gateId?: string; status: string; error?: string } } | undefined)?.form
const resultText = (out: unknown) => {
  const result = (out as { result?: unknown }).result
  if (typeof result === 'string') return result
  return ((result as { text: string }[] | undefined) ?? []).map(block => block.text).join('')
}

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
  await ask($)
  expect(w.calls[0]!.kitForm).toBeUndefined()
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
  expect(await formOf(pane)).toMatchObject({ status: 'open', error: 'gate g1 is closed (abandoned)' })
  expect(w.sent).toEqual([])
  const key = (await pane.find({ type: 'Client' }))!.key!
  expect((await rowsOf(pane, key)).join('\n')).toContain('gate g1 is closed (abandoned)')
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
