import { expect, test } from 'claude-code/testing'

import { ABOVE, PANE, QUESTIONS, SESSION, ask, boardResult, drawOn, eventually, formOf, kitResult, resultText, rowsOf, startSession, world, type Engine } from './world'

type Ui = Awaited<ReturnType<Engine['ui']['mount']>>

const answeredBy = (id: string, by: string, session?: string) =>
  JSON.stringify({ ok: true, status: 'answered', row: { id, status: 'answered', answer: { answers: {}, by, answeredAt: 2, ...(session ? { session } : {}) } } })

const kitRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'plan-review',
  questions: QUESTIONS,
  context: 'Pick a tier.',
  presentation: 'kit',
  status: 'open',
  nudge: { session: SESSION },
  answer: null,
  closedReason: null,
  openedAt: 5,
  ...over,
})

const waitsFor = (w: ReturnType<typeof world>, id: string) => w.waits.filter(x => x.argv.slice(1).join(' ') === `gate wait ${id}`)

async function paneForm($: Engine) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const form = await formOf(pane)
  await pane.unmount()
  return form
}

async function bandRows($: Engine, columns = 80): Promise<string[] | undefined> {
  const band = await $.ui.mount({ ...ABOVE, props: { ...ABOVE.props, bodyColumns: columns }, surface: 'terminal' })
  const client = await band.find({ type: 'Client' })
  if (client?.key) await band.resize({ columns, rows: 3, in: client.key })
  const rows = client?.key ? await rowsOf(band, client.key) : undefined
  await band.unmount()
  return rows
}

async function click(ui: Ui, key: string, word: string) {
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(r => r.includes(word))
  expect(y, word).toBeGreaterThan(-1)
  const x = [...rows[y]!.slice(0, rows[y]!.indexOf(word))].length + 1
  await ui.pointer({ type: 'down', x, y, button: 'left' })
  await ui.pointer({ type: 'up', x, y, button: 'left' })
}

test('opening a kit form starts rt gate wait for its gate, with the session id empty', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await ask($)
  await eventually(() => w.waits.length > 0)
  expect(w.waits.map(x => ({ argv: x.argv, env: x.env }))).toEqual([{ argv: ['rt', 'gate', 'wait', 'g1'], env: { CLAUDE_CODE_SESSION_ID: '' } }])
})

test('a gate answered on the board closes its own form only, says so, and types nothing', async ($, on) => {
  let n = 0
  const w = world(on, { holdWaits: true, reply: () => ({ text: JSON.stringify(kitResult(`g${++n}`)) }) })
  await drawOn($, 'terminal')
  await ask($)
  await ask($)
  await eventually(() => w.waits.length === 2)
  await waitsFor(w, 'g1')[0]!.end(answeredBy('g1', 'board'))
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await eventually(async () => (await formOf(pane))?.gateId === 'g2')).toBe(true)
  await pane.unmount()
  expect(w.sent).toEqual([])
  expect(w.ran).toEqual([])
  // The one form left open is the second; with it answered too, the pane shows the first's ending.
  await waitsFor(w, 'g2')[0]!.end(answeredBy('g2', 'board'))
  expect(await eventually(async () => (await paneForm($))?.status === 'answered')).toBe(true)
  const last = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const key = (await last.find({ type: 'Client' }))!.key!
  expect((await rowsOf(last, key)).join('\n')).toContain('Answered on the board')
  await last.unmount()
})

test('a gate closed elsewhere closes its form with the reason', async ($, on) => {
  const w = world(on, { holdWaits: true })
  await drawOn($, 'terminal')
  await ask($)
  await eventually(() => w.waits.length === 1)
  await w.waits[0]!.end(JSON.stringify({ ok: true, status: 'closed', row: { id: 'g1', status: 'closed', answer: null, closedReason: 'superseded' } }))
  expect(await eventually(async () => (await paneForm($))?.status === 'cancelled')).toBe(true)
  expect((await paneForm($))?.note).toBe('Replaced by a newer gate')
})

test('a wait that fails leaves the form open and is not started again', async ($, on) => {
  const w = world(on, { holdWaits: true })
  await drawOn($, 'terminal')
  await ask($)
  await eventually(() => w.waits.length === 1)
  await w.waits[0]!.end('', 1)
  await eventually(() => false, 10)
  expect(w.waits).toHaveLength(1)
  expect((await paneForm($))?.status).toBe('open')
})

