import type {
  ClassicEventOf,
  ClassicResultOf,
  Elements,
  EngineEventOf,
  EngineInterface,
  EngineResultOf,
  HttpInit,
  HttpResponse,
  On,
  OpEventOf,
  OpValueOf,
  PaneOpenArgs,
  PluginState,
  ProcessRunInit,
  ProcessRunResult,
  PromptSubmitArgs,
  PromptSubmitResult,
  RenderSurface,
  SessionVersion,
  Timer,
  ToolSpec,
  UiLogOptions,
  UiFocusResult,
  UiOpenResult,
  UiScrollArgs,
  UiScrollResult,
} from 'claude-code'
import type { ModBlock } from './blocks.ts'
import type { BoardVar } from '../blocks/board-names.ts'
import { supportedEngine } from './version.ts'

// The engine follows `$` only into top-level functions of the file that
// received it, never across an import or into a stored callback, so blocks
// get this facade instead. A member is added here when a block needs it.
export type ModApi = {
  ui: {
    log(text: string, options?: UiLogOptions): void
    /** An empty drawing for a render site: the row is skipped on screen, its stored message untouched. */
    blank(e: EngineEventOf['ui.render']): EngineResultOf['ui.render']
    /** The element constructors of the surface `e` draws on. */
    elements(e: EngineEventOf['ui.render']): Elements[RenderSurface]
    open(pane: PaneOpenArgs): Promise<UiOpenResult>
    close(id: string): Promise<void>
    /** Asks the engine to draw this plugin's render sites again, after their state changed. */
    redraw(): void
    /** Moves the focus ring of a site of this plugin's that holds the keys onto the element drawn under `key`. */
    focus(requestId: string, key: string): Promise<UiFocusResult>
    /** Moves the window of a site of this plugin's: to an element, or to its start or end. */
    scroll(args: UiScrollArgs): Promise<UiScrollResult>
  }
  session: {
    version(): Promise<SessionVersion>
    id(): Promise<string>
    cwd(): Promise<string>
    root(): Promise<string>
  }
  http: { fetch(url: string, init?: HttpInit): Promise<HttpResponse> }
  prompt: {
    /** Starts a turn of its own with `text`, framed as this plugin's message; queued while a turn runs. */
    submit(input: PromptSubmitArgs): Promise<PromptSubmitResult>
  }
  turn: {
    /** Ends the running turn `turnId`; a Bash command it started moves to the background rather than stopping. */
    abort(turnId: string): Promise<void>
  }
  tool: {
    /** Declares `mcp__mattstack-mods__<name>` for the model from its next prompt; a `tool.call` rule serves it. */
    register(spec: ToolSpec): Promise<OpValueOf['tool.register']>
  }
  process: {
    /** Runs `argv` (no shell) and resolves with its exit code and output, whatever the code. */
    run(argv: readonly string[], init?: ProcessRunInit): Promise<ProcessRunResult>
  }
  clock: {
    now(): Promise<number>
    after(ms: number, fn: () => void): Timer
    every(ms: number, fn: () => void): Timer
  }
  env: {
    daemonSock(): Promise<string | undefined>
    home(): Promise<string | undefined>
    path(): Promise<string | undefined>
    pane(): Promise<string | undefined>
    /** The board's status writer, which the board sets on the panes it launches. */
    boardStatusBin(): Promise<string | undefined>
    /** The pane's value of `name`, one of the board's own variables its status writer reads. */
    boardVar(name: BoardVar): Promise<string | undefined>
  }
  state: {
    linkId: Slot<ModState['linkId']>
    context: Slot<ModState['context']>
    sectionComposed: Slot<ModState['sectionComposed']>
  }
}

type ModState = PluginState['mattstack-mods']
export type ModContext = NonNullable<ModState['context']>
type Slot<T> = { get(): Promise<T | undefined>; set(value: T): Promise<void> }

/** How long a block's start may take before the hub gives up on it and starts the next. */
export const START_TIMEOUT_MS = 3_000

