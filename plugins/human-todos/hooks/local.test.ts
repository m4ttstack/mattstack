import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Todo } from '../types'
import { SESSION, children, exits, hangs, pid, press, processTree, startSession, world } from './test-world'
import type { Child, Piece } from './test-world'

type On = Parameters<typeof world>[0]

const PREFIX = 'print -u2 "__human_todo_pid__$$"; '
const WITHDRAW = 'mcp__human-todos__withdraw'
const LIST = 'mcp__human-todos__list'

const PANE = {
  plugin: 'human-todos',
  component: 'Pane',
  requestId: 'human-todos',
  surface: 'terminal',
  props: { title: 'Human Todos', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const todo = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'run', title: 'T', script: 'make', status: 'open', ...over })

// The buttons the plain drawer shows for the same pane: the terminal draws a Client, so they are read where the engine draws them.
async function plainKeys($: Engine): Promise<(string | undefined)[]> {
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
  await ui.unmount()
  return keys
}
const out = (text: string) => ({ stream: 'stdout' as const, text })
const WALK = 'walk() { for c in $(pgrep -P "$1"); do walk "$c"; done; echo "$1"; }'
const killing = (n: number, sig = 'TERM') => ['/bin/sh', '-c', `${WALK}; kill -${sig} $(walk ${n}) 2>/dev/null`]

type Setup = {
  env?: Record<string, string>
  // Answers the child for a script (the text after the pid line); it may hold on the test's clock.
  script: (script: string) => Child
  // Answers a command run beneath the plugin (the kill, the log removal).
  run?: (argv: readonly string[]) => void
  // Sees each log write; it may throw to refuse one, or hold it until a promise settles.
  write?: (text: string) => void | Promise<unknown>
}

async function seeded($: Engine, on: On, list: Todo[], { env = {}, script, run, write }: Setup) {
  const w = world(on, { entries: { [`list:${SESSION}`]: { todos: list, nextId: 20, savedAt: 1_000_000 } } })
  const toasts: string[] = []
  const ran: string[][] = []
  const writes: { path: string; text: string }[] = []
  const sent = w.sent
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    run?.(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.write', async (_, e) => {
    await write?.(e.text)
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  const spawned = children(on, ({ argv }) => script((argv.at(-1) ?? '').replace(PREFIX, '')))
  mock.env(on, { HOME: '/home/u', ...env })
  await startSession($)
  await $.command.run({ command: 'todos-runner', args: 'local' })
  const pane = await $.ui.mount(PANE)
  const run1 = async (id: string) => {
    await press(pane, id, 'run')
    await press(pane, id, 'confirm')
  }
  const items = () => (w.store.get(`list:${SESSION}`) as { todos: Todo[] }).todos
  const item = (id: string) => items().find(t => t.id === id)
  return { ...w, pane, toasts, ran, writes, sent, spawned, run1, item }
}

test('start spawns the script after the pid line, in the item\'s cwd, and keeps a log under the cache folder', async ($, on) => {
  const { run1, spawned, writes, item, sent, clock } = await seeded($, on, [todo({ cwd: '/work' })], {
    script: () => exits([pid(4242), out('hello\n')]),
  })

  await run1('1')
  await clock.settle()

  expect(spawned).toEqual([{ argv: ['/bin/zsh', '-lc', `${PREFIX}make`], cwd: '/work' }])
  expect(writes.map(w => w.path)).toHaveLength(2)
  expect(writes[0]).toMatchObject({ text: '' })
  expect(writes[0]?.path).toMatch(/^\/home\/u\/Library\/Caches\/human-todos\/sess-1-1-[a-z0-9]+\.log$/)
  expect(writes[1]).toEqual({ path: writes[0]?.path, text: 'hello\n' })
  expect(item('1')).toMatchObject({ status: 'done', exitCode: 0, outputTail: 'hello' })
  expect(sent).toEqual(['[Human Todos] The user ran #1 "T" from the pane: exit 0.\n```\nhello\n```'])
})

test('XDG_CACHE_HOME, when set, holds the log instead of the home Library', async ($, on) => {
  const { run1, writes, clock } = await seeded($, on, [todo({})], {
    env: { XDG_CACHE_HOME: '/xdg' },
    script: () => exits([pid(1)]),
  })

  await run1('1')
  await clock.settle()

  expect(writes[0]?.path).toMatch(/^\/xdg\/human-todos\/sess-1-1-[a-z0-9]+\.log$/)
})

test('output updates the live tail and the log at most once a second, keeping 15 lines', async ($, on) => {
  const lines = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, n) => `line ${from + n}\n`).join('')
  const { run1, writes, item, clock } = await seeded($, on, [todo({})], {
    script: async function* () {
      yield pid(7)
      yield out(`${lines(1, 8)}\n   \n`)
      await clock.sleep(500)
      yield out(lines(9, 20))
      await clock.sleep(10_000)
      return { code: 0, signal: null }
    },
  })

  await run1('1')
  await clock.sleeping()
  await clock.advance(999)
  expect(item('1')?.liveTail).toEqual([])
  expect(writes).toHaveLength(1)

  await clock.advance(1)
  expect(item('1')?.liveTail).toEqual(Array.from({ length: 15 }, (_, n) => `line ${n + 6}`))
  expect(writes).toHaveLength(2)
  expect(writes[1]?.text).not.toContain('__human_todo_pid__')
  expect(writes[1]?.text).toContain('line 1\n')

  await clock.advance(500)
  expect(writes).toHaveLength(2)
})

