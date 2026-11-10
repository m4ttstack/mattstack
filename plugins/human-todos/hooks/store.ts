import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { AddInput, Todo } from '../types'
import { resumeWatching } from './herdr'
import { toTodo } from './items'
import { syncSpinner } from './spinner'

export const todos = atom({ plugin: 'human-todos', key: 'todos' } as const, [] as Todo[], { shape: 'todos-1' })
export const nextId = atom({ plugin: 'human-todos', key: 'nextId' } as const, 1)
export const expanded = atom({ plugin: 'human-todos', key: 'expanded' } as const, [] as string[])
export const frame = atom({ plugin: 'human-todos', key: 'frame' } as const, 0)
export const workspace = atom({ plugin: 'human-todos', key: 'workspace' } as const, null as string | null)
export const loadedFor = atom({ plugin: 'human-todos', key: 'loadedFor' } as const, null as string | null)
export const isSaveFailed = atom({ plugin: 'human-todos', key: 'isSaveFailed' } as const, false)
export const runnerPref = atom({ plugin: 'human-todos', key: 'runnerPref' } as const, 'auto' as 'auto' | 'herdr' | 'local')

const LIST_PREFIX = 'list:'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

type SavedList = { todos: Todo[]; nextId: number; savedAt: number }

// The in-memory list stays the truth when the store refuses a write (it is capped), so the plugin keeps working and says so once.
export async function saveList($: EngineInterface): Promise<void> {
  try {
    const entry: SavedList = {
      todos: await read($, todos),
      nextId: await read($, nextId),
      savedAt: await $.clock.now(),
    }
    // Work still in flight when a session is left must not save over the list it left behind.
    const owner = await read($, loadedFor)
    if (owner === null) return
    await $.store.set(`${LIST_PREFIX}${owner}`, entry)
    await update($, isSaveFailed, () => false)
  } catch {
    if (await read($, isSaveFailed)) return
    await update($, isSaveFailed, () => true)
    $.ui.toast('Could not save the to-do list; it will not survive a restart')
  }
}

// Writers and tools call this; a render must not, because the engine refuses a state write while drawing.
// An in-session /resume changes the session id without a session.start, so the list loads on the first touch under a new id.
// Two hooks can touch the list in one await, so they share a single load instead of each restoring over the other's write.
let loading: { id: string; done: Promise<void> } | undefined
// The session /resume is leaving: until another loads, a touch under its id stays unloaded and saves nothing.
let leaving: string | undefined

async function ensureLoaded($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  if ((await read($, loadedFor)) === id || id === leaving) return
  const pending = loading
  if (pending && pending.id === id) return pending.done
  const done = loadResumed($).finally(() => {
    if (loading?.done === done) loading = undefined
  })
  loading = { id, done }
  await done
}

// The resumed session's herdr runs are still in their tabs, so watching starts again as session.start would.
async function loadResumed($: EngineInterface): Promise<void> {
  await restoreList($)
  await resumeWatching($)
  await syncSpinner($)
}

export async function addTodo($: EngineInterface, input: AddInput): Promise<Todo> {
  await ensureLoaded($)
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

export async function listTodos($: EngineInterface): Promise<Todo[]> {
  await ensureLoaded($)
  return read($, todos)
}

export async function patchTodo($: EngineInterface, id: string, change: Partial<Todo>): Promise<void> {
  await ensureLoaded($)
  await update($, todos, list => list.map(t => (t.id === id ? { ...t, ...change } : t)))
  await saveList($)
}

export async function removeTodos($: EngineInterface, pick: (t: Todo) => boolean): Promise<Todo[]> {
  await ensureLoaded($)
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

// Only a herdr run with both its token and its pane can be watched again; any other running item has nothing behind it.
function resume(t: Todo): Todo {
  if (t.status === 'confirming') return { ...t, status: 'open' }
  if (t.status === 'running' && !(t.runner === 'herdr' && t.token && t.paneId)) {
    const { liveTail: _tail, isStopping: _stopping, ...rest } = t
    return { ...rest, status: 'open', note: 'Ended without an exit code.' }
  }
  return t
}

export async function restoreList($: EngineInterface): Promise<void> {
  leaving = undefined
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (!key.startsWith(LIST_PREFIX)) continue
    const entry = (await $.store.get(key)) as SavedList | undefined
    if (!isFresh(entry, now)) await $.store.delete(key)
  }

  const id = await $.session.id()
  const mine = (await $.store.get(`${LIST_PREFIX}${id}`)) as SavedList | undefined
  if (mine) {
    await update($, todos, () => mine.todos.map(resume))
    await update($, expanded, () => [])
    await update($, nextId, () => mine.nextId)
  } else {
    await resetList($)
  }
  // Marked last, so a hook that sees the list loaded never sees it half loaded.
  await update($, loadedFor, () => id)
}

// The list stays saved under the session being left; the next touch loads whichever session is current.
export async function leaveList($: EngineInterface): Promise<void> {
  leaving = await $.session.id()
  await update($, loadedFor, () => null)
  await resetList($)
}

export async function resetList($: EngineInterface): Promise<void> {
  await update($, todos, () => [])
  await update($, expanded, () => [])
  await update($, nextId, () => 1)
}

// Drawing is pure: a render reads what is loaded and leaves any restore to the next hook that may write.
export function peekTodos($: EngineInterface): Promise<Todo[]> {
  return read($, todos)
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

export function getWorkspace($: EngineInterface): Promise<string | null> {
  return read($, workspace)
}

export async function setWorkspace($: EngineInterface, id: string): Promise<void> {
  await update($, workspace, () => id)
}

export async function toggleExpanded($: EngineInterface, id: string): Promise<void> {
  await update($, expanded, ids => (ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id]))
}