type ToolCall = EngineEventOf['tool.call']
type ToolCallResult = EngineResultOf['tool.call']
type ToolCheck = EngineEventOf['tool.check']
type ToolCheckResult = EngineResultOf['tool.check']
type Receive = EngineEventOf['session.receive']
type ReceiveResult = EngineResultOf['session.receive']
type Stop = ClassicEventOf['classic.Stop']
type StopResult = ClassicResultOf['classic.Stop']
type Render = EngineEventOf['ui.render']
type RenderResult = EngineResultOf['ui.render']
type PaneClose = OpEventOf['ui.close']
type Press = EngineEventOf['ui.press']
type PressResult = EngineResultOf['ui.press']
type Scroll = EngineEventOf['ui.scroll']
type ScrollResult = EngineResultOf['ui.scroll']
type Focus = EngineEventOf['ui.focus']
type FocusResult = EngineResultOf['ui.focus']

type Maybe<T> = T | void | Promise<T | void>
type ToolMatch = string | RegExp

/** The rest of a chain and then the engine; `signal` aborts with the engine's own call (the person's interrupt). */
export type Next<E, R> = ((e: E) => Promise<R>) & { readonly signal: AbortSignal }
export type PermitNext = Next<ToolCall, ToolCallResult>

export type ToolRule =
  | { stage: 'fill'; tool: ToolMatch; run(api: ModApi, e: ToolCall): ToolCall | Promise<ToolCall> }
  | { stage: 'guard'; tool: ToolMatch; run(api: ModApi, e: ToolCall): Maybe<{ refuse: string }> }
  | {
      stage: 'permit'
      tool: ToolMatch
      run(api: ModApi, e: ToolCall, next: PermitNext): Promise<ToolCallResult>
    }
  | { stage: 'tap'; tool: ToolMatch; run(api: ModApi, e: ToolCall, result: ToolCallResult): void | Promise<void> }
  | {
      stage: 'check'
      tool: ToolMatch
      /** `beneath` resolves to the engine's own verdict, asked at most once per check. */
      run(api: ModApi, e: ToolCheck, beneath: () => Promise<ToolCheckResult>): Maybe<ToolCheckResult>
    }

/**
 * Answers a delivery itself (consumed), passes it down edited or unchanged with
 * `next` (its result is what was queued), or answers nothing to hand the
 * delivery as it came to the next receiver.
 */
export type ReceiveHandler = (api: ModApi, e: Receive, next: (e: Receive) => Promise<ReceiveResult>) => Maybe<ReceiveResult>
export type StopHandler = (api: ModApi, e: Stop) => Maybe<{ block: string }>
export type RenderHandler = (api: ModApi, e: Render, next: (e: Render) => Promise<RenderResult>) => Promise<RenderResult>
/** Hears that one of this plugin's panes closed: by its own `close`, the person, or an unload. */
export type CloseHandler = (api: ModApi, e: PaneClose) => void | Promise<void>
/**
 * A pane's presses, window moves and focus moves, as middleware: return
 * `next(e)` to let one through, or an answer of the handler's own to take it.
 */
export type PaneHandlers = {
  press?(api: ModApi, e: Press, next: (e: Press) => Promise<PressResult>): Promise<PressResult>
  scroll?(api: ModApi, e: Scroll, next: (e: Scroll) => Promise<ScrollResult>): Promise<ScrollResult>
  focus?(api: ModApi, e: Focus, next: (e: Focus) => Promise<FocusResult>): Promise<FocusResult>
}

export type LifecycleInputs = {
  'session-start': EngineEventOf['session.start']
  'session-clear': ClassicEventOf['classic.SessionStart']
  'session-resume': ClassicEventOf['classic.SessionStart']
  'session-compact': ClassicEventOf['classic.SessionStart']
  'turn-start': EngineEventOf['turn.start']
  'turn-end': EngineEventOf['turn.complete']
  'session-end': EngineEventOf['session.end']
}
export type Lifecycle = keyof LifecycleInputs
export type LifecycleHandler<K extends Lifecycle> = (api: ModApi, e: LifecycleInputs[K]) => void | Promise<void>

