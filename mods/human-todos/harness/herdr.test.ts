import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Todo } from '../types'
import { SESSION, herdrFake, press, startSession, words, world } from './test-world'

type On = Parameters<typeof world>[0]

const WITHDRAW = 'mcp__human-todos__withdraw'

const PANE = {
  plugin: 'human-todos',
  component: 'Pane',
  requestId: 'human-todos',
  surface: 'terminal',
  props: { title: 'Human Todos', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

const todo = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'run', title: 'T', script: 'make', status: 'open', ...over })

const wrapperFor = (token: string, script: string) =>
  `zsh -c 'trap : INT; zsh -lc "$1"; printf "\\n__todo_exit_${token} %s\\n" $?' todo '${script.replace(/'/g, `'\\''`)}'`

async function seeded($: Engine, on: On, list: Todo[], opts: { hasRt?: boolean; session?: boolean } = {}) {
  const w = world(on, { entries: { [`list:${SESSION}`]: { todos: list, nextId: 20, savedAt: 1_000_000 } } })
  const fake = herdrFake({ hasRt: opts.hasRt ?? true })
  const toasts: string[] = []
  const ran: string[][] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    ran.push([...e.argv])
    const reply = fake.run(e.argv.at(-1) ?? '')
    if (!reply) return { deny: `unexpected command ${e.argv.join(' ')}` }
    return { value: { ...reply, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await startSession($)
  await $.command.run({ command: 'todos-runner', args: 'herdr' })
  const pane = await $.ui.mount(PANE)
  const run1 = async (id: string) => {
    const polls = w.clock.ticks(1000)
    await press(pane, id, 'run')
    await press(pane, id, 'confirm')
    while (w.clock.ticks(1000) === polls && item(id)?.status === 'running') await w.clock.settle()
  }
  const items = () => (w.store.get(`list:${SESSION}`) as { todos: Todo[] }).todos
  const item = (id: string) => items().find(t => t.id === id)
  const tokenOf = (id: string) => item(id)?.token ?? ''
  return { ...w, fake, pane, toasts, ran, run1, item, tokenOf }
}

test('the first run creates a background workspace and names its tab; the second adds a tab to it', async ($, on) => {
  const { run1, fake, item } = await seeded($, on, [
    todo({ id: '1', title: 'Sign in' }),
    todo({ id: '2', title: 'x'.repeat(60) }),
  ])

  await run1('1')
  expect(fake.ran('herdr workspace create')).toEqual(["herdr workspace create --cwd '/work' --label 'Human Todos' --no-focus"])
  expect(fake.ran('herdr tab rename')).toEqual([`herdr tab rename '${item('1')?.tabId}' 'work #1 Sign in'`])
  expect(item('1')).toMatchObject({ status: 'running', runner: 'herdr', paneId: expect.any(String), tabId: expect.any(String) })

  await run1('2')
  expect(fake.ran('herdr workspace create')).toHaveLength(1)
  const ws = [...fake.workspaces][0]
  const label = `work #2 ${'x'.repeat(60)}`.slice(0, 40)
  expect(fake.ran('herdr tab create')).toEqual([`herdr tab create --workspace '${ws}' --cwd '/work' --label '${label}' --no-focus`])
  expect(label).toHaveLength(40)
  expect(item('2')?.tabId).not.toBe(item('1')?.tabId)
  expect(item('2')?.paneId).not.toBe(item('1')?.paneId)
})

test('with no stored workspace, a run reuses the "Human Todos" workspace another session left, and creates none', async ($, on) => {
  const { run1, fake, item } = await seeded($, on, [todo({ id: '1', title: 'Sign in' }), todo({ id: '2', title: 'Deploy' })])
  fake.addWorkspace('mattstack')
  const shared = fake.addWorkspace('Human Todos')

  await run1('1')
  await run1('2')

  expect(fake.ran('herdr workspace create')).toEqual([])
  expect(fake.ran('herdr tab create')).toEqual([
    `herdr tab create --workspace '${shared}' --cwd '/work' --label 'work #1 Sign in' --no-focus`,
    `herdr tab create --workspace '${shared}' --cwd '/work' --label 'work #2 Deploy' --no-focus`,
  ])
  expect(item('1')).toMatchObject({ status: 'running', runner: 'herdr' })
  // The id found is stored, so the second run asks for it by id instead of listing again.
  expect(fake.ran('herdr workspace list')).toHaveLength(1)
})