test('with rt.gates.kitForm off, a session start lists nothing and nothing is watched', async ($, on) => {
  const w = world(on, { setting: 'off', gates: () => [kitRow('g5')] })
  await drawOn($, 'terminal')
  await ask($)
  await eventually(() => false, 10)
  expect(w.state.lists).toBe(0)
  expect(w.waits).toEqual([])
})

test('opening a kit form rings the herdr bell as herdr-doorbell.sh does', async ($, on) => {
  const w = world(on, { env: { HERDR_ENV: '1', HERDR_PANE_ID: 'p-1' } })
  await drawOn($, 'terminal')
  await ask($)
  expect(await eventually(() => w.bells.length === 1)).toBe(true)
  expect(w.bells).toEqual([['herdr', 'notification', 'show', 'repo needs you', '--body', 'Plan tier  (+1 more)', '--sound', 'request']])
})

test('outside herdr no bell rings', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await ask($)
  await eventually(() => false, 10)
  expect(w.bells).toEqual([])
})

test('a session start restores a form and a watcher for each of this session’s open kit gates, and nothing for closed ones', async ($, on) => {
  const rows = [
    kitRow('g5'),
    kitRow('g6', { nudge: { session: 'someone-else' } }),
    kitRow('g7', { status: 'answered', answer: { answers: {}, by: 'board', answeredAt: 1 } }),
    kitRow('g8', { presentation: 'form' }),
  ]
  const w = world(on, { gates: () => rows })
  await drawOn($, 'terminal')
  expect(await eventually(async () => (await paneForm($))?.gateId === 'g5')).toBe(true)
  await eventually(() => w.waits.length > 0)
  expect(w.waits.map(x => x.argv.slice(1).join(' '))).toEqual(['gate wait g5'])
  expect(w.state.lists).toBe(1)
})

test('restore picks up a kit gate whose takeover never drew a form', async ($, on) => {
  let listed: unknown[] = []
  const w = world(on, {
    reply: () => ({ text: JSON.stringify(kitResult('g1', { kitForm: { questions: [], context: 'x' } })) }),
    gates: () => listed,
  })
  await drawOn($, 'terminal')
  await ask($)
  expect(await paneForm($)).toBeUndefined()
  listed = [kitRow('g1')]
  await startSession($)
  expect(await eventually(async () => (await paneForm($))?.gateId === 'g1')).toBe(true)
})

test('restore keeps one form and one watcher per gate, and closes a form whose gate ended meanwhile', async ($, on) => {
  let n = 0
  let listed: unknown[] = []
  const w = world(on, { holdWaits: true, reply: () => ({ text: JSON.stringify(kitResult(`g${++n}`)) }), gates: () => listed })
  await drawOn($, 'terminal')
  await ask($)
  await ask($)
  await eventually(() => w.waits.length === 2)
  listed = [kitRow('g1', { status: 'answered', answer: { answers: {}, by: 'console', answeredAt: 1 } }), kitRow('g2')]
  await startSession($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await eventually(async () => (await formOf(pane))?.gateId === 'g2')).toBe(true)
  await pane.unmount()
  await eventually(() => false, 10)
  expect(w.waits.map(x => x.argv[3])).toEqual(['g1', 'g2'])
  expect(w.sent).toEqual([])
})

test('a board-only wait result adds the Open on board band and passes through unchanged', async ($, on) => {
  const text = JSON.stringify(boardResult('b1'))
  const w = world(on, { reply: () => ({ text }) })
  await drawOn($, 'terminal')
  const out = await ask($, { kind: 'review-post' })
  expect(resultText(out)).toBe(text)
  expect(w.panes.size).toBe(0)
  expect(w.deckRuns).toEqual([['deck', 'list', '--json']])
  const band = await $.ui.mount({ ...ABOVE, surface: 'terminal' })
  const key = (await band.find({ type: 'Client' }))!.key!
  const row = (await rowsOf(band, key)).join('\n')
  expect(row).toContain('Review findings is waiting on the board')
  expect(row).toContain('Open on board')
  await click(band, key, 'Open on board')
  expect(await eventually(() => w.opened.length === 1)).toBe(true)
  expect(w.opened).toEqual(['http://localhost:11006/?gate=b1'])
  await band.unmount()
})

