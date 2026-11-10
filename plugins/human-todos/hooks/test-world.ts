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
  on('session.id', () => ({ value: SESSION }))
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
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.compose', () => ({ sections: [] }))
  mock.clock(on, { now })
  return { store, registered }
}

export const startSession = ($: Engine) => $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