export type Subscriptions = {
  onToolCall(rule: ToolRule): void
  onReceive(kind: string, handler: ReceiveHandler): void
  onStop(handler: StopHandler): void
  onLifecycle<K extends Lifecycle>(event: K, handler: LifecycleHandler<K>): void
  onRender(component: string, handler: RenderHandler): void
  onClose(pane: string, handler: CloseHandler): void
  /** Handles the presses, window moves and focus moves in pane `pane`. */
  onPane(pane: string, handlers: PaneHandlers): void
  section(id: string, text: () => string | null): void
}

export type Hub = Subscriptions & {
  /** `start` subscribes through `scope`; what it subscribes there lapses with the block. */
  block(name: ModBlock, start: (api: ModApi, scope: Subscriptions) => Promise<void>): void
  liveBlocks(): ModBlock[]
  /** Clears every live block not in `blocks`; the daemon's answer to a register is the authority. */
  keep(blocks: readonly string[]): void
  /** Makes live again every block that started and has not failed since, for a fresh register after a session end. */
  restore(): void
  /** Whether this session passed the engine and interactivity checks, so blocks were started. */
  engaged(): boolean
  /** Calls `listener` with each block a failure clears after it went live. */
  onCleared(listener: (block: ModBlock) => void): void
}

// A block's subscriptions carry its name and lapse with it; the hub's own
// methods subscribe for the core, which never lapses.
type Owned<T> = T & { owner: ModBlock | null; label: string }

type Core = {
  start(api: ModApi, e: EngineEventOf['session.start']): Promise<void>
  toolCall(api: ModApi, e: ToolCall, next: (e: ToolCall) => Promise<ToolCallResult>): Promise<ToolCallResult>
  toolCheck(api: ModApi, e: ToolCheck, next: (e: ToolCheck) => Promise<ToolCheckResult>): Promise<ToolCheckResult>
  receive(api: ModApi, e: Receive, next: (e: Receive) => Promise<ReceiveResult>): Promise<ReceiveResult>
  stop(api: ModApi, e: Stop, next: (e: Stop) => Promise<StopResult>): Promise<StopResult>
  lifecycle<K extends Lifecycle>(api: ModApi, event: K, e: LifecycleInputs[K]): Promise<void>
  render(api: ModApi, e: Render, next: (e: Render) => Promise<RenderResult>): Promise<RenderResult>
  close(api: ModApi, e: PaneClose): Promise<void>
  press(api: ModApi, e: Press, next: (e: Press) => Promise<PressResult>): Promise<PressResult>
  scroll(api: ModApi, e: Scroll, next: (e: Scroll) => Promise<ScrollResult>): Promise<ScrollResult>
  focus(api: ModApi, e: Focus, next: (e: Focus) => Promise<FocusResult>): Promise<FocusResult>
  conversation(api: ModApi, source: ClassicEventOf['classic.SessionStart']['source']): Promise<void>
  sections(api: ModApi, e: EngineEventOf['prompt.compose']): Promise<{ id: string; text: string }[]>
}

const cores = new WeakMap<Hub, Core>()

/** Runs `run`, settling with its result or, after `ms`, with a timeout; a late result is dropped. */
function bounded(api: ModApi, ms: number, run: () => Promise<void>): Promise<{ ok: true } | { ok: false; error: unknown }> {
  return new Promise(resolve => {
    let done = false
    const settle = (out: { ok: true } | { ok: false; error: unknown }) => {
      if (done) return
      done = true
      timer?.cancel()
      resolve(out)
    }
    let timer: Timer | undefined
    try {
      timer = api.clock.after(ms, () => settle({ ok: false, error: new Error(`start did not settle within ${ms} ms`) }))
    } catch {
      timer = undefined
    }
    let running: Promise<void>
    try {
      running = run()
    } catch (error) {
      settle({ ok: false, error })
      return
    }
    running.then(() => settle({ ok: true }), error => settle({ ok: false, error }))
  })
}

function matches(tool: ToolMatch, name: string): boolean {
  return typeof tool === 'string' ? tool === name : tool.test(name)
}