test('with no board address the band says so and has no button', async ($, on) => {
  world(on, { reply: () => ({ text: JSON.stringify(boardResult('b1')) }), deck: 'deck   7940  up  deck\n' })
  await drawOn($, 'terminal')
  await ask($, { kind: 'review-post' })
  const row = (await bandRows($))!.join('\n')
  expect(row).toContain('Board address not found')
  expect(row).not.toContain('Open on board')
})

test('a deck that cannot run is no address too', async ($, on) => {
  world(on, { reply: () => ({ text: JSON.stringify(boardResult('b1')) }), deck: null })
  await drawOn($, 'terminal')
  await ask($, { kind: 'review-post' })
  expect((await bandRows($))!.join('\n')).toContain('Board address not found')
})

test('the watcher clears the band', async ($, on) => {
  const w = world(on, { holdWaits: true, reply: () => ({ text: JSON.stringify(boardResult('b1')) }) })
  await drawOn($, 'terminal')
  await ask($, { kind: 'review-post' })
  await eventually(() => w.waits.length === 1)
  expect(w.waits[0]!.argv).toEqual(['rt', 'gate', 'wait', 'b1'])
  expect(await bandRows($)).toBeDefined()
  await w.waits[0]!.end(answeredBy('b1', 'board'))
  expect(await eventually(async () => (await bandRows($)) === undefined)).toBe(true)
  expect(w.sent).toEqual([])
})

test('with several board gates the band names the newest and how many more, and opens the newest', async ($, on) => {
  let n = 0
  const w = world(on, { reply: () => ({ text: JSON.stringify(boardResult(`b${++n}`)) }) })
  await drawOn($, 'terminal')
  await ask($, { kind: 'review-post' })
  await ask($, { kind: 'respond-plan' })
  const band = await $.ui.mount({ ...ABOVE, surface: 'terminal' })
  const key = (await band.find({ type: 'Client' }))!.key!
  expect((await rowsOf(band, key)).join('\n')).toContain('Respond plan is waiting on the board, 1 more')
  await click(band, key, 'Open on board')
  expect(await eventually(() => w.opened.length === 1)).toBe(true)
  expect(w.opened).toEqual(['http://localhost:11006/?gate=b2'])
  await band.unmount()
})

for (const columns of [80, 40] as const) {
  test(`in a ${columns}-column pane the band fits and its button stays whole`, async ($, on) => {
    world(on, { reply: () => ({ text: JSON.stringify(boardResult('b1')) }) })
    await drawOn($, 'terminal')
    await ask($, { kind: 'review-post' })
    const rows = (await bandRows($, columns))!
    for (const row of rows) expect([...row].length, row).toBeLessThanOrEqual(columns)
    expect(rows.join('\n')).toContain('Open on board')
  })
}

test('with rt.gates.kitForm off a board-only gate adds no band', async ($, on) => {
  const w = world(on, { setting: 'off', reply: () => ({ text: JSON.stringify(boardResult('b1')) }) })
  await drawOn($, 'terminal')
  await ask($, { kind: 'review-post' })
  expect(await bandRows($)).toBeUndefined()
  expect(w.deckRuns).toEqual([])
})

// No wait is held here: a held child slows every mount of the drawing, so each watcher fails at once and a session start watches again.
test('a session start keeps the band for a board gate still open, drops one that closed, and watches only the open one', async ($, on) => {
  let n = 0
  let listed: unknown[] = []
  const w = world(on, { reply: () => ({ text: JSON.stringify(boardResult(`b${++n}`)) }), gates: () => listed })
  await drawOn($, 'terminal')
  await ask($, { kind: 'review-post' })
  await ask($, { kind: 'respond-plan' })
  await eventually(() => w.waits.length === 2)
  expect((await bandRows($))!.join('\n')).toContain('Respond plan is waiting on the board, 1 more')
  listed = [
    { id: 'b1', kind: 'review-post', presentation: 'wait', status: 'open', nudge: null, answer: null, closedReason: null, openedAt: 1 },
    { id: 'b2', kind: 'respond-plan', presentation: 'wait', status: 'closed', nudge: null, answer: null, closedReason: 'abandoned', openedAt: 2 },
  ]
  await startSession($)
  expect(await eventually(() => w.waits.length === 3)).toBe(true)
  expect(w.waits.slice(2).map(x => x.argv[3])).toEqual(['b1'])
  expect(await eventually(async () => ((await bandRows($)) ?? []).join('\n').includes('Review findings is waiting on the board'))).toBe(true)
  expect((await bandRows($))!.join('\n')).not.toContain('more')
})