test('a stored workspace that is gone falls back to the "Human Todos" one herdr has', async ($, on) => {
  const { run1, fake } = await seeded($, on, [todo({ id: '1' }), todo({ id: '2' })])
  await run1('1')
  fake.workspaces.clear()
  const shared = fake.addWorkspace('Human Todos')

  await run1('2')

  expect(fake.ran('herdr workspace create')).toHaveLength(1)
  expect(fake.ran('herdr tab create')).toEqual([`herdr tab create --workspace '${shared}' --cwd '/work' --label 'work #2 T' --no-focus`])
})

test('a workspace is created only when herdr has none called "Human Todos"', async ($, on) => {
  const { run1, fake } = await seeded($, on, [todo({ id: '1' })])
  fake.addWorkspace('mattstack')
  fake.addWorkspace('Human Todos (old)')

  await run1('1')

  expect(fake.ran('herdr workspace create')).toEqual(["herdr workspace create --cwd '/work' --label 'Human Todos' --no-focus"])
})

test("a tab's label names the session's repo, not the run's cwd, so tabs from several sessions stay apart", async ($, on) => {
  const { run1, fake, item } = await seeded($, on, [todo({ id: '1', title: 'Deploy', cwd: '/elsewhere/other-repo' })])

  await run1('1')

  expect(fake.labels.get(item('1')?.tabId ?? '')).toBe('work #1 Deploy')
})

test('a run uses the item\'s cwd for its tab', async ($, on) => {
  const { run1, fake } = await seeded($, on, [todo({ cwd: '/elsewhere' })])

  await run1('1')

  expect(fake.ran('herdr workspace create')[0]).toContain("--cwd '/elsewhere'")
})

test('a stored workspace that herdr no longer knows is replaced', async ($, on) => {
  const { run1, fake, item } = await seeded($, on, [todo({ id: '1' }), todo({ id: '2' })])
  await run1('1')
  fake.workspaces.clear()

  await run1('2')

  expect(fake.ran('herdr workspace create')).toHaveLength(2)
  expect(fake.ran('herdr tab create')).toEqual([])
  expect(item('2')).toMatchObject({ status: 'running' })
})

test('the script is typed inside the wrapper with the item\'s token', async ($, on) => {
  const { run1, fake, item, tokenOf } = await seeded($, on, [todo({ script: 'make test' })])

  await run1('1')

  const typed = fake.panes.get(item('1')?.paneId ?? '')?.typed
  expect(tokenOf('1')).toMatch(/^[a-z0-9]{4,6}$/)
  expect(typed).toBe(wrapperFor(tokenOf('1'), 'make test'))
  expect(fake.ran('herdr pane run')).toHaveLength(1)
})

test('quotes, a dollar, a backslash and a newline in a script survive the wrapper', async ($, on) => {
  const body = `it's "q" $HOME \\ \\\\n\nsecond 'line'`
  const script = `cat <<'EOF'\n${body}\nEOF`
  const { run1, fake, item, tokenOf } = await seeded($, on, [todo({ script })])

  await run1('1')

  const typed = fake.panes.get(item('1')?.paneId ?? '')?.typed ?? ''
  expect(typed).toBe(wrapperFor(tokenOf('1'), script))
  const [shell, flag, inline, name, given] = words(typed)
  expect([shell, flag, name]).toEqual(['zsh', '-c', 'todo'])
  expect(inline).toBe(`trap : INT; zsh -lc "$1"; printf "\\n__todo_exit_${tokenOf('1')} %s\\n" $?`)
  expect(given).toBe(script)
})

test('each second the live tail is the last 3 lines after the echoed command, until the marker', async ($, on) => {
  const { run1, fake, item, clock } = await seeded($, on, [todo({})])
  await run1('1')
  const pane = item('1')?.paneId ?? ''
  fake.print(pane, 'one', '', 'two', 'three', 'four')

  await clock.advance(999)
  expect(item('1')?.liveTail).toEqual([])
  await clock.advance(1)
  expect(item('1')?.liveTail).toEqual(['two', 'three', 'four'])
  expect(fake.ran('herdr pane read')).toEqual([`herdr pane read '${pane}' --source recent-unwrapped --lines 400`])
})

