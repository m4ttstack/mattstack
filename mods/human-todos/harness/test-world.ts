import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

type On = Parameters<typeof mock.clock>[0]
type Options = { entries?: Record<string, unknown>; now?: number; prefix?: string }
type Registered = { name: string; description: string; inputSchema?: Record<string, unknown>; isDeferred?: unknown }

export const SESSION = 'sess-1'

// The mock clock, plus the means to wait for work the engine starts detached. `advance` and `settle` only
// settle what has already reached the clock, so a child or a poller that has not yet got as far as its timer
// would miss the advance. A test waits on `sleeping` (sleeps a fake script holds on the clock) or `ticks`
// (repeating timers the plugin sets) before it moves the time.
function timed(on: On, now: number) {
  const counts = new Map<string, number>()
  const waiting: { key: string; n: number; resolve: () => void }[] = []
  const bump = (key: string) => {
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    for (const w of [...waiting]) {
      if (w.key !== key || n < w.n) continue
      waiting.splice(waiting.indexOf(w), 1)
      w.resolve()
    }
  }
  const reached = (key: string, n: number) =>
    (counts.get(key) ?? 0) >= n ? Promise.resolve() : new Promise<void>(resolve => waiting.push({ key, n, resolve }))
  const counting = ((event: string, ...rest: unknown[]) => {
    const hook = rest.pop() as (...args: unknown[]) => unknown
    const wrapped =
      event === 'clock.every'
        ? (...args: unknown[]) => {
            bump(`every ${(args[1] as { ms: number }).ms}`)
            return hook(...args)
          }
        : hook
    return (on as (...args: unknown[]) => unknown)(event, ...rest, wrapped)
  }) as On
  const clock = mock.clock(counting, { now })
  return {
    ...clock,
    sleep: (ms: number) => {
      const slept = clock.sleep(ms)
      bump('sleep')
      return slept
    },
    // Resolves once the test's clock has been asked to sleep `n` times in all.
    sleeping: (n = 1) => reached('sleep', n),
    // How many repeating timers of `ms` the plugin has set.
    ticks: (ms: number) => counts.get(`every ${ms}`) ?? 0,
  }
}

