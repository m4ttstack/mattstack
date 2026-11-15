import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SESSION = '22222222-2222-4222-8222-222222222222'
const TREE = '/home/alex/.mattstack/rt/worktrees/repo/brisk-lantern'
const MAIN = '/home/alex/code/repo'
const WHY = 'PR #1144 merged'
const POLL_MS = 60_000

type Answer = Record<string, unknown>
type WaitReply = Answer | 'reject'

interface WorldOptions {
  // What each await-leave run prints, in order; past the list the verb waits out its timeout.
  answers?: Answer[]
  // Whether ExitWorktree moves the session out (to the checkout it came from).
  exitMoves?: boolean
  // A /cd that is queued behind a turn and has not run yet leaves the session where it was.
  cdQueued?: boolean
  // What each gateForm.wait answers in turn, for a test that loads GATE_FORM; past the list, closed.
  waits?: WaitReply[]
}

function world(on: On, opts: WorldOptions = {}) {
  const clock = mock.clock(on)
  const answers = [...(opts.answers ?? [])]
  const state = { cwd: `${TREE}/src` }
  const awaits: (readonly string[])[] = []
  const timeouts: (number | undefined)[] = []
  const tools: Record<string, unknown>[] = []
  const commands: { command: string; args: string }[] = []
  const logs: string[] = []
  const appended: { type: string; text: string }[] = []
  const asked: Record<string, unknown>[] = []
  const waits = [...(opts.waits ?? [])]
  const waited = { count: 0 }

  mock.env(on, { HOME: '/home/alex' })
  on('session.id', () => ({ value: SESSION }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: state.cwd }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', async (_, e) => {
    if (e.argv[0] === FAKE_GATE_FORM) {
      if (e.argv[1] === 'wait') waited.count += 1
      if (e.argv[1] === 'ask') asked.push(JSON.parse(e.argv[2] ?? '{}') as Record<string, unknown>)
      const reply = e.argv[1] === 'ask' ? { id: 'q1' } : (waits.shift() ?? { closed: true })
      const failed = reply === 'reject'
      return { value: { exitCode: failed ? 1 : 0, stdout: failed ? '' : JSON.stringify(reply), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const isAwait = e.argv[1] === 'worktree' && e.argv[2] === 'await-leave'
    if (isAwait) {
      awaits.push(e.argv)
      timeouts.push(e.init?.timeoutMs)
    }
    let stdout = ''
    if (isAwait) {
      const next = answers.shift()
      if (next) stdout = JSON.stringify(next)
      else {
        await clock.sleep(POLL_MS)
        stdout = JSON.stringify({ state: 'timeout' })
      }
    }
    return { value: { exitCode: 0, stdout: `${stdout}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', (_, e) => {
    tools.push(e as unknown as Record<string, unknown>)
    if (e.tool === 'ExitWorktree' && opts.exitMoves) state.cwd = MAIN
    return { result: [{ type: 'text', text: 'ok' }], text: 'ok' } as never
  })
  on('command.run', (_, e) => {
    commands.push({ command: e.command, args: e.args })
    if (e.command === 'cd' && !opts.cdQueued) state.cwd = e.args
    return {}
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('session.append', (_, e, next) => {
    const text = e.message.content.map(block => (block.type === 'text' ? block.text : '')).join('')
    appended.push({ type: e.message.type, text })
    return next(e)
  })

  return { clock, state, awaits, timeouts, tools, commands, logs, appended, asked, waited }
}

const FAKE_GATE_FORM = 'fake-gate-form'

// Stands in for gate-form 0.6.0. A test plugin's hooks run apart from the test body,
// so each call crosses to the world's process.run, which records the ask and answers each wait.
const GATE_FORM = {
  name: 'gate-form',
  register(on: On) {
    on('engine.create', async ($, e, next) => {
      const built = await next(e)
      return { ...built, gateForm: { ask: async () => ({ id: '' }), wait: async () => ({ closed: true as const }) } }
    })
    on('gateForm.ask', async ($, e) => {
      const { stdout } = await $.process.run(['fake-gate-form', 'ask', JSON.stringify(e)])
      return { value: JSON.parse(stdout) as { id: string } }
    })
    on('gateForm.wait', async ($, e) => {
      const { stdout, exitCode } = await $.process.run(['fake-gate-form', 'wait', e.id])
      if (exitCode !== 0) return { deny: 'call took longer than 10 s' }
      return { value: JSON.parse(stdout) as never }
    })
  },
}

const start = ($: Engine) =>
  $.session.start({ cwd: `${TREE}/src`, surface: 'terminal', isInteractive: false })

const LEAVING = { state: 'leaving', why: WHY, mainCheckout: MAIN }

test('the watch runs await-leave on the session cwd with its id, start time and a 60 s timeout', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()

  const argv = w.awaits[0]!
  expect(argv[0]).toBe('rt')
  expect(argv.slice(1, 4)).toEqual(['worktree', 'await-leave', `${TREE}/src`])
  expect(argv.slice(4, 6)).toEqual(['--session', SESSION])
  expect(argv[6]).toBe('--started')
  expect(argv.slice(8)).toEqual(['--timeout', '60'])
  expect(w.timeouts[0]).toBeGreaterThan(60_000)
})

test('leaving and a Close pick runs /exit', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [LEAVING], waits: [{ pending: true }, { value: 'close' }] })
  await start($)
  await w.clock.settle()

  expect(w.asked[0]).toMatchObject({
    title: WHY,
    label: 'Your worktree is being cleaned up.',
    options: [
      { value: 'close', label: 'Close session' },
      { value: 'leave', label: 'Exit worktree and continue' },
    ],
    timeoutMs: 120_000,
  })
  expect(w.commands).toEqual([{ command: 'exit', args: '' }])
  expect(w.tools).toEqual([])
  await w.clock.advance(5 * POLL_MS)
  expect(w.awaits.length).toBe(1)
})

test('leaving and an Exit pick calls ExitWorktree keep and appends the note', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [LEAVING], exitMoves: true, waits: [{ value: 'leave' }] })
  await start($)
  await w.clock.settle()

  expect(w.tools).toEqual([expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' })])
  expect(w.commands).toEqual([])
  expect(w.logs).toEqual([`${WHY}: left the worktree; now in ${MAIN}`])
  expect(w.appended).toHaveLength(1)
  expect(w.appended[0]!.type).toBe('user')
  expect(w.appended[0]!.text).toContain(`${WHY}: left the worktree; now in ${MAIN}`)
  expect(w.appended[0]!.text).toContain(`working directory is now ${MAIN}`)
})

test('a timed-out question leaves', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [LEAVING], exitMoves: true, waits: [{ timedOut: true }] })
  await start($)
  await w.clock.settle()

  expect(w.asked).toHaveLength(1)
  expect(w.tools).toEqual([expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' })])
  expect(w.logs).toEqual([`${WHY}: left the worktree; now in ${MAIN}`])
})

test('reclaimed leaves without asking', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [{ state: 'reclaimed', mainCheckout: MAIN }], exitMoves: true })
  await start($)
  await w.clock.settle()

  expect(w.asked).toEqual([])
  expect(w.tools).toEqual([expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' })])
  expect(w.logs).toEqual([`This worktree was reused: left the worktree; now in ${MAIN}`])
})

test('ExitWorktree that leaves the cwd inside falls back to /cd mainCheckout', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [LEAVING], waits: [{ value: 'leave' }] })
  await start($)
  await w.clock.settle()

  expect(w.tools).toEqual([expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' })])
  expect(w.commands).toEqual([{ command: 'cd', args: MAIN }])
  expect(w.state.cwd).toBe(MAIN)
  expect(w.logs).toEqual([`${WHY}: left the worktree; now in ${MAIN}`])
})

test('no gateForm noun leaves without asking', async ($, on) => {
  const w = world(on, { answers: [LEAVING], exitMoves: true })
  await start($)
  await w.clock.settle()

  expect(w.tools).toEqual([expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' })])
  expect(w.logs).toEqual([`${WHY}: left the worktree; now in ${MAIN}`])
})

test('rejected wait retries, then leaves', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [LEAVING], exitMoves: true, waits: ['reject', 'reject', 'reject'] })
  await start($)
  await w.clock.settle()

  expect(w.asked).toHaveLength(1)
  expect(w.waited.count).toBe(3)
  expect(w.tools).toEqual([expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' })])
  expect(w.logs).toEqual([`${WHY}: left the worktree; now in ${MAIN}`])
})

test('a wait that rejects fewer times than the bound still takes the pick', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [LEAVING], waits: ['reject', 'reject', { value: 'close' }] })
  await start($)
  await w.clock.settle()

  expect(w.commands).toEqual([{ command: 'exit', args: '' }])
})

test('none sleeps 60 s and asks again from the cwd it reads then', async ($, on) => {
  const w = world(on, { answers: [{ state: 'none' }, { state: 'none' }] })
  await start($)
  await w.clock.settle()
  expect(w.awaits).toHaveLength(1)

  w.state.cwd = '/elsewhere'
  await w.clock.advance(POLL_MS)
  expect(w.awaits).toHaveLength(2)
  expect(w.awaits[1]![3]).toBe('/elsewhere')
})

test('a second session.start does not start a second watch', async ($, on) => {
  const w = world(on)
  await start($)
  await start($)
  await w.clock.settle()

  expect(w.awaits).toHaveLength(1)
})

test('after leaving, the tree it left is not watched again while the move is queued', async ($, on) => {
  const w = world(on, { answers: [{ state: 'reclaimed', mainCheckout: MAIN }, { state: 'reclaimed', mainCheckout: MAIN }], cdQueued: true })
  await start($)
  await w.clock.settle()
  expect(w.logs).toHaveLength(1)

  await w.clock.advance(3 * POLL_MS)
  expect(w.awaits).toHaveLength(1)
  expect(w.logs).toHaveLength(1)
})