test('a script with quotes, a dollar, backslashes and a newline reaches the shell unchanged', async ($, on) => {
  const script = `echo 'a "b" $HOME \\\\ c'\necho "it's \\$x"\n`
  const { run1, spawned, clock } = await seeded($, on, [todo({ script })], { script: () => exits([pid(1)]) })

  await run1('1')
  await clock.settle()

  expect(spawned[0]?.argv).toEqual(['/bin/zsh', '-lc', `${PREFIX}${script}`])
})

test('a non-zero exit fails the item and tells the agent the code', async ($, on) => {
  const { run1, item, sent, clock } = await seeded($, on, [todo({})], {
    script: () => exits([pid(1), { stream: 'stderr', text: 'nope\n' }], 2),
  })

  await run1('1')
  await clock.settle()

  expect(item('1')).toMatchObject({ status: 'failed', exitCode: 2, outputTail: 'nope' })
  expect(sent).toEqual(['[Human Todos] The user ran #1 "T" from the pane: exit 2.\n```\nnope\n```'])
})

test('a child that breaks mid-run ends the item with exit -1 and the error after its output', async ($, on) => {
  const { run1, item, clock } = await seeded($, on, [todo({})], {
    script: async function* () {
      yield pid(1)
      yield out('half\n')
      throw new Error('pipe closed')
    },
  })

  await run1('1')
  await clock.settle()

  expect(item('1')).toMatchObject({ status: 'failed', exitCode: -1 })
  expect(item('1')?.outputTail).toMatch(/^half\n+\S+/)
})

// The kill ends the child the way the shell would: the stand-in releases it when the kill command runs.
function killable(first: Piece[] = [pid(4242)]) {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const child = async function* (): Child {
    yield* first
    await gate
    return { code: null, signal: 'SIGTERM' }
  }
  return { child, release }
}

test('Stop signals the script and its children, then reports the run as stopped', async ($, on) => {
  const k = killable()
  const { run1, ran, item, sent, toasts, clock, pane } = await seeded($, on, [todo({})], { script: k.child, run: k.release })
  await run1('1')
  await clock.settle()

  await press(pane, '1', 'stop')
  await clock.settle()

  expect(toasts).toEqual(['Stopping #1'])
  expect(ran).toEqual([killing(4242)])
  expect(item('1')).toMatchObject({ status: 'open', note: 'Stopped', isStopping: false })
  expect(sent).toEqual(['[Human Todos] The user stopped #1 "T" before it finished. It is open again.'])
})

// A three-level tree under the script's shell: 100 > 101, 102; 102 > 103, 104.
const TREE = { 100: [101, 102], 102: [103, 104] }
const TREE_PIDS = [100, 101, 102, 103, 104]

test('Stop signals every process under the script, leaves first, not only its direct children', async ($, on) => {
  const tree = processTree(TREE)
  const k = killable([pid(100)])
  const { run1, ran, item, clock, pane } = await seeded($, on, [todo({})], {
    script: k.child,
    run: argv => {
      tree.run(argv)
      if (!tree.alive().includes(100)) k.release()
    },
  })
  await run1('1')
  await clock.settle()

  await press(pane, '1', 'stop')
  await clock.settle()

  expect(ran).toEqual([killing(100)])
  expect(tree.signalled).toEqual([101, 103, 104, 102, 100].map(p => ({ pid: p, sig: 'TERM' })))
  expect(tree.alive()).toEqual([])
  expect(item('1')).toMatchObject({ status: 'open', note: 'Stopped' })
})