export function createHub(): Hub {
  const starts: { name: ModBlock; start: (api: ModApi, scope: Subscriptions) => Promise<void> }[] = []
  const live = new Set<ModBlock>()
  // Started and never cleared by a failure: what a fresh register may offer again.
  const healthy = new Set<ModBlock>()
  let started = false
  let engaged = false
  // A conversation began (startup or /clear) and no prompt has carried the
  // core's sections yet. A resume, a fork, or a plugin loaded mid-conversation
  // never sets it: those conversations may have started without the sections.
  let opening = false
  const clearedListeners: ((block: ModBlock) => void)[] = []

  const rules: Owned<{ rule: ToolRule }>[] = []
  const receivers: Owned<{ handler: ReceiveHandler }>[] = []
  const stoppers: Owned<{ handler: StopHandler }>[] = []
  const lifecycles: Owned<{ event: Lifecycle; handler: LifecycleHandler<any> }>[] = []
  const renderers: Owned<{ component: string; handler: RenderHandler }>[] = []
  const closers: Owned<{ pane: string; handler: CloseHandler }>[] = []
  const panes: Owned<{ pane: string; handlers: PaneHandlers }>[] = []
  const sectionList: Owned<{ id: string; text: () => string | null }>[] = []

  const owned = <T extends object>(owner: ModBlock | null, label: string, value: T): Owned<T> => ({ ...value, owner, label })
  const active = (sub: { owner: ModBlock | null }) => sub.owner === null || live.has(sub.owner)

  function fail(api: ModApi, sub: { owner: ModBlock | null; label: string }, where: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    const who = sub.owner ?? 'core'
    if (sub.owner !== null) healthy.delete(sub.owner)
    if (sub.owner !== null && live.delete(sub.owner)) {
      for (const listener of clearedListeners) {
        try {
          listener(sub.owner)
        } catch {
          // A listener's failure must not turn a pass-through into a failed hook.
        }
      }
    }
    try {
      api.ui.log(`mattstack-mods: ${who} ${sub.label} threw at ${where}: ${message}; ${sub.owner ? 'block cleared, ' : ''}passing through`, { to: 'debug' })
    } catch {
      // A failed log must not turn a pass-through into a failed hook.
    }
  }

  async function markComposed(api: ModApi, value: boolean): Promise<void> {
    try {
      await api.state.sectionComposed.set(value)
    } catch (err) {
      fail(api, { owner: null, label: 'section marker' }, 'state.set', err)
    }
  }

  async function attempt<T>(api: ModApi, sub: { owner: ModBlock | null; label: string }, where: string, run: () => T | Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    try {
      return { ok: true, value: await run() }
    } catch (err) {
      fail(api, sub, where, err)
      return { ok: false }
    }
  }

  function chain<E, R>(
    api: ModApi,
    where: string,
    subs: Owned<{ run: (api: ModApi, e: E, next: Next<E, R>) => Maybe<R> }>[],
    bottom: (e: E) => Promise<R>,
  ): (e: E) => Promise<R> {
    const signal = (bottom as { signal?: AbortSignal }).signal ?? new AbortController().signal
    // A subscriber that answers nothing has passed: what it handed next, if
    // it called next, else the event as it came, goes on down.
    const step = async (i: number, e: E): Promise<R> => {
      const sub = subs[i]
      if (!sub) return bottom(e)
      if (!active(sub)) return step(i + 1, e)
      let inner: Promise<R> | undefined
      let beneath: { error: unknown } | undefined
      const rest = Object.assign((next: E): Promise<R> => {
        if (!inner) {
          inner = step(i + 1, next).catch(error => {
            beneath = { error }
            throw error
          })
          // A subscriber may settle while this is still pending; the engine
          // then aborts it, and that rejection has nobody awaiting it.
          inner.catch(() => {})
        }
        return inner
      }, { signal })
      try {
        const answer = await sub.run(api, e, rest)
        if (answer) return answer
        return inner ?? step(i + 1, e)
      } catch (err) {
        // A rejection that came up through next (an interrupt, an abort, a
        // failure beneath) is not this subscriber's fault and keeps its block.
        if (beneath && beneath.error === err) throw err
        fail(api, sub, where, err)
        return inner ?? step(i + 1, e)
      }
    }
    return e => step(0, e)
  }

  /** Runs the handlers subscribed to the pane `e` names, picked by `pick`, as a chain over `next`. */
  function paneChain<E extends { requestId: string }, R>(
    api: ModApi,
    where: string,
    pick: (handlers: PaneHandlers) => ((api: ModApi, e: E, next: (e: E) => Promise<R>) => Promise<R>) | undefined,
    e: E,
    next: (e: E) => Promise<R>,
  ): Promise<R> {
    const subs = panes.flatMap(s => {
      const run = s.pane === e.requestId ? pick(s.handlers) : undefined
      return run ? [{ ...s, run }] : []
    })
    return subs.length === 0 ? next(e) : chain(api, where, subs, next)(e)
  }

  function note(api: ModApi, text: string): void {
    try {
      api.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not stop the session from starting.
    }
  }

  const core: Core = {
    async start(api, e) {
      if (started) return
      started = true
      if (!e.isInteractive) {
        note(api, 'not an interactive session; no block started')
        return
      }
      let version: SessionVersion
      try {
        version = await api.session.version()
      } catch (err) {
        fail(api, { owner: null, label: 'version check' }, 'session.start', err)
        return
      }
      const release = version.base ?? version.version
      if (!supportedEngine(release)) {
        note(api, `Claude Code ${release} is below the tested range; no block started`)
        return
      }
      engaged = true
      for (const { name, start } of starts) {
        const settled = await bounded(api, START_TIMEOUT_MS, () => start(api, subscriptions(name)))
        if (settled.ok) {
          live.add(name)
          healthy.add(name)
        } else fail(api, { owner: name, label: 'start' }, 'session.start', settled.error)
      }
      const names = starts.map(s => s.name).filter(name => live.has(name))
      note(api, `live blocks after start: ${names.length > 0 ? names.join(', ') : 'none'}`)
    },

    async toolCall(api, e, next) {
      let input = e
      for (const sub of rules) {
        const rule = sub.rule
        if (rule.stage !== 'fill' || !active(sub) || !matches(rule.tool, input.tool)) continue
        const out = await attempt(api, sub, 'tool.call fill', () => rule.run(api, input))
        if (out.ok) input = out.value
      }
      for (const sub of rules) {
        const rule = sub.rule
        if (rule.stage !== 'guard' || !active(sub) || !matches(rule.tool, input.tool)) continue
        const out = await attempt(api, sub, 'tool.call guard', () => rule.run(api, input))
        if (out.ok && out.value) return { deny: out.value.refuse }
      }
      const permits = rules.flatMap(sub => {
        const rule = sub.rule
        return rule.stage === 'permit' && matches(rule.tool, input.tool) ? [{ ...sub, run: rule.run }] : []
      })
      const result = await chain(api, 'tool.call permit', permits, next)(input)
      for (const sub of rules) {
        const rule = sub.rule
        if (rule.stage !== 'tap' || !active(sub) || !matches(rule.tool, input.tool)) continue
        await attempt(api, sub, 'tool.call tap', () => rule.run(api, input, result))
      }
      return result
    },

    async toolCheck(api, e, next) {
      let verdict: Promise<ToolCheckResult> | undefined
      let failed: { error: unknown } | undefined
      const beneath = (): Promise<ToolCheckResult> => {
        verdict ??= next(e).catch(error => {
          failed = { error }
          throw error
        })
        return verdict
      }
      for (const sub of rules) {
        const rule = sub.rule
        if (rule.stage !== 'check' || !active(sub) || !matches(rule.tool, e.tool)) continue
        try {
          const answer = await rule.run(api, e, beneath)
          if (answer) return answer
        } catch (err) {
          // The engine's own failure is not the rule's and keeps its block.
          if (failed && failed.error === err) throw err
          fail(api, sub, 'tool.check', err)
        }
      }
      return beneath()
    },

    receive(api, e, next) {
      const subs = receivers.map(s => ({ ...s, run: s.handler }))
      return chain(api, 'session.receive', subs, next)(e)
    },

    async stop(api, e, next) {
      // next runs first so the settings Stop hook, the stop gate's backstop,
      // runs whatever the blocks decide.
      const beneath = await next(e)
      if (beneath.block) return beneath
      for (const sub of stoppers) {
        if (!active(sub)) continue
        const out = await attempt(api, sub, 'classic.Stop', () => sub.handler(api, e))
        if (out.ok && out.value) return { ...beneath, block: out.value.block }
      }
      return beneath
    },

    async lifecycle(api, event, e) {
      for (const sub of lifecycles) {
        if (sub.event !== event || !active(sub)) continue
        await attempt(api, sub, event, () => sub.handler(api, e))
      }
    },

    render(api, e, next) {
      const subs = renderers.filter(s => s.component === e.component).map(s => ({ ...s, run: s.handler }))
      return subs.length === 0 ? next(e) : chain(api, 'ui.render', subs, next)(e)
    },

    async close(api, e) {
      for (const sub of closers) {
        if (sub.pane !== e.id || !active(sub)) continue
        await attempt(api, sub, 'ui.close', () => sub.handler(api, e))
      }
    },

    press: (api, e, next) => paneChain(api, 'ui.press', h => h.press, e, next),
    scroll: (api, e, next) => paneChain(api, 'ui.scroll', h => h.scroll, e, next),
    focus: (api, e, next) => paneChain(api, 'ui.focus', h => h.focus, e, next),

    async conversation(api, source) {
      if (source === 'compact') return
      opening = source === 'startup' || source === 'clear'
      await markComposed(api, false)
    },

    async sections(api, e) {
      if (!engaged) return []
      // A teammate's render of its lead's prompt (SendMessage is how it
      // reports to the lead) and a /context render (sends nothing) get no
      // core section, and so never mark a conversation.
      const coreless = e.traits.includes('teammate') || e.traits.includes('analysis')
      const out: { id: string; text: string }[] = []
      let fromCore = false
      for (const sub of sectionList) {
        if (!active(sub) || (coreless && sub.owner === null)) continue
        try {
          const text = sub.text()
          if (text === null) continue
          out.push({ id: `mattstack-mods:${sub.id}`, text })
          if (sub.owner === null) fromCore = true
        } catch (err) {
          fail(api, sub, 'prompt.compose', err)
        }
      }
      if (opening && fromCore) {
        opening = false
        await markComposed(api, true)
      }
      return out
    },
  }

  function subscriptions(owner: ModBlock | null): Subscriptions {
    return {
      onToolCall(rule) {
        rules.push(owned(owner, `${rule.stage} rule on ${String(rule.tool)}`, { rule }))
      },
      onReceive(kind, handler) {
        receivers.push(owned(owner, `receiver ${kind}`, { handler }))
      },
      onStop(handler) {
        stoppers.push(owned(owner, 'stop handler', { handler }))
      },
      onLifecycle(event, handler) {
        lifecycles.push(owned(owner, `${event} handler`, { event, handler }))
      },
      onRender(component, handler) {
        renderers.push(owned(owner, `${component} renderer`, { component, handler }))
      },
      onClose(pane, handler) {
        closers.push(owned(owner, `${pane} close handler`, { pane, handler }))
      },
      onPane(pane, handlers) {
        panes.push(owned(owner, `${pane} pane handler`, { pane, handlers }))
      },
      section(id, text) {
        sectionList.push(owned(owner, `section ${id}`, { id, text }))
      },
    }
  }

  const hub: Hub = {
    ...subscriptions(null),
    block(name, start) {
      if (starts.some(s => s.name === name)) throw new Error(`mattstack-mods: block ${name} is registered twice`)
      starts.push({ name, start })
    },
    liveBlocks() {
      return starts.map(s => s.name).filter(name => live.has(name))
    },
    keep(blocks) {
      for (const name of [...live]) if (!blocks.includes(name)) live.delete(name)
    },
    restore() {
      for (const name of healthy) live.add(name)
    },
    engaged() {
      return engaged
    },
    onCleared(listener) {
      clearedListeners.push(listener)
    },
  }
  cores.set(hub, core)
  return hub
}

