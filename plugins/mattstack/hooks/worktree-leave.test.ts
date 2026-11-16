import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SESSION = '22222222-2222-4222-8222-222222222222'
const TREE = '/home/alex/.mattstack/rt/worktrees/repo/brisk-lantern'
const MAIN = '/home/alex/code/repo'
const WHY = 'PR #1144 merged'
const POLL_MS = 60_000

type Answer = Record<string, unknown>
// 'pending-slow' answers pending after the 5 s a real wait holds the call.
type WaitReply = Answer | 'reject' | 'pending-slow'

interface WorldOptions {
  // What each await-leave run prints, in order; past the list the verb waits out its timeout.
  answers?: Answer[]
  // Whether ExitWorktree moves the session out (to the checkout it came from).
  exitMoves?: boolean
  // A /cd that is queued behind a turn and has not run yet leaves the session where it was.
  cdQueued?: boolean
  // What each gateForm.wait answers in turn, for a test that loads GATE_FORM; past the list, closed.
  waits?: WaitReply[]
  // Each await-leave answer arrives only after the verb has waited a minute.
  answersLate?: boolean
  // How many session.cwd reads are refused first, as a call on a torn-down hook would be.
  cwdFailures?: number
  // /exit is refused.
  exitDenied?: boolean
}

function world(on: On, opts: WorldOptions = {}) {
  const clock = mock.clock(on)
  const answers = [...(opts.answers ?? [])]
  const state = { cwd: `${TREE}/src`, session: SESSION, cwdFailures: opts.cwdFailures ?? 0 }
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
  on('session.id', () => ({ value: state.session }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => {
    if (state.cwdFailures > 0) {
      state.cwdFailures -= 1
      return { deny: 'refused' }
    }
    return { value: state.cwd }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', async (_, e) => {
    if (e.argv[0] === FAKE_GATE_FORM) {
      if (e.argv[1] === 'wait') waited.count += 1
      if (e.argv[1] === 'ask') asked.push(JSON.parse(e.argv[2] ?? '{}') as Record<string, unknown>)
      let reply = e.argv[1] === 'ask' ? { id: 'q1' } : (waits.shift() ?? { closed: true })
      if (reply === 'pending-slow') {
        waits.unshift(reply)
        await clock.sleep(5_000)
        reply = { pending: true }
      }
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
      if (next && opts.answersLate) await clock.sleep(POLL_MS)
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
    if (e.command === 'exit' && opts.exitDenied) throw new Error('refused')
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

const start = ($: Engine, isInteractive = false) => $.session.start({ cwd: `${TREE}/src`, surface: 'terminal', isInteractive })

const LEAVING = { state: 'leaving', why: WHY, mainCheckout: MAIN }

test('the watch runs await-leave on the session cwd with its id, start time, start folder and a 60 s timeout', async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.settle()

  const argv = w.awaits[0]!
  expect(argv[0]).toBe('rt')
  expect(argv.slice(1, 4)).toEqual(['worktree', 'await-leave', `${TREE}/src`])
  expect(argv.slice(4, 6)).toEqual(['--session', SESSION])
  expect(argv[6]).toBe('--started')
  expect(Number.isFinite(Date.parse(argv[7]!))).toBe(true)
  expect(argv.slice(8)).toEqual(['--start-cwd', `${TREE}/src`, '--timeout', '60'])
  expect(w.timeouts[0]).toBeGreaterThan(60_000)
})

test('every poll carries the folder the session started in, not the one it is in now', async ($, on) => {
  const w = world(on, { answers: [{ state: 'none' }, { state: 'none' }] })
  await start($)
  await w.clock.settle()

  w.state.cwd = '/elsewhere'
  await w.clock.advance(POLL_MS)
  const argv = w.awaits[1]!
  expect(argv[3]).toBe('/elsewhere')
  expect(argv.slice(8, 10)).toEqual(['--start-cwd', `${TREE}/src`])
  expect(argv[7]).toBe(w.awaits[0]![7])
})

test('the start time and folder are not kept in $.state', async ($, on) => {
  const keys: string[] = []
  on('state.set', async (_, e, next) => {
    keys.push((e as { key?: string }).key ?? '')
    return next(e)
  })
  const w = world(on, { answers: [{ state: 'none' }] })
  await start($)
  await w.clock.settle()

  expect(keys).toEqual(['worktreeLeaveWatch'])
})

test('a refused read of the watch token does not end the watch', async ($, on) => {
  let refusals = 1
  on('state.get', async (_, e, next) => {
    if ((e as { key?: string }).key === 'worktreeLeaveWatch' && refusals > 0) {
      refusals -= 1
      return { deny: 'refused' }
    }
    return next(e)
  })
  const w = world(on, { answers: [{ state: 'reclaimed', mainCheckout: MAIN }], exitMoves: true })
  await start($)
  await w.clock.settle()
  expect(w.awaits).toHaveLength(0)

  await w.clock.advance(POLL_MS)
  expect(w.awaits.length).toBeGreaterThan(0)
  expect(w.logs).toEqual([`This worktree was reused: left the worktree; now in ${MAIN}`])
})

test('leaving and a Close pick runs /exit', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [LEAVING], waits: [{ pending: true }, { value: 'close' }] })
  await start($)
  await w.clock.settle()

  expect(w.asked[0]).toMatchObject({
    title: WHY,
    context: 'rt is cleaning up this worktree. No answer in 2 minutes moves this session out.',
    kind: 'confirm',
    options: [
      { value: 'leave', label: 'Exit worktree and continue' },
      { value: 'close', label: 'Close session' },
    ],
    timeoutMs: 120_000,
  })
  expect(w.asked[0]).not.toHaveProperty('label')
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

test('a second start stops the first watch, which never acts on the answer it was waiting for', async ($, on) => {
  const w = world(on, { answers: [{ state: 'reclaimed', mainCheckout: MAIN }, { state: 'none' }], answersLate: true, exitMoves: true })
  await start($)
  await w.clock.settle()
  await start($)
  await w.clock.settle()
  expect(w.awaits).toHaveLength(2)

  // The first watch's reclaimed answer arrives after the second start; the second watch's none keeps it polling.
  await w.clock.advance(POLL_MS)
  expect(w.tools).toEqual([])
  expect(w.logs).toEqual([])

  // From here only one watch polls: one more run a minute.
  await w.clock.advance(POLL_MS)
  expect(w.awaits).toHaveLength(3)
  await w.clock.advance(POLL_MS)
  expect(w.awaits).toHaveLength(4)
  expect(w.tools).toEqual([])
})

test('an interactive start watches too', async ($, on) => {
  const w = world(on, { answers: [{ state: 'reclaimed', mainCheckout: MAIN }], exitMoves: true })
  await start($, true)
  await w.clock.settle()

  expect(w.awaits[0]?.[3]).toBe(`${TREE}/src`)
  expect(w.logs).toEqual([`This worktree was reused: left the worktree; now in ${MAIN}`])
})

test('each pass reads the session id again, so a /clear is followed', async ($, on) => {
  const w = world(on, { answers: [{ state: 'none' }, { state: 'none' }] })
  await start($)
  await w.clock.settle()
  expect(w.awaits[0]?.[5]).toBe(SESSION)

  w.state.session = '33333333-3333-4333-8333-333333333333'
  await w.clock.advance(POLL_MS)
  expect(w.awaits[1]?.[5]).toBe('33333333-3333-4333-8333-333333333333')
})

test('a pass that fails waits a minute and the watch goes on', async ($, on) => {
  const w = world(on, { answers: [{ state: 'reclaimed', mainCheckout: MAIN }], exitMoves: true, cwdFailures: 2 })
  await start($)
  await w.clock.settle()
  expect(w.awaits).toHaveLength(0)

  await w.clock.advance(POLL_MS)
  expect(w.awaits.length).toBeGreaterThan(0)
  expect(w.logs).toEqual([`This worktree was reused: left the worktree; now in ${MAIN}`])
})

test('a refused /exit falls through to leaving', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [LEAVING], exitMoves: true, exitDenied: true, waits: [{ value: 'close' }] })
  await start($)
  await w.clock.settle()

  expect(w.commands).toEqual([{ command: 'exit', args: '' }])
  expect(w.tools).toEqual([expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' })])
  expect(w.logs).toEqual([`${WHY}: left the worktree; now in ${MAIN}`])
})

test('a question that stays pending past its deadline counts as timed out and leaves', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [LEAVING], exitMoves: true, waits: ['pending-slow'] })
  await start($)
  await w.clock.settle()
  await w.clock.advance(120_000)
  expect(w.tools).toEqual([])

  await w.clock.advance(40_000)
  expect(w.tools).toEqual([expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' })])
  expect(w.logs).toEqual([`${WHY}: left the worktree; now in ${MAIN}`])
})

test('after leaving, the tree it left is not watched again while the move is queued', async ($, on) => {
  const w = world(on, { answers: [{ state: 'reclaimed', mainCheckout: MAIN }, { state: 'reclaimed', mainCheckout: MAIN }], cdQueued: true })
  await start($)
  await w.clock.settle()
  expect(w.logs).toHaveLength(1)

  expect(w.logs).toEqual([`This worktree was reused: leaving the worktree; moving to ${MAIN}`])
  expect(w.appended[0]!.text).toContain(`moving to ${MAIN}`)
  expect(w.appended[0]!.text).not.toContain('is now')

  await w.clock.advance(3 * POLL_MS)
  expect(w.awaits).toHaveLength(1)
  expect(w.logs).toHaveLength(1)
})

test('a session that moved to another tree while the verb waited is not asked or moved', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [{ ...LEAVING, tree: TREE }], answersLate: true, exitMoves: true })
  await start($)
  await w.clock.settle()

  w.state.cwd = '/home/alex/.mattstack/rt/worktrees/repo/other-tree'
  await w.clock.advance(POLL_MS)
  expect(w.asked).toEqual([])
  expect(w.tools).toEqual([])
  expect(w.commands).toEqual([])
  expect(w.awaits.length).toBeGreaterThan(1)
  expect(w.awaits.at(-1)![3]).toBe('/home/alex/.mattstack/rt/worktrees/repo/other-tree')
})

test('a session that moved out while the question was open is not moved again', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [{ ...LEAVING, tree: TREE }], exitMoves: true, waits: ['pending-slow'] })
  await start($)
  await w.clock.settle()
  expect(w.asked).toHaveLength(1)

  w.state.cwd = '/home/alex/.mattstack/rt/worktrees/repo/other-tree'
  await w.clock.advance(160_000)
  expect(w.tools).toEqual([])
  expect(w.commands).toEqual([])
  expect(w.logs).toEqual([])
})

test('a session that moved within the tree during the question still gets the /cd out', { plugins: [GATE_FORM] }, async ($, on) => {
  const w = world(on, { answers: [{ ...LEAVING, tree: TREE }], waits: ['pending-slow'] })
  await start($)
  await w.clock.settle()

  w.state.cwd = `${TREE}/tests`
  await w.clock.advance(160_000)
  expect(w.tools).toEqual([expect.objectContaining({ tool: 'ExitWorktree', action: 'keep' })])
  expect(w.commands).toEqual([{ command: 'cd', args: MAIN }])
  expect(w.logs).toEqual([`${WHY}: left the worktree; now in ${MAIN}`])
})