test('the marker ends the run with its exit code and the output before it', async ($, on) => {
  const { run1, fake, item, clock, sent } = await seeded($, on, [todo({})])
  await run1('1')
  const pane = item('1')?.paneId ?? ''
  fake.print(pane, 'building', 'done building')
  fake.finish(pane, 0)

  await clock.advance(1000)

  expect(item('1')).toMatchObject({ status: 'done', exitCode: 0, outputTail: 'building\ndone building' })
  expect(item('1')?.liveTail).toBeUndefined()
  expect(sent).toEqual(['[Human Todos] The user ran #1 "T" from the pane: exit 0.\n```\nbuilding\ndone building\n```'])
  const reads = fake.ran('herdr pane read').length
  await clock.advance(3000)
  expect(fake.ran('herdr pane read')).toHaveLength(reads)
})

test('a non-zero exit fails the item', async ($, on) => {
  const { run1, fake, item, clock, sent } = await seeded($, on, [todo({})])
  await run1('1')
  fake.print(item('1')?.paneId ?? '', 'boom')
  fake.finish(item('1')?.paneId ?? '', 3)

  await clock.advance(1000)

  expect(item('1')).toMatchObject({ status: 'failed', exitCode: 3 })
  expect(sent[0]).toContain('exit 3')
})

test('a rerun reuses its tab and ignores the marker of the run before', async ($, on) => {
  const { run1, fake, item, clock, pane } = await seeded($, on, [todo({})])
  await run1('1')
  const tab = item('1')?.paneId ?? ''
  const first = item('1')?.token
  fake.print(tab, 'first run')
  await press(pane, '1', 'stop')
  await clock.advance(1000)
  expect(item('1')).toMatchObject({ status: 'open', note: 'Stopped' })

  await run1('1')
  fake.print(tab, 'second run')
  await clock.advance(1000)

  expect(fake.ran('herdr tab create')).toEqual([])
  expect(fake.ran('herdr workspace create')).toHaveLength(1)
  expect(item('1')?.token).not.toBe(first)
  expect(item('1')).toMatchObject({ status: 'running', paneId: tab })
  expect(item('1')?.liveTail).toEqual(['second run'])
})

test('two runs at once each have their own tab, token and exit code', async ($, on) => {
  const { run1, fake, item, tokenOf, clock, sent } = await seeded($, on, [todo({ id: '1', title: 'A' }), todo({ id: '2', title: 'B' })])
  await run1('1')
  await run1('2')
  expect(tokenOf('1')).not.toBe(tokenOf('2'))
  fake.print(item('1')?.paneId ?? '', 'from a')
  fake.print(item('2')?.paneId ?? '', 'from b')
  fake.finish(item('2')?.paneId ?? '', 4)

  await clock.advance(1000)

  expect(item('1')).toMatchObject({ status: 'running', liveTail: ['from a'] })
  expect(item('2')).toMatchObject({ status: 'failed', exitCode: 4, outputTail: 'from b' })
  fake.finish(item('1')?.paneId ?? '', 0)
  await clock.advance(1000)
  expect(item('1')).toMatchObject({ status: 'done', exitCode: 0, outputTail: 'from a' })
  expect(sent).toHaveLength(2)
  expect(sent[0]).toContain('#2 "B"')
  expect(sent[1]).toContain('#1 "A"')
})

test('no marker and an idle shell on 2 consecutive polls ends the run without an exit code', async ($, on) => {
  const { run1, fake, item, clock, sent } = await seeded($, on, [todo({})])
  await run1('1')
  const pane = item('1')?.paneId ?? ''
  fake.print(pane, 'partial')
  fake.idle(pane)

  await clock.advance(1000)
  expect(item('1')).toMatchObject({ status: 'running' })
  await clock.advance(1000)

  expect(item('1')).toMatchObject({ status: 'open', note: 'Ended without an exit code.', outputTail: 'partial' })
  expect(sent).toEqual(['[Human Todos] #1 "T" ended in its tab without reporting an exit code (most likely stopped). It is open again.'])
})

test('one idle poll followed by activity does not end the run', async ($, on) => {
  const { run1, fake, item, clock } = await seeded($, on, [todo({})])
  await run1('1')
  const pane = item('1')?.paneId ?? ''
  fake.idle(pane)
  await clock.advance(1000)

  const live = fake.panes.get(pane)
  if (live) live.isIdle = false
  await clock.advance(1000)
  if (live) live.isIdle = true
  await clock.advance(1000)

  expect(item('1')).toMatchObject({ status: 'running' })
})