function facade($: EngineInterface): ModApi {
  return {
    ui: {
      log: (text, options) => $.ui.log(text, options),
      blank: e => $.ui.resolve(e).Box({ children: [] }),
      elements: e => $.ui.resolve(e),
      open: pane => $.ui.open(pane),
      close: id => $.ui.close({ id }),
      redraw: () => $.ui.invalidate('ui.render'),
      focus: (requestId, key) => $.ui.focus({ requestId, key }),
      scroll: args => $.ui.scroll(args),
    },
    session: {
      version: () => $.session.version(),
      id: () => $.session.id(),
      cwd: () => $.session.cwd(),
      root: () => $.session.root(),
    },
    http: { fetch: (url, init) => $.http.fetch(url, init) },
    prompt: { submit: input => $.prompt.submit(input) },
    turn: { abort: turnId => $.turn.abort({ turnId }) },
    tool: { register: spec => $.tool.register(spec) },
    process: { run: (argv, init) => $.process.run(argv, init) },
    clock: {
      now: () => $.clock.now(),
      after: (ms, fn) => $.clock.after(ms, fn),
      every: (ms, fn) => $.clock.every(ms, fn),
    },
    env: {
      daemonSock: () => $.env.get('RT_DAEMON_SOCK'),
      home: () => $.env.get('HOME'),
      pane: () => $.env.get('HERDR_PANE_ID'),
      path: () => $.env.get('PATH'),
      boardStatusBin: () => $.env.get('MATTSTACK_BOARD_STATUS_BIN'),
      boardVar: name =>
        name === 'BOARD_STATE_DB' ? $.env.get('BOARD_STATE_DB')
        : name === 'BOARD_APP_ROOT' ? $.env.get('BOARD_APP_ROOT')
        : name === 'BOARD_FIXTURE' ? $.env.get('BOARD_FIXTURE')
        : $.env.get('MATTSTACK_PACK'),
    },
    state: {
      linkId: {
        get: async () => (await $.state.get({ plugin: 'mattstack-mods', key: 'linkId' })).value,
        set: async value => {
          await $.state.set({ plugin: 'mattstack-mods', key: 'linkId' }, value)
        },
      },
      context: {
        get: async () => (await $.state.get({ plugin: 'mattstack-mods', key: 'context' })).value,
        set: async value => {
          await $.state.set({ plugin: 'mattstack-mods', key: 'context' }, value)
        },
      },
      sectionComposed: {
        get: async () => (await $.state.get({ plugin: 'mattstack-mods', key: 'sectionComposed' })).value,
        set: async value => {
          await $.state.set({ plugin: 'mattstack-mods', key: 'sectionComposed' }, value)
        },
      },
    },
  }
}