test('Force stop kills the whole tree of a script that ignored Stop, and the run then reports as stopped', async ($, on) => {
  const tree = processTree(TREE, { deaf: TREE_PIDS })
  const k = killable([pid(100)])
  const { run1, ran, item, sent, toasts, clock, pane } = await seeded($, on, [todo({})], {
    script: k.child,
    run: argv => {
      tree.run(argv)
      if (!tree.alive().includes(100)) k.release()
    },
  })
  await run1('1')
  await clock.settle()

  await press(pane, '1', 'stop')
  await clock.settle()

  expect(tree.alive()).toEqual(TREE_PIDS)
  expect(item('1')).toMatchObject({ status: 'running', isStopping: true })
  expect(await plainKeys($)).toEqual(['close', 'openLog-1', 'forceStop-1'])

  await press(pane, '1', 'forceStop')
  await clock.settle()

  expect(toasts).toEqual(['Stopping #1', 'Force stopping #1'])
  expect(ran).toEqual([killing(100), killing(100, 'KILL')])
  expect(tree.alive()).toEqual([])
  expect(item('1')).toMatchObject({ status: 'open', note: 'Stopped', isStopping: false })
  expect(sent).toEqual(['[Human Todos] The user stopped #1 "T" before it finished. It is open again.'])
})

test('withdrawing a running item signals every process under its script', async ($, on) => {
  const tree = processTree(TREE)
  const k = killable([pid(100)])
  const { run1, clock } = await seeded($, on, [todo({})], {
    script: k.child,
    run: argv => {
      tree.run(argv)
      k.release()
    },
  })
  await run1('1')
  await clock.settle()

  await $.tool.call({ tool: WITHDRAW, id: '1' })
  await clock.advance(5000)

  expect(tree.alive()).toEqual([])
})

test('Stop before the pid is known asks to try again and brings the button back', async ($, on) => {
  const { run1, ran, item, toasts, clock, pane } = await seeded($, on, [todo({})], { script: hangs })
  await run1('1')
  await clock.settle()

  await press(pane, '1', 'stop')

  expect(toasts).toEqual(['Stopping #1', 'Still starting; try Stop again in a moment'])
  expect(ran).toEqual([])
  expect(item('1')).toMatchObject({ status: 'running', isStopping: false })
  expect(await plainKeys($)).toContain('stop-1')
})

test('a kill that cannot run puts Stop back and does not report a stop', async ($, on) => {
  const k = killable()
  const { run1, item, sent, toasts, clock, pane } = await seeded($, on, [todo({})], {
    script: k.child,
    run: () => {
      throw new Error('refused')
    },
  })
  await run1('1')
  await clock.settle()

  await press(pane, '1', 'stop')
  await clock.settle()

  expect(toasts).toEqual(['Stopping #1', 'Could not stop #1'])
  expect(item('1')).toMatchObject({ status: 'running', isStopping: false })
  expect(sent).toEqual([])
  k.release()
  await clock.settle()
  expect(item('1')).toMatchObject({ status: 'failed' })
})

test('two runs at once each have their own child, token and log, and one finishing leaves the other alone', async ($, on) => {
  const { run1, item, sent, ran, spawned, writes, clock, pane } = await seeded(
    $,
    on,
    [todo({ id: '1', script: 'first' }), todo({ id: '2', script: 'second' })],
    {
      script: async function* (script) {
        yield pid(script === 'first' ? 11 : 22)
        yield out(`${script} output\n`)
        await clock.sleep(script === 'first' ? 500 : 60_000)
        return { code: 0, signal: null }
      },
    },
  )

  await run1('1')
  await run1('2')
  await clock.sleeping(2)
  await clock.advance(1000)

  expect(spawned.map(s => s.argv.at(-1))).toEqual([`${PREFIX}first`, `${PREFIX}second`])
  expect(item('1')).toMatchObject({ status: 'done', outputTail: 'first output' })
  expect(item('2')).toMatchObject({ status: 'running', liveTail: ['second output'], isStopping: false })
  expect(item('1')?.token).not.toBe(item('2')?.token)
  expect(item('1')?.logPath).not.toBe(item('2')?.logPath)
  expect(writes.filter(w => w.path === item('2')?.logPath).at(-1)?.text).toBe('second output\n')
  expect(sent).toEqual(['[Human Todos] The user ran #1 "T" from the pane: exit 0.\n```\nfirst output\n```'])

  await press(pane, '2', 'stop')
  expect(ran).toEqual([killing(22)])
})

