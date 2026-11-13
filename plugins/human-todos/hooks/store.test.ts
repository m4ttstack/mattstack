import { expect, test } from 'claude-code/testing'

import type { Todo } from '../types'
import { startSession, world } from './test-world'

const ADD = 'mcp__human-todos__add'
const LIST = 'mcp__human-todos__list'
const WITHDRAW = 'mcp__human-todos__withdraw'
const DAY = 24 * 60 * 60 * 1000

const saved = (over: Partial<Todo>): Todo => ({ id: '1', kind: 'task', title: 't', status: 'open', ...over })
const savedList = (todos: Todo[], nextId: number, savedAt = 1_000_000) => ({ todos, nextId, savedAt })

test('ids never repeat, even after every item is withdrawn', async ($, on) => {
  world(on)
  await startSession($)
  for (const title of ['a', 'b', 'c']) await $.tool.call({ tool: ADD, kind: 'task', title })
  for (const id of ['1', '2', '3']) await $.tool.call({ tool: WITHDRAW, id })

  const fourth = await $.tool.call({ tool: ADD, kind: 'task', title: 'd' })
  expect(fourth.result).toMatch(/^Added #4 /)
})

test('every write is saved under the session id', async ($, on) => {
  const { store } = world(on)
  await startSession($)
  await $.tool.call({ tool: ADD, kind: 'task', title: 'a' })

  const entry = store.get('list:sess-1') as { todos: Todo[]; nextId: number; savedAt: number }
  expect(entry.todos.map(t => t.title)).toEqual(['a'])
  expect(entry.nextId).toBe(2)
  expect(entry.savedAt).toBe(1_000_000)

  await $.tool.call({ tool: WITHDRAW, id: '1' })
  expect((store.get('list:sess-1') as { todos: Todo[] }).todos).toEqual([])
})

test('session.start restores the saved list and settles unfinished items', async ($, on) => {
  const list = [
    saved({ id: '1', status: 'confirming', kind: 'run', script: 'ls' }),
    saved({ id: '2', status: 'running', kind: 'run', script: 'ls', runner: 'local', liveTail: ['x'], isStopping: true }),
    saved({ id: '3', status: 'running', kind: 'run', script: 'ls', runner: 'herdr', herdrSession: 'mattstack-bg', token: 'tok', paneId: 'p1' }),
    saved({ id: '4', status: 'done' }),
  ]
  const { store } = world(on, { entries: { 'list:sess-1': savedList(list, 5) } })
  await startSession($)

  expect((await $.tool.call({ tool: LIST })).result).toBe(
    ['#1 [open] t\n    script: ls', '#2 [open] t\n    script: ls', '#3 [running] t\n    script: ls', '#4 [done] t'].join('\n'),
  )

  const added = await $.tool.call({ tool: ADD, kind: 'task', title: 'next' })
  expect(added.result).toMatch(/^Added #5 /)

  const now = (store.get('list:sess-1') as { todos: Todo[] }).todos
  expect(now[1]).toMatchObject({ status: 'open', note: 'Ended without an exit code.' })
  expect(now[1]?.liveTail).toBeUndefined()
  expect(now[1]?.isStopping).toBeUndefined()
  expect(now[2]).toMatchObject({ status: 'running', runner: 'herdr', token: 'tok', paneId: 'p1' })
})

test('a herdr run saved with no server settles to open, since its tab is on the visible server the plugin leaves alone', async ($, on) => {
  const list = [saved({ id: '1', status: 'running', kind: 'run', script: 'ls', runner: 'herdr', token: 'tok', paneId: 'p1', tabId: 't1' })]
  world(on, { entries: { 'list:sess-1': savedList(list, 2) } })
  await startSession($)

  expect((await $.tool.call({ tool: LIST })).result).toMatch(/^#1 \[open\] t/)
})

test('a list saved by 0.1.3 loads in full: every field survives, a local run settles to open', async ($, on) => {
  const open = saved({ id: '1', kind: 'link', title: 'Open the console', detail: 'Use the work account', url: 'https://example.com/console' })
  const running = saved({ id: '2', kind: 'run', title: 'Sign in', script: 'gcloud auth login', cwd: '/work', status: 'running', runner: 'local', liveTail: ['a'], isStopping: true, logPath: '/log/2' })
  const done = saved({ id: '3', kind: 'task', title: 'Approve the invite', status: 'done', note: 'Approved' })
  const { store } = world(on, { entries: { 'list:sess-1': savedList([open, running, done], 4, 500_000) } })
  await startSession($)

  expect((await $.tool.call({ tool: LIST })).result).toBe(
    [
      '#1 [open] Open the console',
      '#2 [open] Sign in\n    script: gcloud auth login',
      '#3 [done] Approve the invite',
    ].join('\n'),
  )
  await $.tool.call({ tool: ADD, kind: 'task', title: 'next' })

  const now = (store.get('list:sess-1') as { todos: Todo[]; nextId: number }).todos
  expect(now).toHaveLength(4)
  expect(now[0]).toEqual(open)
  expect(now[2]).toEqual(done)
  const { liveTail: _tail, isStopping: _stopping, ...rest } = running
  expect(now[1]).toEqual({ ...rest, status: 'open', note: 'Ended without an exit code.' })
  expect(now[3]).toMatchObject({ id: '4', title: 'next' })
})

test('a session with no saved entry starts empty', async ($, on) => {
  world(on, { entries: { 'list:other': savedList([saved({})], 2) } })
  await startSession($)

  expect((await $.tool.call({ tool: LIST })).result).toBe('No to-dos.')
  expect((await $.tool.call({ tool: ADD, kind: 'task', title: 'a' })).result).toMatch(/^Added #1 /)
})

test('session.start deletes lists untouched for more than 30 days', async ($, on) => {
  const now = 100 * DAY
  const { store } = world(on, {
    now,
    entries: {
      'list:old': savedList([], 1, now - 31 * DAY),
      'list:fresh': savedList([], 1, now - 29 * DAY),
      unrelated: 'keep',
    },
  })
  await startSession($)

  expect([...store.keys()].sort()).toEqual(['list:fresh', 'unrelated'])
})

test('a new session id starts empty even after items existed, and the old list stays saved', async ($, on) => {
  const { store, setSession } = world(on)
  await startSession($)
  await $.tool.call({ tool: ADD, kind: 'task', title: 'a' })
  await $.tool.call({ tool: ADD, kind: 'task', title: 'b' })

  setSession('sess-2')
  await startSession($)
  expect((await $.tool.call({ tool: LIST })).result).toBe('No to-dos.')
  expect((await $.tool.call({ tool: ADD, kind: 'task', title: 'c' })).result).toMatch(/^Added #1 /)
  expect((store.get('list:sess-1') as { todos: Todo[] }).todos).toHaveLength(2)

  setSession('sess-1')
  await startSession($)
  expect((await $.tool.call({ tool: LIST })).result).toBe('#1 [open] a\n#2 [open] b')
})

test('/clear empties the list at once and leaves the old list saved', async ($, on) => {
  const { store, setSession } = world(on)
  await startSession($)
  await $.tool.call({ tool: ADD, kind: 'task', title: 'a' })

  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
  setSession('sess-2')

  expect((await $.tool.call({ tool: LIST })).result).toBe('No to-dos.')
  expect((await $.tool.call({ tool: ADD, kind: 'task', title: 'b' })).result).toMatch(/^Added #1 /)
  expect((store.get('list:sess-1') as { todos: Todo[] }).todos.map(t => t.title)).toEqual(['a'])
  expect((store.get('list:sess-2') as { todos: Todo[] }).todos.map(t => t.title)).toEqual(['b'])
})

test('a saved entry with no numeric savedAt is swept', async ($, on) => {
  const { store } = world(on, { entries: { 'list:bad': { todos: [], nextId: 1 } } })
  await startSession($)
  expect([...store.keys()]).not.toContain('list:bad')
})

test('a running item with no runner, or a herdr run missing its token or pane, settles to open', async ($, on) => {
  const run = { kind: 'run', script: 'ls', status: 'running' } as const
  const list = [
    saved({ id: '1', ...run }),
    saved({ id: '2', ...run, runner: 'herdr', paneId: 'p1', liveTail: ['x'], isStopping: true }),
    saved({ id: '3', ...run, runner: 'herdr', token: 'tok' }),
  ]
  const { store } = world(on, { entries: { 'list:sess-1': savedList(list, 4) } })
  await startSession($)

  expect((await $.tool.call({ tool: LIST })).result).toMatch(/^#1 \[open\].*\n.*\n#2 \[open\].*\n.*\n#3 \[open\]/)
  await $.tool.call({ tool: ADD, kind: 'task', title: 'next' })
  const now = (store.get('list:sess-1') as { todos: Todo[] }).todos
  for (const t of now.slice(0, 3)) expect(t).toMatchObject({ status: 'open', note: 'Ended without an exit code.' })
  expect(now[1]?.liveTail).toBeUndefined()
  expect(now[1]?.isStopping).toBeUndefined()
})

test('an in-session /resume loads the resumed session\'s saved list on first touch and never overwrites it', async ($, on) => {
  const { store, setSession } = world(on, {
    entries: { 'list:sess-2': savedList([saved({ id: '1', title: 'from two' }), saved({ id: '2', title: 'also two' })], 3) },
  })
  await startSession($)
  await $.tool.call({ tool: ADD, kind: 'task', title: 'from one' })

  await $.session.end({ reason: 'resume', sessionId: 'sess-1', resume: { id: 'sess-2' } })
  setSession('sess-2')

  const added = await $.tool.call({ tool: ADD, kind: 'task', title: 'new' })
  expect(added.result).toMatch(/^Added #3 /)
  expect((store.get('list:sess-2') as { todos: Todo[] }).todos.map(t => t.title)).toEqual(['from two', 'also two', 'new'])
  expect((store.get('list:sess-1') as { todos: Todo[] }).todos.map(t => t.title)).toEqual(['from one'])
})

test('two touches in one await after an in-session /resume share one load, and neither write is lost', async ($, on) => {
  const { store, setSession } = world(on, { entries: { 'list:sess-2': savedList([saved({ id: '1', title: 'from two' })], 2) } })
  await startSession($)

  await $.session.end({ reason: 'resume', sessionId: 'sess-1', resume: { id: 'sess-2' } })
  setSession('sess-2')
  await Promise.all([
    $.tool.call({ tool: ADD, kind: 'task', title: 'a' }),
    $.tool.call({ tool: ADD, kind: 'task', title: 'b' }),
  ])

  const kept = (store.get('list:sess-2') as { todos: Todo[] }).todos
  expect(kept.map(t => t.title).sort()).toEqual(['a', 'b', 'from two'])
  expect(kept.map(t => t.id).sort()).toEqual(['1', '2', '3'])
})

test('a /resume into a session with no saved entry starts empty and leaves the old list saved', async ($, on) => {
  const { store, setSession } = world(on)
  await startSession($)
  await $.tool.call({ tool: ADD, kind: 'task', title: 'from one' })

  await $.session.end({ reason: 'resume', sessionId: 'sess-1', resume: { id: 'sess-2' } })
  setSession('sess-2')

  expect((await $.tool.call({ tool: LIST })).result).toBe('No to-dos.')
  expect((store.get('list:sess-1') as { todos: Todo[] }).todos.map(t => t.title)).toEqual(['from one'])
})

test('a store that refuses writes keeps the list working and toasts once', async ($, on) => {
  const w = world(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await startSession($)
  w.fail.save = true

  expect((await $.tool.call({ tool: ADD, kind: 'task', title: 'a' })).result).toMatch(/^Added #1 /)
  expect((await $.tool.call({ tool: ADD, kind: 'task', title: 'b' })).result).toMatch(/^Added #2 /)
  expect((await $.tool.call({ tool: LIST })).result).toBe('#1 [open] a\n#2 [open] b')
  expect(toasts).toEqual(['Could not save the to-do list; it will not survive a restart'])
})
