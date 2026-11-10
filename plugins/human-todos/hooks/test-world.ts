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
  on('session.cwd', () => ({ value: '/work' }))
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

// Splits a command the way a shell would, undoing `quote` from items.ts.
export function words(command: string): string[] {
  const out: string[] = []
  let current = ''
  let isOpen = false
  let isInside = false
  for (let i = 0; i < command.length; i++) {
    const ch = command.charAt(i)
    if (isInside) {
      if (ch === "'") isInside = false
      else current += ch
    } else if (ch === "'") {
      isInside = true
      isOpen = true
    } else if (ch === '\\') {
      current += command.charAt(++i)
      isOpen = true
    } else if (/\s/.test(ch)) {
      if (isOpen) out.push(current)
      current = ''
      isOpen = false
    } else {
      current += ch
      isOpen = true
    }
  }
  if (isOpen) out.push(current)
  return out
}

type FakePane = { tab: string; lines: string[]; isIdle: boolean; isAlive: boolean; typed?: string }
type Reply = { exitCode: number; stdout: string; stderr: string }

// Stands for herdr and rt. A test hands `run` the command a plugin ran through `/bin/zsh -lc`.
export function herdrFake({ hasRt = true }: { hasRt?: boolean } = {}) {
  const calls: string[] = []
  const workspaces = new Set<string>()
  const panes = new Map<string, FakePane>()
  const labels = new Map<string, string>()
  const state = { hasRt, isCtrlCEnding: true, isCreateRefused: false, isRunRefused: false }
  let seq = 0
  const ok = (stdout = ''): Reply => ({ exitCode: 0, stdout, stderr: '' })
  const no = (): Reply => ({ exitCode: 1, stdout: '', stderr: 'failed' })
  const json = (result: unknown) => ok(JSON.stringify({ result }))
  const tokenOf = (pane: FakePane) => /__todo_exit_(\w+) %s/.exec(pane.typed ?? '')?.[1]
  const finish = (id: string, code: number) => {
    const pane = panes.get(id)
    if (!pane) throw new Error(`no pane ${id}`)
    pane.lines.push(`__todo_exit_${tokenOf(pane)} ${code}`)
    pane.isIdle = true
  }
  const newPane = (tab: string) => {
    const id = `pane${++seq}`
    panes.set(id, { tab, lines: [], isIdle: true, isAlive: true })
    return id
  }

  const run = (command: string): Reply | undefined => {
    calls.push(command)
    const w = words(command)
    const [head, a, b] = w
    if (command === 'command -v rt') return state.hasRt ? ok('/bin/rt') : no()
    if (head === 'rt') return ok()
    if (head !== 'herdr') return undefined
    const flag = (name: string) => w[w.indexOf(name) + 1] ?? ''
    switch (`${a} ${b}`) {
      case 'workspace list':
        return ok('[]')
      case 'workspace get':
        return workspaces.has(w[3] ?? '') ? json({ workspace: { workspace_id: w[3] } }) : no()
      case 'workspace create': {
        if (state.isCreateRefused) return no()
        const ws = `ws${++seq}`
        workspaces.add(ws)
        const tab = `tab${++seq}`
        const pane = newPane(tab)
        labels.set(tab, flag('--label'))
        return json({ workspace: { workspace_id: ws }, root_pane: { pane_id: pane, tab_id: tab } })
      }
      case 'tab create': {
        if (state.isCreateRefused || !workspaces.has(flag('--workspace'))) return no()
        const tab = `tab${++seq}`
        labels.set(tab, flag('--label'))
        return json({ tab: { tab_id: tab }, root_pane: { pane_id: newPane(tab) } })
      }
      case 'tab rename':
        labels.set(w[3] ?? '', w[4] ?? '')
        return ok()
      case 'tab close':
        for (const pane of panes.values()) if (pane.tab === w[3]) pane.isAlive = false
        return ok()
      case 'tab focus':
      case 'workspace focus':
        return ok()
      case 'pane get':
        return panes.get(w[3] ?? '')?.isAlive ? json({ pane: { pane_id: w[3] } }) : no()
      case 'pane run': {
        const pane = panes.get(w[3] ?? '')
        if (!pane?.isAlive || state.isRunRefused) return no()
        pane.typed = w[4]
        pane.isIdle = false
        pane.lines.push(...(w[4] ?? '').split('\n'))
        return ok()
      }
      case 'pane read': {
        const pane = panes.get(w[3] ?? '')
        return pane?.isAlive ? ok(pane.lines.join('\n')) : no()
      }
      case 'pane process-info': {
        const pane = panes.get(flag('--pane'))
        if (!pane?.isAlive) return no()
        return json({ process_info: { shell_pid: 10, foreground_process_group_id: pane.isIdle ? 10 : 20 } })
      }
      case 'pane send-keys': {
        const pane = panes.get(w[3] ?? '')
        if (!pane?.isAlive) return no()
        if (w[4] === 'ctrl+c' && state.isCtrlCEnding && tokenOf(pane)) {
          pane.lines.push('^C')
          finish(w[3] ?? '', 130)
        }
        return ok()
      }
      default:
        return undefined
    }
  }

  return {
    run,
    calls,
    labels,
    state,
    panes,
    workspaces,
    print: (id: string, ...lines: string[]) => panes.get(id)?.lines.push(...lines),
    finish,
    idle: (id: string) => {
      const pane = panes.get(id)
      if (pane) pane.isIdle = true
    },
    closeTab: (tab: string) => run(`herdr tab close '${tab}'`),
    ran: (prefix: string) => calls.filter(c => c.startsWith(prefix)),
  }
}
