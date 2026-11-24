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
  const w = world(on, { setting: 'off', env: HERDR })
  await startInHerdr($, w, false)
  await askNoun($)
  await askNoun($, { ...PLUGIN_ARGS, title: 'PR #2 merged' })
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  await answer($, { choice: 'close' })
  expect(await eventually(() => w.blockers.length >= 2)).toBe(true)
  await settled()
  expect(w.blockers).toEqual([raiseArgs('p-1', 'PR #1144 merged'), raiseArgs('p-1', 'PR #2 merged')])
})

test('writes made while herdr is slow collapse into one run for the latest title', async ($, on) => {
  let n = 0
  let release!: () => void
  const held = new Promise<void>(resolve => (release = resolve))
  const holdFirst = async () => {
    if (++n === 1) await held
    return ok('')
  }
  let g = 0
  const w = world(on, { env: HERDR, herdr: holdFirst, reply: () => ({ text: JSON.stringify(kitResult(`g${++g}`)) }) })
  await drawOn($, 'terminal')
  expect(await eventually(() => n === 1)).toBe(true)
  await ask($)
  await ask($, { kind: 'review-post' })
  await ask($, { kind: 'ship' })
  release()
  expect(await eventually(() => w.blockers.length >= 2)).toBe(true)
  await settled()
  expect(w.blockers).toEqual([clearArgs('p-1'), raiseArgs('p-1', 'plan-review, 2 more waiting')])
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
  // Each failed clear is tried again by the next write, so the start's count of clears is not fixed.
  await drawOn($, 'terminal')
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

test('session end waits for a raise under way, then clears', async ($, on) => {
  let raising = false
  let release!: () => void
  const held = new Promise<void>(resolve => (release = resolve))
  const holdRaise = async (argv: readonly string[]) => {
    if (argv[2] === 'report-blocker') {
      raising = true
      await held
    }
    return ok('')
  }
  const w = world(on, { env: HERDR, herdr: holdRaise })
  await startInHerdr($, w)
  await ask($)
  expect(await eventually(() => raising)).toBe(true)
  let ended = false
  const ending = $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never).then(() => (ended = true))
  await settled()
  expect(ended).toBe(false)
  expect(w.blockers).toEqual([])
  release()
  await ending
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review'), clearArgs('p-1')])
})

// The form-3 value comes from beneath the plugin, as in patterns.test.tsx. The session start's write moves it into
// the list, and its cleanup lands at once but answers late, so the ask and the answer write meanwhile.
test('writes made while an earlier write clears the legacy form leave the last write\'s target', async ($, on) => {
  const old = { id: 'f-old', title: 'Old', questions: QUESTIONS, status: 'open', replyTo: 'agent' }
  let cleared = false
  let release!: () => void
  const held = new Promise<void>(resolve => (release = resolve))
  on('state.get', (_, e, next) => (e.key === 'form' && !cleared ? { value: { value: { shape: 'form-3', value: old }, version: 1 } } : next(e)))
  on('state.set', async (_, e, next) => {
    if (e.key !== 'form') return next(e)
    cleared = true
    await held
    return next(e)
  })
  const w = world(on, { env: HERDR })
  await drawOn($, 'terminal')
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  expect(w.blockers.splice(0)).toEqual([raiseArgs('p-1', 'Old')])
  expect(await eventually(() => cleared)).toBe(true)
  await $.tool.call({ tool: 'mcp__gate-form__ask', title: 'Pick one', questions: QUESTIONS } as never)
  await answer($)
  release()
  await settled()
  expect(w.blockers).toEqual([raiseArgs('p-1', 'Pick one'), clearArgs('p-1')])
})

test('a failed clear is tried again at the next session start', async ($, on) => {
  let clears = 0
  const answerClearFails = async (argv: readonly string[]) => (argv[2] === 'clear-blocker' && ++clears === 2 ? failed('herdr is not running') : ok(''))
  const w = world(on, { env: HERDR, herdr: answerClearFails })
  await startInHerdr($, w)
  await ask($)
  await answer($)
  expect(await eventually(() => w.blockers.length === 2)).toBe(true)
  await startSession($)
  expect(await eventually(() => w.blockers.length === 3)).toBe(true)
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review'), clearArgs('p-1'), clearArgs('p-1')])
})

test('a failed raise is not tried again while its title stands', async ($, on) => {
  const w = world(on, { env: HERDR, herdr: argv => (argv[2] === 'report-blocker' ? failed('unknown command') : ok('')) })
  await startInHerdr($, w)
  await ask($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  await startSession($)
  await settled()
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review')])
})

const WATCHED = { ...HERDR, HERDR_SOCKET_PATH: '/home/tester/herdr.sock' }
const CHECK_MS = 5_000
const check = async (w: World) => {
  await w.clock.advance(CHECK_MS)
  await settled()
}
const startedBy = ($: Engine, source: string) => $.classic.SessionStart({ source, session_id: 'sess-next' } as never)

test('a form open across a herdr handoff is raised again', async ($, on) => {
  let boundAt = 1
  const w = world(on, { env: WATCHED, socket: () => boundAt })
  await startInHerdr($, w)
  await ask($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  await check(w)
  expect(w.blockers.splice(0)).toEqual([raiseArgs('p-1', 'plan-review')])
  boundAt = 2
  await check(w)
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review')])
})

test('a handoff is followed by two more raises, for a server still detecting its agents, then none', async ($, on) => {
  let boundAt = 1
  const w = world(on, { env: WATCHED, socket: () => boundAt })
  await startInHerdr($, w)
  await ask($)
  await settled()
  w.blockers.splice(0)
  boundAt = 2
  for (let i = 0; i < 5; i++) await check(w)
  expect(w.blockers).toEqual(Array(3).fill(raiseArgs('p-1', 'plan-review')))
})

test('a raise refused during a handoff is tried again at the next check', async ($, on) => {
  let boundAt = 1
  let refuse = false
  const w = world(on, { env: WATCHED, socket: () => boundAt, herdr: () => (refuse ? failed('connection refused') : ok('')) })
  await startInHerdr($, w)
  await ask($)
  await settled()
  w.blockers.splice(0)
  boundAt = 2
  refuse = true
  await check(w)
  refuse = false
  await check(w)
  expect(w.blockers).toEqual(Array(2).fill(raiseArgs('p-1', 'plan-review')))
})

test('the moment with no socket during a handoff is not a handoff', async ($, on) => {
  let boundAt: number | undefined = 1
  const w = world(on, { env: WATCHED, socket: () => boundAt })
  await startInHerdr($, w)
  await ask($)
  await settled()
  w.blockers.splice(0)
  boundAt = undefined
  await check(w)
  boundAt = 1
  await check(w)
  expect(w.blockers).toEqual([])
})

test('a handoff after the last form is answered raises nothing', async ($, on) => {
  let boundAt = 1
  const w = world(on, { env: WATCHED, socket: () => boundAt })
  await startInHerdr($, w)
  await ask($)
  await answer($)
  expect(await eventually(() => w.blockers.length === 2)).toBe(true)
  w.blockers.splice(0)
  boundAt = 2
  await check(w)
  expect(w.blockers).toEqual([])
})

test('a handoff after the session ended raises nothing', async ($, on) => {
  let boundAt = 1
  const w = world(on, { env: WATCHED, socket: () => boundAt })
  await startInHerdr($, w)
  await ask($)
  await settled()
  await $.session.end({ reason: 'prompt_input_exit', sessionId: SESSION, resume: { id: SESSION } } as never)
  w.blockers.splice(0)
  boundAt = 2
  await check(w)
  expect(w.blockers).toEqual([])
})

test('a session start with a form open raises it twice more, for a herdr that has not seen the agent yet', async ($, on) => {
  const old = { id: 'f-old', title: 'Old', questions: QUESTIONS, status: 'open', replyTo: 'agent' }
  on('state.get', (_, e, next) => (e.key === 'form' ? { value: { value: { shape: 'form-3', value: old }, version: 1 } } : next(e)))
  const w = world(on, { env: WATCHED, socket: () => 1, setting: 'off' })
  await startSession($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  for (let i = 0; i < 4; i++) await check(w)
  expect(w.blockers).toEqual(Array(3).fill(raiseArgs('p-1', 'Old')))
})

test('a form open across /clear is raised again for the session that follows', async ($, on) => {
  const w = world(on, { env: HERDR })
  await startInHerdr($, w)
  await ask($)
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never)
  await startedBy($, 'clear')
  expect(await eventually(() => w.blockers.length === 3)).toBe(true)
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review'), clearArgs('p-1'), raiseArgs('p-1', 'plan-review')])
})

test('a form open across /clear is raised twice more, as after a session start', async ($, on) => {
  const w = world(on, { env: WATCHED, socket: () => 1 })
  await startInHerdr($, w)
  await ask($)
  await settled()
  for (let i = 0; i < 3; i++) await check(w)
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never)
  await startedBy($, 'clear')
  await settled()
  w.blockers.splice(0)
  for (let i = 0; i < 4; i++) await check(w)
  expect(w.blockers).toEqual(Array(2).fill(raiseArgs('p-1', 'plan-review')))
})

test('/clear with no form open leaves the pane alone', async ($, on) => {
  const w = world(on, { env: HERDR })
  await startInHerdr($, w)
  await ask($)
  await answer($)
  await settled()
  w.blockers.splice(0)
  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } } as never)
  await startedBy($, 'clear')
  await settled()
  expect(w.blockers).toEqual([])
})