test('a tab that is closed mid-run ends it after 2 failed reads, never spinning forever', async ($, on) => {
  const { run1, fake, item, clock, sent } = await seeded($, on, [todo({})])
  await run1('1')
  fake.print(item('1')?.paneId ?? '', 'working')
  await clock.advance(1000)
  fake.closeTab(item('1')?.tabId ?? '')

  await clock.advance(1000)
  expect(item('1')).toMatchObject({ status: 'running' })
  await clock.advance(1000)

  expect(item('1')).toMatchObject({ status: 'open', note: 'Ended without an exit code.', outputTail: 'working' })
  expect(sent).toHaveLength(1)
  const reads = fake.ran('herdr pane read').length
  await clock.advance(5000)
  expect(fake.ran('herdr pane read')).toHaveLength(reads)
})

test('a read that fails once and then recovers does not end the run', async ($, on) => {
  const { run1, fake, item, clock } = await seeded($, on, [todo({})])
  await run1('1')
  const pane = fake.panes.get(item('1')?.paneId ?? '')
  if (!pane) throw new Error('no pane')

  pane.isAlive = false
  await clock.advance(1000)
  pane.isAlive = true
  await clock.advance(2000)
  pane.isAlive = false
  await clock.advance(1000)

  expect(item('1')).toMatchObject({ status: 'running' })
})

test('Stop sends ctrl+c to the tab, and the marker that follows reports stopped', async ($, on) => {
  const { run1, fake, item, clock, pane, sent, toasts } = await seeded($, on, [todo({})])
  await run1('1')
  fake.print(item('1')?.paneId ?? '', 'running')

  await press(pane, '1', 'stop')

  expect(toasts).toEqual(['Stopping #1'])
  expect(fake.ran('herdr pane send-keys')).toEqual([`herdr pane send-keys '${item('1')?.paneId}' ctrl+c`])
  expect(item('1')).toMatchObject({ status: 'running', isStopping: true })
  await clock.advance(1000)

  expect(item('1')).toMatchObject({ status: 'open', note: 'Stopped', outputTail: 'running\n^C' })
  expect(sent).toEqual(['[Human Todos] The user stopped #1 "T" before it finished. It is open again.'])
})

test('a Stop that herdr refuses puts the button back and says so', async ($, on) => {
  const { run1, fake, item, clock, pane, toasts, sent } = await seeded($, on, [todo({})])
  await run1('1')
  const live = fake.panes.get(item('1')?.paneId ?? '')
  if (!live) throw new Error('no pane')
  live.isAlive = false

  await press(pane, '1', 'stop')

  expect(toasts).toEqual(['Stopping #1', 'Could not stop #1'])
  expect(item('1')).toMatchObject({ status: 'running', isStopping: false })
  live.isAlive = true
  await clock.advance(1000)
  expect(sent).toEqual([])
})

test('Show focuses the workspace and the tab, then the pane through rt when rt exists', async ($, on) => {
  const { run1, fake, item, pane } = await seeded($, on, [todo({})])
  await run1('1')
  const ws = [...fake.workspaces][0]

  await press(pane, '1', 'show')

  expect(fake.calls.slice(-4)).toEqual([
    `herdr workspace focus '${ws}'`,
    `herdr tab focus '${item('1')?.tabId}'`,
    'command -v rt',
    `rt pane focus '${item('1')?.paneId}'`,
  ])
})

test('Show without rt still focuses the tab and never calls rt', async ($, on) => {
  const { run1, fake, pane, toasts } = await seeded($, on, [todo({})], { hasRt: false })
  await run1('1')

  await press(pane, '1', 'show')

  expect(fake.ran('herdr tab focus')).toHaveLength(1)
  expect(fake.ran('rt ')).toEqual([])
  expect(toasts).toEqual([])
})

test('Show on a tab herdr cannot focus says so', async ($, on) => {
  const { run1, fake, pane, toasts } = await seeded($, on, [todo({})])
  await run1('1')
  const real = fake.run
  fake.run = c => (c.startsWith('herdr tab focus') ? { exitCode: 1, stdout: '', stderr: '' } : real(c))

  await press(pane, '1', 'show')

  expect(toasts).toEqual(['Could not bring that tab forward'])
})

