import { expect, test } from 'claude-code/testing'

import { PANE, ask, drawOn, eventually, formOf, kitResult, rowsOf, world, type Engine } from './world'

type Ui = Awaited<ReturnType<Engine['ui']['mount']>>

const clientOf = async (ui: Ui) => (await ui.find({ type: 'Client' }))!

async function clickWord(ui: Ui, word: string) {
  const key = (await clientOf(ui)).key!
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(r => r.includes(word))
  expect(y, word).toBeGreaterThan(-1)
  const x = [...rows[y]!.slice(0, rows[y]!.indexOf(word))].length + 1
  await ui.pointer({ type: 'down', x, y, button: 'left' })
  await ui.pointer({ type: 'up', x, y, button: 'left' })
}

const answeredBy = (id: string, by: string, answers: Record<string, unknown>) =>
  JSON.stringify({ ok: true, status: 'answered', row: { id, status: 'answered', answer: { answers, by, answeredAt: 2 } } })

test('the form fills the pane body, so a click below its lines still focuses it', async ($, on) => {
  world(on)
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, isFocused: false }, surface: 'terminal' })
  const client = await clientOf(pane)
  expect(client.props.height).toBe(80)
  expect((client.props.props as { focused: boolean }).focused).toBe(false)
  const drawn = (await rowsOf(pane, client.key!)).length
  await pane.pointer({ type: 'down', x: 2, y: drawn + 5, button: 'left' })
  await pane.pointer({ type: 'up', x: 2, y: drawn + 5, button: 'left' })
  expect(await eventually(async () => ((await clientOf(pane)).props.props as { focused: boolean }).focused)).toBe(true)
  await pane.unmount()
})

test('a recorded answer closes the pane when no other form waits', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await ask($)
  expect(w.panes.has('gate-form')).toBe(true)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers: { tier: 'std', why: 'no' } })
  expect(w.panes.has('gate-form')).toBe(false)
  await pane.unmount()
})

test('a gate answered on the board closes the pane, toasts where, and the form shows the answer that won', async ($, on) => {
  const w = world(on, { holdWaits: true })
  await drawOn($, 'terminal')
  await ask($)
  await eventually(() => w.waits.length > 0)
  await w.waits[0]!.end(answeredBy('g1', 'board', { tier: 'light', why: { writeIn: 'ship it' } }))
  expect(await eventually(() => !w.panes.has('gate-form'))).toBe(true)
  expect(w.toasts).toContain('plan-review: Answered on the board')
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = (await rowsOf(pane, (await clientOf(pane)).key!)).join('\n')
  expect(text).toContain('Light')
  expect(text).toContain('“ship it”')
  expect(text).toContain('Answered on the board')
  expect(text).not.toContain('not answered')
  await pane.unmount()
})

test('More actions lists Go back to stage as a flat group, and the arrows skip its heading', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await clickWord(pane, 'Next')
  await clickWord(pane, 'Review')
  await clickWord(pane, 'More actions')
  const text = (await rowsOf(pane, (await clientOf(pane)).key!)).join('\n')
  for (const word of ['Pause run', 'Go back to stage', 'plan', 'provision']) expect(text).toContain(word)
  expect(text).not.toContain('▸')
  for (const key of ['down', 'down', 'return']) await pane.key({ key })
  // Enter shows its press before it picks.
  await pane.advance(200)
  expect(await eventually(() => w.ran.some(argv => argv.includes('answer')))).toBe(true)
  const answer = w.ran.find(argv => argv.includes('answer'))!
  expect(JSON.parse(answer[answer.indexOf('--answers') + 1]!)).toEqual({ next: 'go-back', to: 'provision' })
  await pane.unmount()
})

const LONG = [
  {
    id: 'what',
    label: 'What went wrong with the layout when the pane is narrow and the text is long?',
    multi: false,
    options: [
      { value: 'a', label: 'It overflows', description: 'Something wraps badly, is cut off, or the buttons slide out of their row when the pane narrows' },
      { value: 'b', label: 'Something wraps badly', description: 'Something wraps badly, is cut off, or the text runs past the right edge of the pane at eighty columns' },
    ],
  },
]

test('at 80 columns every option description and the question wrap in full, never cut', async ($, on) => {
  world(on, { reply: () => ({ text: JSON.stringify(kitResult('g1', { kitForm: { questions: LONG, context: 'Narrow pane check.', controls: { pause: false, goBack: [] } } })) }) })
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 80 }, surface: 'terminal' })
  const rows = await rowsOf(pane, (await clientOf(pane)).key!)
  for (const row of rows) expect([...row].length, row).toBeLessThanOrEqual(78)
  // Wrapped lines read as one text once the rails and line breaks are taken out.
  const flat = rows.map(r => r.replace(/[│└┌├]/g, ' ')).join(' ').replace(/\s+/g, ' ')
  expect(flat).not.toContain('…')
  expect(flat).toContain('slide out of their row when the pane narrows')
  expect(flat).toContain('right edge of the pane at eighty columns')
  expect(flat).toContain('the text is long?')
  await pane.unmount()
})

test('a wheel turn over the pane reaches the form, which scrolls its own page', async ($, on) => {
  world(on)
  await drawOn($, 'terminal')
  await ask($)
  const pane = await $.ui.mount({ ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 20 } }, surface: 'terminal' })
  const wheelOf = async () => ((await clientOf(pane)).props.props as { wheel?: number }).wheel
  const before = (await wheelOf()) ?? 0
  const scrolled = await $.ui.scroll({ component: 'Pane', requestId: 'gate-form', offset: 0, by: 3, bodyRows: 20, contentRows: 20, origin: { kind: 'person' } } as never)
  expect(scrolled).toEqual({})
  expect(await eventually(async () => (await wheelOf()) === before + 3)).toBe(true)
  await pane.unmount()
})
