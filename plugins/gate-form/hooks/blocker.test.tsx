import { expect, test } from 'claude-code/testing'

import { PANE, QUESTIONS, SESSION, ask, boardResult, drawOn, eventually, failed, formOf, kitResult, ok, resultText, startSession, world, type Engine, type On } from './world'

const HERDR = { HERDR_ENV: '1', HERDR_PANE_ID: 'p-1' }
const raiseArgs = (pane: string, message: string) => ['herdr', 'pane', 'report-blocker', pane, '--source', 'mattstack:gate', '--message', message]
const clearArgs = (pane: string) => ['herdr', 'pane', 'clear-blocker', pane, '--source', 'mattstack:gate']
const PLUGIN_ARGS = {
  title: 'PR #1144 merged',
  label: 'What should this session do?',
  options: [
    { value: 'close', label: 'Close session' },
    { value: 'leave', label: 'Exit worktree and continue' },
  ],
  timeoutMs: 120_000,
}

// Another plugin asking through the noun, as in plugin-ask.test.tsx.
const CONSUMER = {
  name: 'consumer',
  register(on: On) {
    on('tool.call', { tool: 'consumer-ask' }, async ($, e) => ({ result: JSON.stringify(await $.gateForm.ask((e as unknown as { args: never }).args)) }))
  },
}
const askNoun = async ($: Engine, args: Record<string, unknown> = PLUGIN_ARGS) => JSON.parse(resultText(await $.tool.call({ tool: 'consumer-ask', args } as never))) as { id: string }

type World = ReturnType<typeof world>

// A session start in herdr clears whatever an earlier load left, so each test starts from that clear.
async function startInHerdr($: Engine, w: World, draw = true) {
  if (draw) await drawOn($, 'terminal')
  else await startSession($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  expect(w.blockers.splice(0)).toEqual([clearArgs('p-1')])
}

const last = (w: World) => w.blockers.at(-1)
const settled = () => eventually(() => false, 10)

async function answer($: Engine, answers: Record<string, unknown> = { tier: 'std', why: 'no' }) {
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'answer', formId: (await formOf(pane))!.id, answers })
  await pane.unmount()
}

test('a gate form raises the blocker with its title, and its answer clears it', async ($, on) => {
  const w = world(on, { env: HERDR })
  await startInHerdr($, w)
  await ask($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review')])
  await answer($)
  expect(await eventually(() => w.blockers.length === 2)).toBe(true)
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review'), clearArgs('p-1')])
})

test('a second gate keeps the blocker raised and updates its message until the last form ends', async ($, on) => {
  let n = 0
  const w = world(on, { env: HERDR, reply: () => ({ text: JSON.stringify(kitResult(`g${++n}`)) }) })
  await startInHerdr($, w)
  await ask($)
  await ask($, { kind: 'review-post' })
  expect(await eventually(() => w.blockers.length === 2)).toBe(true)
  await answer($)
  expect(await eventually(() => w.blockers.length === 3)).toBe(true)
  await answer($)
  expect(await eventually(() => w.blockers.length === 4)).toBe(true)
  await settled()
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review'), raiseArgs('p-1', 'plan-review, 1 more waiting'), raiseArgs('p-1', 'review-post'), clearArgs('p-1')])
})

test('a gate set aside keeps the blocker raised', async ($, on) => {
  const w = world(on, { env: HERDR })
  await startInHerdr($, w)
  await ask($)
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.post({ type: 'chat', formId: (await formOf(pane))!.id, draft: {} })
  await pane.unmount()
  await settled()
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review')])
})

test('a board-only gate raises nothing', async ($, on) => {
  const w = world(on, { env: HERDR, reply: () => ({ text: JSON.stringify(boardResult('b1')) }) })
  await startInHerdr($, w)
  await ask($)
  await settled()
  expect(w.blockers).toEqual([])
})

test('an ask-tool form and a plugin ask raise and clear the blocker', { plugins: [CONSUMER] }, async ($, on) => {
  const w = world(on, { env: HERDR })
  await startInHerdr($, w)
  await $.tool.call({ tool: 'mcp__gate-form__ask', title: 'Pick one', questions: QUESTIONS } as never)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  await answer($)
  expect(await eventually(() => w.blockers.length === 2)).toBe(true)
  expect(w.blockers.splice(0)).toEqual([raiseArgs('p-1', 'Pick one'), clearArgs('p-1')])

  await askNoun($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  await answer($, { choice: 'leave' })
  expect(await eventually(() => w.blockers.length === 2)).toBe(true)
  expect(w.blockers.splice(0)).toEqual([raiseArgs('p-1', 'PR #1144 merged'), clearArgs('p-1')])

  await askNoun($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  await w.clock.advance(PLUGIN_ARGS.timeoutMs)
  expect(await eventually(() => w.blockers.length === 2)).toBe(true)
  expect(w.blockers).toEqual([raiseArgs('p-1', 'PR #1144 merged'), clearArgs('p-1')])
})

test('answering one plugin ask while the next one opens leaves the blocker raised', { plugins: [CONSUMER] }, async ($, on) => {
  // herdr is slow to finish a clear, so a raise sent before the clear finished would end ahead of it.
  const slowClear = async (argv: readonly string[]) => {
    if (argv[2] === 'clear-blocker') await new Promise(resolve => setTimeout(resolve, 20))
    return ok('')
  }
  const w = world(on, { setting: 'off', env: HERDR, herdr: slowClear })
  await startInHerdr($, w, false)
  await askNoun($)
  await askNoun($, { ...PLUGIN_ARGS, title: 'PR #2 merged' })
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  await answer($, { choice: 'close' })
  expect(await eventually(() => w.blockers.length === 3)).toBe(true)
  await eventually(() => false, 40)
  expect(last(w)).toEqual(raiseArgs('p-1', 'PR #2 merged'))
})

test('outside herdr nothing is sent to herdr', async ($, on) => {
  const w = world(on)
  await drawOn($, 'terminal')
  await ask($)
  await answer($)
  await settled()
  expect(w.blockers).toEqual([])
})

test('a herdr without the verb leaves the gate working', async ($, on) => {
  const w = world(on, { env: HERDR, herdr: () => failed('unknown command') })
  await startInHerdr($, w)
  await ask($)
  expect(w.panes.has('gate-form')).toBe(true)
  await answer($)
  await settled()
  expect(w.ran).toContainEqual(['rt', 'gate', 'answer', 'g1', '--answers', JSON.stringify({ tier: 'std', why: 'no' }), '--by', 'pane', '--session', SESSION])
  expect(w.toasts.filter(t => /herdr/i.test(t))).toEqual([])
})

test('a session start with no open form clears a blocker left by an earlier load', async ($, on) => {
  const w = world(on, { env: HERDR })
  await startSession($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  expect(w.blockers).toEqual([clearArgs('p-1')])
})

test('session end clears a raised blocker', async ($, on) => {
  const w = world(on, { env: HERDR })
  await startInHerdr($, w)
  await ask($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SESSION, resume: { id: SESSION } } as never)
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review'), clearArgs('p-1')])
})