test('withdrawing a running item kills its child, removes its log and reports nothing', async ($, on) => {
  const k = killable()
  const { run1, ran, item, sent, clock } = await seeded($, on, [todo({})], { script: k.child, run: k.release })
  await run1('1')
  await clock.settle()
  const log = item('1')?.logPath

  await $.tool.call({ tool: WITHDRAW, id: '1' })
  await clock.advance(5000)

  expect(ran).toEqual([killing(4242), ['rm', '-f', '--', log]])
  expect(sent).toEqual([])
  expect((await $.tool.call({ tool: LIST })).result).toBe('No to-dos.')
})

test('a withdraw that lands while the run is set up starts no script and leaves no log', async ($, on) => {
  let withdrawn: Promise<unknown> | undefined
  const { run1, ran, sent, spawned, clock } = await seeded($, on, [todo({})], {
    script: () => exits(0),
    write: text => {
      if (text === '' && !withdrawn) withdrawn = $.tool.call({ tool: WITHDRAW, id: '1' })
    },
  })

  await run1('1')
  await withdrawn
  await clock.settle()

  expect(spawned).toHaveLength(0)
  expect(ran.filter(argv => argv[0] === 'rm')).toHaveLength(1)
  expect(sent).toEqual([])
})

test('an in-session /resume ends a running local script, keeps its log with the saved list and reports nothing', async ($, on) => {
  const k = killable()
  const { run1, ran, item, sent, clock } = await seeded($, on, [todo({})], { script: k.child, run: k.release })
  await run1('1')
  await clock.settle()
  const log = item('1')?.logPath

  await $.session.end({ reason: 'resume', sessionId: SESSION, resume: { id: 'sess-2' } })
  await clock.advance(5000)

  expect(ran).toEqual([killing(4242)])
  expect(item('1')).toMatchObject({ status: 'running', logPath: log })
  expect(sent).toEqual([])
})

test('an in-session /resume during setup starts no script and keeps the left session\'s list saved', async ($, on) => {
  let left: Promise<unknown> | undefined
  const { run1, sent, spawned, clock, store } = await seeded($, on, [todo({})], {
    script: () => exits(0),
    write: text => {
      if (text !== '' || left) return
      left = $.session.end({ reason: 'resume', sessionId: SESSION, resume: { id: 'sess-2' } })
      return left
    },
  })

  await run1('1')
  await left
  await clock.advance(5000)

  expect(spawned).toHaveLength(0)
  expect((store.get(`list:${SESSION}`) as { todos: Todo[] }).todos.map(t => t.id)).toEqual(['1'])
  expect(sent).toEqual([])
})

test('an in-session /resume during a log write keeps the left session\'s list saved', async ($, on) => {
  const k = killable([pid(4242), out('one\n')])
  let left: Promise<unknown> | undefined
  const { run1, sent, clock, store } = await seeded($, on, [todo({})], {
    script: k.child,
    run: k.release,
    write: text => {
      if (text === '' || left) return
      left = $.session.end({ reason: 'resume', sessionId: SESSION, resume: { id: 'sess-2' } })
      return left
    },
  })

  await run1('1')
  await clock.advance(1000)
  await left
  await clock.advance(5000)

  expect((store.get(`list:${SESSION}`) as { todos: Todo[] }).todos.map(t => t.id)).toEqual(['1'])
  expect(sent).toEqual([])
})

test('a finished item\'s log is removed with rm -f when it is cleared', async ($, on) => {
  const { run1, ran, item, clock, pane } = await seeded($, on, [todo({})], { script: () => exits([pid(1)]) })
  await run1('1')
  await clock.settle()
  const log = item('1')?.logPath

  await pane.post({ type: 'clear' })

  expect(ran).toEqual([['rm', '-f', '--', log]])
})

test('Show does nothing for a local run', async ($, on) => {
  const { run1, ran, toasts, clock, pane } = await seeded($, on, [todo({})], { script: hangs })
  await run1('1')
  await clock.settle()

  await press(pane, '1', 'show').catch(() => undefined)

  expect(ran).toEqual([])
  expect(toasts).toEqual([])
})

test('a rerun removes the last run\'s log, so clearing leaves no log behind', async ($, on) => {
  const k = killable()
  let starts = 0
  const { run1, ran, item, clock, pane } = await seeded($, on, [todo({})], {
    script: () => (starts++ === 0 ? k.child() : exits([pid(1)])),
    run: k.release,
  })
  await run1('1')
  await clock.settle()
  const first = item('1')?.logPath
  await press(pane, '1', 'stop')
  await clock.settle()

  await run1('1')
  await clock.settle()
  const second = item('1')?.logPath
  await pane.post({ type: 'clear' })

  expect(first).not.toBe(second)
  expect(ran).toEqual([killing(4242), ['rm', '-f', '--', first], ['rm', '-f', '--', second]])
})

