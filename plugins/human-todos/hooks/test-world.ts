import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type On = Parameters<typeof mock.clock>[0]
type Options = { entries?: Record<string, unknown>; now?: number; prefix?: string }
type Registered = { name: string; description: string; inputSchema?: Record<string, unknown>; isDeferred?: unknown }

export const SESSION = 'sess-1'

// Stands for the engine beneath the plugin. The store is a plain map so a test can read what was saved.
export function world(on: On, { entries = {}, now = 1_000_000, prefix = 'mcp__human-todos__' }: Options = {}) {
  const store = new Map<string, unknown>(Object.entries(entries))
  const registered: Registered[] = []
  const opened: string[] = []
  const sent: string[] = []
  const fail = { submit: false }
  let sessionId = SESSION
  let isPlaced = true
  on('session.id', () => ({ value: sessionId }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('tool.register', (_, e) => {
    registered.push(e as Registered)
    return { value: { tool: `${prefix}${e.name}` } }
  })
  const panes = new Map<string, boolean>()
  on('ui.open', (_, e) => {
    opened.push(e.id)
    panes.set(e.id, isPlaced)
    return { value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }
  })
  on('ui.close', (_, e) => {
    panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...panes].map(([id, placed]) => ({ id, title: id, isShown: placed, isFocused: false, isPlaced: placed })),
  }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.run', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_, e) => {
    if (fail.submit) return { drop: 'refused' }
    sent.push(e.text)
    return { text: e.text }
  })
  on('prompt.compose', () => ({ sections: [] }))
  const clock = mock.clock(on, { now })
  return {
    clock,
    store,
    registered,
    opened,
    sent,
    fail,
    setPlaced: (value: boolean) => {
      isPlaced = value
      for (const id of panes.keys()) panes.set(id, value)
    },
    setSession: (id: string) => {
      sessionId = id
    },
  }
}

export const startSession = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

export type Piece = { stream: 'stdout' | 'stderr'; text: string }
export type Exit = { code: number | null; signal: string | null }
export type Child = AsyncGenerator<Piece, Exit>

export const pid = (n: number): Piece => ({ stream: 'stderr', text: `__human_todo_pid__${n}\n` })

// A child that writes each piece, then exits with `code`.
export async function* exits(pieces: Piece[], code = 0): Child {
  for (const piece of pieces) yield piece
  return { code, signal: null }
}

// A child that never writes or exits, until the test drops it.
export async function* hangs(): Child {
  await new Promise<void>(() => {})
  return { code: 0, signal: null }
}

type Spawned = { argv: readonly string[]; cwd?: string }

// Answers `process.spawn` beneath the plugin. A handler that returns nothing is a child that cannot start.
export function children(on: On, handler: (spawn: Spawned) => Child | undefined): Spawned[] {
  const spawned: Spawned[] = []
  on('process.spawn', async function* (_, e) {
    spawned.push({ argv: [...e.argv], ...(e.cwd !== undefined && { cwd: e.cwd }) })
    const child = handler({ argv: e.argv, cwd: e.cwd })
    if (!child) throw new Error('no such command')
    return { value: yield* child }
  })
  return spawned
}