test('withdrawing a running item closes its tab, stops its poller and reports nothing', async ($, on) => {
  const { run1, fake, item, clock, sent } = await seeded($, on, [todo({})])
  await run1('1')
  const tab = item('1')?.tabId
  fake.print(item('1')?.paneId ?? '', 'x')
  fake.finish(item('1')?.paneId ?? '', 0)

  await $.tool.call({ tool: WITHDRAW, id: '1' })
  await clock.advance(5000)

  expect(fake.ran('herdr tab close')).toEqual([`herdr tab close '${tab}'`])
  expect(fake.ran('herdr pane read')).toEqual([])
  expect(sent).toEqual([])
})

test('/clear closes the tab of every herdr item and its poller stays quiet', async ($, on) => {
  const { run1, fake, item, clock, sent } = await seeded($, on, [todo({ id: '1' }), todo({ id: '2' })])
  await run1('1')
  await run1('2')
  const tabs = [item('1')?.tabId, item('2')?.tabId]
  fake.finish(item('1')?.paneId ?? '', 0)

  await $.session.end({ reason: 'clear', sessionId: SESSION, resume: { id: SESSION } })
  await clock.advance(5000)

  expect(fake.ran('herdr tab close')).toEqual(tabs.map(t => `herdr tab close '${t}'`))
  expect(fake.ran('herdr pane read')).toEqual([])
  expect(sent).toEqual([])
})

test('an in-session /resume leaves every tab open and stops watching until the session is resumed', async ($, on) => {
  const { run1, fake, item, clock, sent } = await seeded($, on, [todo({ id: '1' })])
  await run1('1')
  const reads = fake.ran('herdr pane read').length

  await $.session.end({ reason: 'resume', sessionId: SESSION, resume: { id: 'sess-2' } })
  await clock.advance(5000)

  expect(fake.ran('herdr tab close')).toEqual([])
  expect(fake.ran('herdr pane read')).toHaveLength(reads)
  expect(item('1')).toMatchObject({ status: 'running', runner: 'herdr' })
  expect(sent).toEqual([])
})

test('a touch after /resume but before the session id changes loads nothing back and starts no poller', async ($, on) => {
  const { run1, fake, clock, store } = await seeded($, on, [todo({ id: '1' })])
  await run1('1')

  await $.session.end({ reason: 'resume', sessionId: SESSION, resume: { id: 'sess-2' } })
  const reads = fake.ran('herdr pane read').length
  const listed = await $.tool.call({ tool: 'mcp__human-todos__list' })
  await clock.advance(5000)

  expect(listed.result).toBe('No to-dos.')
  expect(fake.ran('herdr pane read')).toHaveLength(reads)
  expect((store.get(`list:${SESSION}`) as { todos: Todo[] }).todos[0]).toMatchObject({ id: '1', status: 'running' })
})

test('clearing a finished item closes its tab too', async ($, on) => {
  const { run1, fake, item, clock, pane } = await seeded($, on, [todo({})])
  await run1('1')
  const tab = item('1')?.tabId
  fake.finish(item('1')?.paneId ?? '', 0)
  await clock.advance(1000)

  await pane.post({ type: 'clear' })

  expect(fake.ran('herdr tab close')).toEqual([`herdr tab close '${tab}'`])
})

test('a tab that cannot be created puts the item back and tells the person', async ($, on) => {
  const { run1, fake, item, toasts, sent } = await seeded($, on, [todo({})])
  fake.state.isCreateRefused = true

  await run1('1')

  expect(item('1')).toMatchObject({ status: 'open', note: 'Could not start' })
  expect(item('1')?.runner).toBeUndefined()
  expect(toasts).toEqual(['Could not start #1'])
  expect(sent).toEqual([])
})

test('a script that cannot be typed puts the item back and no poller runs', async ($, on) => {
  const { run1, fake, item, clock, toasts } = await seeded($, on, [todo({})])
  fake.state.isRunRefused = true

  await run1('1')
  await clock.advance(3000)

  expect(item('1')).toMatchObject({ status: 'open', note: 'Could not start' })
  expect(toasts).toEqual(['Could not start #1'])
  expect(fake.ran('herdr pane read')).toEqual([])
})

test('two runs started together share one workspace', async ($, on) => {
  const { fake, pane, clock } = await seeded($, on, [todo({ id: '1' }), todo({ id: '2' })])
  await press(pane, '1', 'run')
  await press(pane, '2', 'run')
  // A Client's posts in one tick reach the plugin as its last one, so the second press comes from another drawing.
  const other = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await Promise.all([press(pane, '1', 'confirm'), press(other, '2', 'confirm')])
  await clock.settle()

  expect(fake.ran('herdr workspace create')).toHaveLength(1)
  expect(fake.ran('herdr tab create')).toHaveLength(1)
  await other.unmount()
})

