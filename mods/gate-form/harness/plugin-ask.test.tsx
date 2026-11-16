import { expect, test } from 'claude-code/testing'

import { PANE, formOf, resultText, rowsOf, startSession, world, type Engine, type On } from './world'

const ARGS = {
  title: 'PR #1144 merged',
  label: 'What should this session do?',
  options: [
    { value: 'close', label: 'Close session' },
    { value: 'leave', label: 'Exit worktree and continue' },
  ],
  timeoutMs: 120_000,
}

// Another plugin asking through the noun; a test can only reach `$.gateForm` from a plugin's hook.
const CONSUMER = {
  name: 'consumer',
  register(on: On) {
    on('tool.call', { tool: 'consumer-ask' }, async ($, e) => {
      const asked = await $.gateForm.ask((e as unknown as { args: never }).args).catch((failure: Error) => ({ refused: failure.message }))
      return { result: JSON.stringify(asked) }
    })
    on('tool.call', { tool: 'consumer-wait' }, async ($, e) => ({ result: JSON.stringify(await $.gateForm.wait({ id: (e as unknown as { id: string }).id })) }))
  },
}

const askNoun = async ($: Engine, args: Record<string, unknown> = ARGS) =>
  JSON.parse(resultText(await $.tool.call({ tool: 'consumer-ask', args } as never))) as { id: string }
const waitNoun = async ($: Engine, id: string) => JSON.parse(resultText(await $.tool.call({ tool: 'consumer-wait', id } as never))) as Record<string, unknown>

test('with rt.gates.kitForm off, ask opens a plugin form and wait returns the picked value', { plugins: [CONSUMER] }, async ($, on) => {
  const w = world(on, { setting: 'off' })
  await startSession($)
  const { id } = await askNoun($)
  expect(w.panes.has('gate-form')).toBe(true)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const form = (await formOf(pane))!
  expect(form).toMatchObject({ id, status: 'open' })
  await pane.post({ type: 'answer', formId: id, answers: { choice: 'leave' } })
  expect(await waitNoun($, id)).toEqual({ value: 'leave' })
  expect((await formOf(pane))!.status).toBe('answered')
  expect(w.panes.has('gate-form')).toBe(false)
  await pane.unmount()
})

test('a plugin form’s answer never reaches the agent as a prompt', { plugins: [CONSUMER] }, async ($, on) => {
  const w = world(on, { setting: 'on' })
  await startSession($)
  const { id } = await askNoun($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: id, answers: { choice: 'close' } })
  expect(await waitNoun($, id)).toEqual({ value: 'close' })
  expect(w.sent).toEqual([])
  await pane.unmount()
})

test('a wait under way returns the pick as soon as it is made, and is pending when none came', { plugins: [CONSUMER] }, async ($, on) => {
  const w = world(on, { setting: 'off' })
  const { id } = await askNoun($)
  const quiet = waitNoun($, id)
  await w.clock.advance(5_000)
  // Well under the 10 s a plugin noun call has, so a busy engine still delivers the answer.
  expect(await Promise.race([quiet, Promise.resolve('still waiting')])).toEqual({ pending: true })
  const waiting = waitNoun($, id)
  await w.clock.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: id, answers: { choice: 'close' } })
  expect(await waiting).toEqual({ value: 'close' })
  await pane.unmount()
})

test('with no pick by timeoutMs, wait returns timedOut and the form closes', { plugins: [CONSUMER] }, async ($, on) => {
  const w = world(on, { setting: 'off' })
  const { id } = await askNoun($)
  await w.clock.advance(ARGS.timeoutMs)
  expect(await waitNoun($, id)).toEqual({ timedOut: true })
  expect(w.panes.has('gate-form')).toBe(false)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await formOf(pane))?.status).not.toBe('open')
  await pane.unmount()
})

test('the timeout still ends the ask when the pane could not be placed', { plugins: [CONSUMER] }, async ($, on) => {
  const w = world(on, { setting: 'off', openFails: true })
  const { id } = await askNoun($)
  await w.clock.advance(ARGS.timeoutMs)
  expect(await waitNoun($, id)).toEqual({ timedOut: true })
})