export function attachHub(on: On, hub: Hub): void {
  const core = cores.get(hub)
  if (!core) throw new Error('mattstack-mods: attachHub takes a hub from createHub')

  on('session.start', async ($, e, next) => {
    const api = facade($)
    await core.start(api, e)
    await core.lifecycle(api, 'session-start', e)
    return next(e)
  })
  on('classic.SessionStart', async ($, e, next) => {
    await core.conversation(facade($), e.source)
    if (e.source === 'clear') await core.lifecycle(facade($), 'session-clear', e)
    else if (e.source === 'resume') await core.lifecycle(facade($), 'session-resume', e)
    else if (e.source === 'compact') await core.lifecycle(facade($), 'session-compact', e)
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    await core.lifecycle(facade($), 'turn-start', e)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    await core.lifecycle(facade($), 'turn-end', e)
    return next(e)
  })
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear') await core.lifecycle(facade($), 'session-end', e)
    return next(e)
  })
  on('tool.call', async ($, e, next) => core.toolCall(facade($), e, next))
  on('tool.check', async ($, e, next) => core.toolCheck(facade($), e, next))
  on('session.receive', async ($, e, next) => core.receive(facade($), e, next))
  on('classic.Stop', async ($, e, next) => core.stop(facade($), e, next))
  on('ui.render', async ($, e, next) => core.render(facade($), e, next))
  on('ui.press', async ($, e, next) => core.press(facade($), e, next))
  on('ui.scroll', async ($, e, next) => core.scroll(facade($), e, next))
  on('ui.focus', async ($, e, next) => core.focus(facade($), e, next))
  on('ui.close', async ($, e, next) => {
    await core.close(facade($), e)
    return next(e)
  })
  on('prompt.compose', async ($, e, next) => {
    const beneath = await next(e)
    const added = await core.sections(facade($), e)
    if (added.length === 0) return beneath
    return { sections: [...beneath.sections, ...added.map(s => ({ ...s, scope: 'session' as const }))] }
  })
}
