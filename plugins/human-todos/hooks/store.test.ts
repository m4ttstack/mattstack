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
    saved({ id: '3', status: 'running', kind: 'run', script: 'ls', runner: 'herdr', token: 'tok' }),
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
  expect(now[2]).toMatchObject({ status: 'running', runner: 'herdr', token: 'tok' })
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
