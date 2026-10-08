import type {
  ClassicEventOf,
  ClassicResultOf,
  EngineEventOf,
  EngineInterface,
  EngineResultOf,
  HttpInit,
  HttpResponse,
  On,
  SessionVersion,
  UiLogOptions,
} from 'claude-code'
import type { ModBlock } from './blocks.ts'
import { supportedEngine } from './version.ts'

// The engine follows `$` only into top-level functions of the file that
// received it, never across an import or into a stored callback, so blocks
// get this facade instead. A member is added here when a block needs it.
export type ModApi = {
  ui: { log(text: string, options?: UiLogOptions): void }
  session: { version(): Promise<SessionVersion> }
  http: { fetch(url: string, init?: HttpInit): Promise<HttpResponse> }
}

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

type Maybe<T> = T | void | Promise<T | void>
type ToolMatch = string | RegExp

export type ToolRule =
  | { stage: 'fill'; tool: ToolMatch; run(api: ModApi, e: ToolCall): ToolCall | Promise<ToolCall> }
  | { stage: 'guard'; tool: ToolMatch; run(api: ModApi, e: ToolCall): Maybe<{ refuse: string }> }
  | {
      stage: 'permit'
      tool: ToolMatch
      run(api: ModApi, e: ToolCall, next: (e: ToolCall) => Promise<ToolCallResult>): Promise<ToolCallResult>
    }
  | { stage: 'tap'; tool: ToolMatch; run(api: ModApi, e: ToolCall, result: ToolCallResult): void | Promise<void> }
  | { stage: 'check'; tool: ToolMatch; run(api: ModApi, e: ToolCheck): Maybe<ToolCheckResult> }

export type ReceiveHandler = (api: ModApi, e: Receive) => Maybe<ReceiveResult>
export type StopHandler = (api: ModApi, e: Stop) => Maybe<{ block: string }>
export type RenderHandler = (api: ModApi, e: Render, next: (e: Render) => Promise<RenderResult>) => Promise<RenderResult>

export type LifecycleInputs = {
  'session-start': EngineEventOf['session.start']
  'session-clear': ClassicEventOf['classic.SessionStart']
  'turn-start': EngineEventOf['turn.start']
  'turn-end': EngineEventOf['turn.complete']
  'session-end': EngineEventOf['session.end']
}
export type Lifecycle = keyof LifecycleInputs
export type LifecycleHandler<K extends Lifecycle> = (api: ModApi, e: LifecycleInputs[K]) => void | Promise<void>

export type Hub = {
  block(name: ModBlock, start: (api: ModApi) => Promise<void>): void
  onToolCall(rule: ToolRule): void
  onReceive(kind: string, handler: ReceiveHandler): void
  onStop(handler: StopHandler): void
  onLifecycle<K extends Lifecycle>(event: K, handler: LifecycleHandler<K>): void
  onRender(component: string, handler: RenderHandler): void
  section(id: string, text: () => string | null): void
  liveBlocks(): ModBlock[]
}

// A subscription made while a block starts belongs to that block and lapses
// with it; one made outside any start belongs to the core and never lapses.
type Owned<T> = T & { owner: ModBlock | null; label: string }

type Core = {
  start(api: ModApi, e: EngineEventOf['session.start']): Promise<void>
  toolCall(api: ModApi, e: ToolCall, next: (e: ToolCall) => Promise<ToolCallResult>): Promise<ToolCallResult>
  toolCheck(api: ModApi, e: ToolCheck, next: (e: ToolCheck) => Promise<ToolCheckResult>): Promise<ToolCheckResult>
  receive(api: ModApi, e: Receive, next: (e: Receive) => Promise<ReceiveResult>): Promise<ReceiveResult>
  stop(api: ModApi, e: Stop, next: (e: Stop) => Promise<StopResult>): Promise<StopResult>
  lifecycle<K extends Lifecycle>(api: ModApi, event: K, e: LifecycleInputs[K]): Promise<void>
  render(api: ModApi, e: Render, next: (e: Render) => Promise<RenderResult>): Promise<RenderResult>
  sections(api: ModApi): { id: string; text: string }[]
}

const cores = new WeakMap<Hub, Core>()

function matches(tool: ToolMatch, name: string): boolean {
  return typeof tool === 'string' ? tool === name : tool.test(name)
}