test('a compaction does not raise a form that is already shown', async ($, on) => {
  const w = world(on, { env: HERDR })
  await startInHerdr($, w)
  await ask($)
  await settled()
  await startedBy($, 'compact')
  await settled()
  expect(w.blockers).toEqual([raiseArgs('p-1', 'plan-review')])
})

test('a long title gives up its end, so herdr keeps the count of forms waiting', async ($, on) => {
  let n = 0
  const w = world(on, { env: HERDR, reply: () => ({ text: JSON.stringify(kitResult(`g${++n}`)) }) })
  await startInHerdr($, w)
  await ask($, { kind: 'x'.repeat(100) })
  await ask($)
  expect(await eventually(() => w.blockers.length === 2)).toBe(true)
  expect(w.blockers).toEqual([raiseArgs('p-1', `${'x'.repeat(79)}…`), raiseArgs('p-1', `${'x'.repeat(63)}…, 1 more waiting`)])
})

test('the blocker is sent through the herdr binary herdr names for its panes', async ($, on) => {
  const w = world(on, { env: { ...HERDR, HERDR_BIN_PATH: '/opt/pinned/herdr' } })
  await drawOn($, 'terminal')
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  expect(w.blockers).toEqual([['/opt/pinned/herdr', ...clearArgs('p-1').slice(1)]])
})

test('a named binary that is gone falls back to herdr on PATH', async ($, on) => {
  const w = world(on, { env: { ...HERDR, HERDR_BIN_PATH: '/opt/gone/herdr' }, herdr: argv => (argv[0] === '/opt/gone/herdr' ? { deny: 'no such command' } : ok('')) })
  await drawOn($, 'terminal')
  expect(await eventually(() => w.blockers.length === 1)).toBe(true)
  expect(w.blockers).toEqual([clearArgs('p-1')])
})
