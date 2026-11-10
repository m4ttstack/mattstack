import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { AddInput, Todo } from '../types'
import { toTodo } from './items'

export const todos = atom({ plugin: 'human-todos', key: 'todos' } as const, [] as Todo[], { shape: 'todos-1' })
export const nextId = atom({ plugin: 'human-todos', key: 'nextId' } as const, 1)
export const expanded = atom({ plugin: 'human-todos', key: 'expanded' } as const, [] as string[])
export const frame = atom({ plugin: 'human-todos', key: 'frame' } as const, 0)
export const workspace = atom({ plugin: 'human-todos', key: 'workspace' } as const, null as string | null)
export const runnerPref = atom({ plugin: 'human-todos', key: 'runnerPref' } as const, 'auto' as 'auto' | 'herdr' | 'local')

const LIST_PREFIX = 'list:'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

type SavedList = { todos: Todo[]; nextId: number; savedAt: number }

export async function saveList($: EngineInterface): Promise<void> {
  const entry: SavedList = {
    todos: await read($, todos),
    nextId: await read($, nextId),
    savedAt: await $.clock.now(),
  }
  await $.store.set(`${LIST_PREFIX}${await $.session.id()}`, entry)
}

export async function addTodo($: EngineInterface, input: AddInput): Promise<Todo> {
  let id = 0
  await update($, nextId, n => {
    id = n
    return n + 1
  })
  const todo = toTodo(String(id), input)
  await update($, todos, list => [...list, todo])
  await saveList($)
  return todo
}

export function listTodos($: EngineInterface): Promise<Todo[]> {
  return read($, todos)
}

export async function patchTodo($: EngineInterface, id: string, change: Partial<Todo>): Promise<void> {
  await update($, todos, list => list.map(t => (t.id === id ? { ...t, ...change } : t)))
  await saveList($)
}

export async function removeTodos($: EngineInterface, pick: (t: Todo) => boolean): Promise<Todo[]> {
  const removed: Todo[] = []
  await update($, todos, list => {
    removed.length = 0
    for (const t of list) if (pick(t)) removed.push(t)
    return list.filter(t => !pick(t))
  })
  await saveList($)
  return removed
}

function isFresh(entry: SavedList | undefined, now: number): boolean {
  return typeof entry?.savedAt === 'number' && now - entry.savedAt <= MAX_AGE_MS
}

function resume(t: Todo): Todo {
  if (t.status === 'confirming') return { ...t, status: 'open' }
  if (t.status === 'running' && t.runner === 'local') {
    const { liveTail: _tail, isStopping: _stopping, ...rest } = t
    return { ...rest, status: 'open', note: 'Ended without an exit code.' }
  }
  return t
}

export async function restoreList($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (!key.startsWith(LIST_PREFIX)) continue
    const entry = (await $.store.get(key)) as SavedList | undefined
    if (!isFresh(entry, now)) await $.store.delete(key)
  }

  const mine = (await $.store.get(`${LIST_PREFIX}${await $.session.id()}`)) as SavedList | undefined
  if (!mine) return resetList($)
  await update($, todos, () => mine.todos.map(resume))
  await update($, nextId, () => mine.nextId)
}

export async function resetList($: EngineInterface): Promise<void> {
  await update($, todos, () => [])
  await update($, expanded, () => [])
  await update($, nextId, () => 1)
}

export async function readPane($: EngineInterface): Promise<{ list: Todo[]; openIds: string[]; spin: number }> {
  return { list: await read($, todos), openIds: await read($, expanded), spin: await read($, frame) }
}

export async function bumpFrame($: EngineInterface): Promise<void> {
  await update($, frame, n => n + 1)
}

export function getRunnerPref($: EngineInterface): Promise<'auto' | 'herdr' | 'local'> {
  return read($, runnerPref)
}

export async function setRunnerPref($: EngineInterface, pref: 'auto' | 'herdr' | 'local'): Promise<void> {
  await update($, runnerPref, () => pref)
}

export async function toggleExpanded($: EngineInterface, id: string): Promise<void> {
  await update($, expanded, ids => (ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]))
}