test('a session that starts with a running herdr item watches it again', async ($, on) => {
  const w = world(on, {
    entries: {
      [`list:${SESSION}`]: {
        todos: [
          todo({ id: '1', status: 'running', runner: 'herdr', token: 'abc123', paneId: 'pane1', tabId: 'tab1' }),
          todo({ id: '2', status: 'running', runner: 'herdr', token: 'def456', paneId: 'pane2', tabId: 'tab2' }),
        ],
        nextId: 3,
        savedAt: 1_000_000,
      },
    },
  })
  const fake = herdrFake()
  on('process.run', (_, e) => {
    const reply = fake.run(e.argv.at(-1) ?? '')
    return reply ? { value: { ...reply, isStdoutTruncated: false, isStderrTruncated: false } } : { deny: 'no stand-in' }
  })
  fake.panes.set('pane1', { tab: 'tab1', lines: ['x', 'part', '__todo_exit_abc123 5'], isIdle: false, isAlive: true })
  fake.panes.set('pane2', { tab: 'tab2', lines: [], isIdle: false, isAlive: true, typed: wrapperFor('def456', 'make') })
  fake.print('pane2', wrapperFor('def456', 'make'), 'still going')
  await startSession($)
  const items = () => (w.store.get(`list:${SESSION}`) as { todos: Todo[] }).todos

  await w.clock.advance(1000)

  expect(items().find(t => t.id === '1')).toMatchObject({ status: 'failed', exitCode: 5 })
  expect(items().find(t => t.id === '2')).toMatchObject({ status: 'running', liveTail: ['still going'] })
  expect(w.sent).toHaveLength(1)
})

test('an in-session /resume into a session with a running herdr item watches it again', async ($, on) => {
  const w = world(on, {
    entries: {
      'list:sess-2': {
        todos: [todo({ id: '1', status: 'running', runner: 'herdr', token: 'abc123', paneId: 'pane1', tabId: 'tab1' })],
        nextId: 2,
        savedAt: 1_000_000,
      },
    },
  })
  const fake = herdrFake()
  on('process.run', (_, e) => {
    const reply = fake.run(e.argv.at(-1) ?? '')
    return reply ? { value: { ...reply, isStdoutTruncated: false, isStderrTruncated: false } } : { deny: 'no stand-in' }
  })
  fake.panes.set('pane1', { tab: 'tab1', lines: ['x', 'part', '__todo_exit_abc123 5'], isIdle: false, isAlive: true })
  await startSession($)

  await $.session.end({ reason: 'resume', sessionId: SESSION, resume: { id: 'sess-2' } })
  w.setSession('sess-2')
  await $.tool.call({ tool: 'mcp__human-todos__list' })
  await w.clock.advance(1000)

  expect((w.store.get('list:sess-2') as { todos: Todo[] }).todos[0]).toMatchObject({ status: 'failed', exitCode: 5 })
  expect(w.sent).toHaveLength(1)
})

test('a resumed herdr item can still be stopped', async ($, on) => {
  const w = world(on, {
    entries: {
      [`list:${SESSION}`]: {
        todos: [todo({ id: '1', status: 'running', runner: 'herdr', token: 'abc123', paneId: 'pane1', tabId: 'tab1' })],
        nextId: 2,
        savedAt: 1_000_000,
      },
    },
  })
  const fake = herdrFake()
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const reply = fake.run(e.argv.at(-1) ?? '')
    return reply ? { value: { ...reply, isStdoutTruncated: false, isStderrTruncated: false } } : { deny: 'no stand-in' }
  })
  fake.panes.set('pane1', { tab: 'tab1', lines: [wrapperFor('abc123', 'make')], isIdle: false, isAlive: true, typed: wrapperFor('abc123', 'make') })
  await startSession($)
  const pane = await $.ui.mount(PANE)

  await press(pane, '1', 'stop')
  await w.clock.advance(1000)

  const [item] = (w.store.get(`list:${SESSION}`) as { todos: Todo[] }).todos
  expect(item).toMatchObject({ status: 'open', note: 'Stopped' })
})