test('a wait on an unknown id, or on one already collected, returns closed', { plugins: [CONSUMER] }, async ($, on) => {
  const w = world(on, { setting: 'off' })
  expect(await waitNoun($, 'nobody-asked')).toEqual({ closed: true })
  const { id } = await askNoun($)
  await w.clock.advance(ARGS.timeoutMs)
  expect(await waitNoun($, id)).toEqual({ timedOut: true })
  expect(await waitNoun($, id)).toEqual({ closed: true })
})

test('a second ask waits behind the open one, then opens once the first is answered', { plugins: [CONSUMER] }, async ($, on) => {
  world(on, { setting: 'off' })
  const first = await askNoun($)
  const second = await askNoun($, { ...ARGS, title: 'PR #2 merged' })
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await formOf(pane))!.id).toBe(first.id)
  await pane.post({ type: 'answer', formId: first.id, answers: { choice: 'close' } })
  expect((await formOf(pane))).toMatchObject({ id: second.id, status: 'open' })
  await pane.unmount()
})

test('ask arguments the form cannot draw are refused', { plugins: [CONSUMER] }, async ($, on) => {
  const w = world(on, { setting: 'off' })
  const out = (await askNoun($, { ...ARGS, options: [] })) as unknown as { refused?: string }
  expect(out.refused).toContain('option')
  expect(w.panes.size).toBe(0)
})

// A test cannot write another plugin's value, so the stored form comes from beneath the plugin, as a reload would hand it back.
test('a plugin form left open by an earlier load is closed on session start', async ($, on) => {
  const stale: Record<string, unknown> = {
    id: 'f-stale',
    title: 'PR #9 merged',
    questions: [{ id: 'choice', header: 'Choice', label: 'Leave?', multi: false, writeIn: false, other: false, options: [{ value: 'close', label: 'Close session' }] }],
    status: 'open',
    source: 'plugin',
  }
  let seeded = true
  on('state.get', async (_, e, next) => {
    const read = await next(e)
    if (!seeded || (e as { key?: string }).key !== 'forms') return read
    return { value: { ...read.value, value: { shape: 'forms-1', value: [stale] } } } as never
  })
  on('state.set', async (_, e, next) => {
    if ((e as { key?: string }).key === 'forms') seeded = false
    return next(e)
  })
  world(on, { setting: 'off' })
  await startSession($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await formOf(pane)).toMatchObject({ id: 'f-stale' })
  expect((await formOf(pane))!.status).not.toBe('open')
  expect(seeded).toBe(false)
  await pane.unmount()
})

const CONFIRM = {
  title: 'MR !267 merged',
  kind: 'confirm',
  context: 'rt is cleaning up this worktree. No answer in 2 minutes moves this session out.',
  options: [
    { value: 'leave', label: 'Exit worktree and continue' },
    { value: 'close', label: 'Close session' },
  ],
  timeoutMs: 120_000,
}

test("a confirm's answers are plain engine Buttons, the first autoFocus, each numbered as a hotkey while the pane holds the keys", { plugins: [CONSUMER] }, async ($, on) => {
  world(on, { setting: 'off' })
  await startSession($)
  const { id } = await askNoun($, CONFIRM)
  const focused = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const exit = (await focused.find({ type: 'Button', key: `confirm-${id}:0` }))!
  const close = (await focused.find({ type: 'Button', key: `confirm-${id}:1` }))!
  expect(exit.text).toBe('Exit worktree and continue')
  expect(exit.props).toMatchObject({ plain: true, hotkey: '1', autoFocus: true })
  expect(close.props).toMatchObject({ plain: true, hotkey: '2' })
  expect(close.props.autoFocus).toBeUndefined()
  await focused.unmount()
  const unfocused = await $.ui.mount({ ...PANE, props: { ...PANE.props, isFocused: false }, surface: 'terminal' })
  expect((await unfocused.find({ type: 'Button', key: `confirm-${id}:0` }))!.props.hotkey).toBeUndefined()
  await unfocused.unmount()
})

test('a confirm ask resolves with the Button pressed', { plugins: [CONSUMER] }, async ($, on) => {
  world(on, { setting: 'off' })
  await startSession($)
  const { id } = await askNoun($, CONFIRM)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: `confirm-${id}:1` })
  expect(await waitNoun($, id)).toEqual({ value: 'close' })
  await pane.unmount()
})