test('a pid split across pieces is read whole, never short', async ($, on) => {
  const k = killable([
    { stream: 'stderr', text: '__human_to' },
    { stream: 'stderr', text: 'do_pid__12' },
    { stream: 'stderr', text: '34\nreal output\n' },
  ])
  const { run1, ran, item, clock, pane } = await seeded($, on, [todo({})], { script: k.child, run: k.release })
  await run1('1')
  await clock.settle()

  await press(pane, '1', 'stop')
  await clock.settle()

  expect(ran).toEqual([killing(1234)])
  expect(item('1')).toMatchObject({ status: 'open', outputTail: 'real output' })
})

test('marker text a script prints later stays in its output and never replaces the pid', async ($, on) => {
  const k = killable([
    pid(4242),
    { stream: 'stderr', text: '__human_todo_pid__999\n' },
    { stream: 'stderr', text: 'x __human_todo_pid__5\n' },
  ])
  const { run1, ran, item, clock, pane } = await seeded($, on, [todo({})], { script: k.child, run: k.release })
  await run1('1')
  await clock.settle()

  await press(pane, '1', 'stop')
  await clock.settle()

  expect(ran).toEqual([killing(4242)])
  expect(item('1')?.outputTail).toBe('__human_todo_pid__999\nx __human_todo_pid__5')
})

test('output that precedes the pid line, and a half line with no newline at the end, are kept', async ($, on) => {
  const { run1, item, clock } = await seeded($, on, [todo({})], {
    script: () => exits([{ stream: 'stderr', text: 'profile noise\n' }, pid(7), { stream: 'stderr', text: 'tail' }]),
  })

  await run1('1')
  await clock.settle()

  expect(item('1')).toMatchObject({ status: 'done', outputTail: 'profile noise\ntail' })
})

test('a log that cannot be written toasts once for the run and the run still reports', async ($, on) => {
  const { run1, item, toasts, sent, clock } = await seeded($, on, [todo({})], {
    write: text => {
      if (text !== '') throw new Error('disk full')
    },
    script: async function* () {
      yield pid(7)
      yield out('one\n')
      await clock.sleep(1500)
      yield out('two\n')
      await clock.sleep(1500)
      return { code: 0, signal: null }
    },
  })

  await run1('1')
  await clock.sleeping()
  await clock.advance(3000)

  expect(toasts).toEqual(['Could not save the output of #1'])
  expect(item('1')).toMatchObject({ status: 'done', outputTail: 'one\ntwo' })
  expect(sent).toHaveLength(1)
})

test('output past 4 MiB rolls: the log keeps its last 1 MiB, under the write limit, the live tail keeps moving, no toast', async ($, on) => {
  const MIB = 1024 * 1024
  const big = out('abcdefghi\n'.repeat(200_000))
  const { run1, writes, item, toasts, clock } = await seeded($, on, [todo({})], {
    write: text => {
      if (text.length > 4 * MIB) throw new Error('over 4 MiB')
    },
    script: async function* () {
      yield pid(7)
      yield big
      await clock.sleep(1000)
      yield big
      await clock.sleep(1000)
      yield out(`${'abcdefghi\n'.repeat(200_000)}the newest line\n`)
      await clock.sleep(10_000)
      return { code: 0, signal: null }
    },
  })

  await run1('1')
  await clock.sleeping()
  await clock.advance(3000)

  expect(toasts).toEqual([])
  expect(writes.every(w => w.text.length <= MIB + '[earlier output was dropped]\n'.length)).toBe(true)
  expect(writes.at(-1)?.text.startsWith('[earlier output was dropped]\n')).toBe(true)
  expect(writes.at(-1)?.text.endsWith('the newest line\n')).toBe(true)
  expect(item('1')?.liveTail?.at(-1)).toBe('the newest line')
})

test('a long line in the output reaches the live tail and the report clipped', async ($, on) => {
  const { run1, sent, item, clock } = await seeded($, on, [todo({})], {
    script: () => exits([pid(1), out(`${'z'.repeat(5000)}\n`)]),
  })

  await run1('1')
  await clock.settle()

  expect(item('1')?.outputTail?.length).toBeLessThanOrEqual(300)
  expect(sent[0]?.length).toBeLessThan(600)
})