export function createHub(): Hub {
  const starts: { name: ModBlock; start: (api: ModApi) => Promise<void> }[] = []
  const live = new Set<ModBlock>()
  let starting: ModBlock | null = null
  let started = false

  const rules: Owned<{ rule: ToolRule }>[] = []
  const receivers: Owned<{ handler: ReceiveHandler }>[] = []
  const stoppers: Owned<{ handler: StopHandler }>[] = []
  const lifecycles: Owned<{ event: Lifecycle; handler: LifecycleHandler<any> }>[] = []
  const renderers: Owned<{ component: string; handler: RenderHandler }>[] = []
  const sectionList: Owned<{ id: string; text: () => string | null }>[] = []

  const owned = <T extends object>(label: string, value: T): Owned<T> => ({ ...value, owner: starting, label })
  const active = (sub: { owner: ModBlock | null }) => sub.owner === null || live.has(sub.owner)

  function fail(api: ModApi, sub: { owner: ModBlock | null; label: string }, where: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err)
    const who = sub.owner ?? 'core'
    if (sub.owner !== null) live.delete(sub.owner)
    try {
      api.ui.log(`mattstack-mods: ${who} ${sub.label} threw at ${where}: ${message}; ${sub.owner ? 'block cleared, ' : ''}passing through`, { to: 'debug' })
    } catch {
      // A failed log must not turn a pass-through into a failed hook.
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
    subs: Owned<{ run: (api: ModApi, e: E, next: (e: E) => Promise<R>) => Promise<R> }>[],
    bottom: (e: E) => Promise<R>,
  ): (e: E) => Promise<R> {
    const step = async (i: number, e: E): Promise<R> => {
      const sub = subs[i]
      if (!sub) return bottom(e)
      if (!active(sub)) return step(i + 1, e)
      let inner: Promise<R> | undefined
      let beneath: { error: unknown } | undefined
      const rest = (next: E): Promise<R> => {
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
      }
      try {
        return await sub.run(api, e, rest)
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

  const core: Core = {
    async start(api, e) {
      if (started) return
      started = true
      if (!e.isInteractive) {
        api.ui.log('mattstack-mods: not an interactive session; no block started', { to: 'debug' })
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
        api.ui.log(`mattstack-mods: Claude Code ${release} is below the tested range; no block started`, { to: 'debug' })
        return
      }
      for (const { name, start } of starts) {
        starting = name
        try {
          await start(api)
          live.add(name)
        } catch (err) {
          fail(api, { owner: name, label: 'start' }, 'session.start', err)
        } finally {
          starting = null
        }
      }
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
      for (const sub of rules) {
        const rule = sub.rule
        if (rule.stage !== 'check' || !active(sub) || !matches(rule.tool, e.tool)) continue
        const out = await attempt(api, sub, 'tool.check', () => rule.run(api, e))
        if (out.ok && out.value) return out.value
      }
      return next(e)
    },

    async receive(api, e, next) {
      for (const sub of receivers) {
        if (!active(sub)) continue
        const out = await attempt(api, sub, 'session.receive', () => sub.handler(api, e))
        if (out.ok && out.value) return out.value
      }
      return next(e)
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

    sections(api) {
      const out: { id: string; text: string }[] = []
      for (const sub of sectionList) {
        if (!active(sub)) continue
        try {
          const text = sub.text()
          if (text !== null) out.push({ id: `mattstack-mods:${sub.id}`, text })
        } catch (err) {
          fail(api, sub, 'prompt.compose', err)
        }
      }
      return out
    },
  }

  const hub: Hub = {
    block(name, start) {
      if (starts.some(s => s.name === name)) throw new Error(`mattstack-mods: block ${name} is registered twice`)
      starts.push({ name, start })
    },
    onToolCall(rule) {
      rules.push(owned(`${rule.stage} rule on ${String(rule.tool)}`, { rule }))
    },
    onReceive(kind, handler) {
      receivers.push(owned(`receiver ${kind}`, { handler }))
    },
    onStop(handler) {
      stoppers.push(owned('stop handler', { handler }))
    },
    onLifecycle(event, handler) {
      lifecycles.push(owned(`${event} handler`, { event, handler }))
    },
    onRender(component, handler) {
      renderers.push(owned(`${component} renderer`, { component, handler }))
    },
    section(id, text) {
      sectionList.push(owned(`section ${id}`, { id, text }))
    },
    liveBlocks() {
      return starts.map(s => s.name).filter(name => live.has(name))
    },
  }
  cores.set(hub, core)
  return hub
}

function facade($: EngineInterface): ModApi {
  return {
    ui: { log: (text, options) => $.ui.log(text, options) },
    session: { version: () => $.session.version() },
    http: { fetch: (url, init) => $.http.fetch(url, init) },
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
    if (e.source === 'clear') await core.lifecycle(facade($), 'session-clear', e)
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
  on('prompt.compose', async ($, e, next) => {
    const beneath = await next(e)
    const added = core.sections(facade($))
    if (added.length === 0) return beneath
    return { sections: [...beneath.sections, ...added.map(s => ({ ...s, scope: 'session' as const }))] }
  })
}