// Stands for the engine beneath the plugin. The store is a plain map so a test can read what was saved.
export function world(on: On, { entries = {}, now = 1_000_000, prefix = 'mcp__human-todos__' }: Options = {}) {
  const store = new Map<string, unknown>(Object.entries(entries))
  const registered: Registered[] = []
  const opened: string[] = []
  const sent: string[] = []
  const fail = { submit: false, save: false }
  let sessionId = SESSION
  let isPlaced = true
  on('session.id', () => ({ value: sessionId }))
  on('session.cwd', () => ({ value: '/work' }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    if (fail.save) throw new Error('store full')
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
  const clock = timed(on, now)
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

type Posting = { post: (data: { type: 'press'; id: string; button: string }) => Promise<void> }

// Presses an item's button the way the kit drawer does: its Client posts the press to the plugin.
export const press = (pane: Posting, id: string, button: string) => pane.post({ type: 'press', id, button })

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

// Stands for the processes under a run's shell. `run` reads the plugin's tree-kill command: it lists the
// descendants of the pid leaves first, as pgrep recursion would, and signals them in that order.
// A pid in `deaf` survives TERM.
export function processTree(edges: Record<number, number[]>, { deaf = [] }: { deaf?: number[] } = {}) {
  const everyone = new Set<number>(Object.entries(edges).flatMap(([parent, kids]) => [Number(parent), ...kids]))
  const signalled: { pid: number; sig: string }[] = []
  const walk = (root: number): number[] => [...(edges[root] ?? []).filter(c => everyone.has(c)).flatMap(walk), root]
  return {
    signalled,
    alive: () => [...everyone].sort((a, b) => a - b),
    run: (argv: readonly string[]) => {
      const kill = /kill -(TERM|KILL) \$\(walk (\d+)\) 2>\/dev\/null$/.exec(argv.at(-1) ?? '')
      if (!kill?.[1] || !kill[2]) return
      for (const target of walk(Number(kill[2]))) {
        signalled.push({ pid: target, sig: kill[1] })
        if (kill[1] === 'KILL' || !deaf.includes(target)) everyone.delete(target)
      }
    },
  }
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
export const BG = 'mattstack-bg'
export const OWN = 'human-todos'

// `servers` are the herdr sessions running beside the visible `default` one; mattstack's background server by default.
export function herdrFake({ hasRt = true, servers: running = { [BG]: true } }: { hasRt?: boolean; servers?: Record<string, boolean> } = {}) {
  const calls: string[] = []
  // Every herdr command as the plugin sent it: the server its env named, and whether it dropped HERDR_SOCKET_PATH.
  const sent: { command: string; session?: string; dropsSocket: boolean }[] = []
  const servers = new Map<string, boolean>(Object.entries({ default: true, ...running }))
  const workspaces = new Set<string>()
  const workspaceLabels = new Map<string, string>()
  const workspaceServer = new Map<string, string | undefined>()
  const panes = new Map<string, FakePane>()
  const labels = new Map<string, string>()
  const state = { hasRt, isCtrlCEnding: true, isCreateRefused: false, isRunRefused: false, isMissing: false, canStart: true }
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

  const run = (raw: string): Reply | undefined => {
    const env = /^env -u HERDR_SOCKET_PATH(?: HERDR_SESSION=('[^']*'|\S+))? (.*)$/s.exec(raw)
    const session = env?.[1] ? words(env[1])[0] : undefined
    const command = env ? (env[2] ?? '') : raw
    if (/^(nohup )?herdr /.test(command)) sent.push({ command, session, dropsSocket: env !== null })
    calls.push(command)
    const w = words(command)
    const [head, a, b] = w
    if (command === 'command -v rt') return state.hasRt ? ok('/bin/rt') : no()
    if (head === 'rt') return ok()
    if (head !== 'herdr' && head !== 'nohup') return undefined
    if (state.isMissing) return { exitCode: 127, stdout: '', stderr: 'zsh: command not found: herdr' }
    if (head === 'nohup') {
      if (state.canStart) servers.set(w[w.indexOf('--session') + 1] ?? '', true)
      return ok()
    }
    const flag = (name: string) => w[w.indexOf(name) + 1] ?? ''
    const here = (ws: string) => workspaces.has(ws) && workspaceServer.get(ws) === session
    switch (`${a} ${b}`) {
      case 'session list':
        return ok(JSON.stringify({ sessions: [...servers].map(([name, isUp]) => ({ default: name === 'default', name, running: isUp })) }))
      case 'workspace list':
        return json({ type: 'workspace_list', workspaces: [...workspaces].filter(here).map(id => ({ workspace_id: id, label: workspaceLabels.get(id) ?? id })) })
      case 'workspace get':
        return here(w[3] ?? '') ? json({ workspace: { workspace_id: w[3] } }) : no()
      case 'workspace create': {
        if (state.isCreateRefused) return no()
        const ws = `ws${++seq}`
        workspaces.add(ws)
        workspaceServer.set(ws, session)
        workspaceLabels.set(ws, flag('--label'))
        const tab = `tab${++seq}`
        const pane = newPane(tab)
        labels.set(tab, flag('--label'))
        return json({ workspace: { workspace_id: ws }, root_pane: { pane_id: pane, tab_id: tab } })
      }
      case 'tab create': {
        if (state.isCreateRefused || !here(flag('--workspace'))) return no()
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
    sent,
    servers,
    labels,
    state,
    panes,
    workspaces,
    // A workspace herdr already has, as another session would have left it.
    addWorkspace: (label: string, server: string = BG) => {
      const ws = `ws${++seq}`
      workspaces.add(ws)
      workspaceLabels.set(ws, label)
      workspaceServer.set(ws, server)
      return ws
    },
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
