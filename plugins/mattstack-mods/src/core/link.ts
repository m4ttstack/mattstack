import type { EngineEventOf, EngineResultOf, Timer } from 'claude-code'
import type { ModBlock } from './blocks.ts'
import type { Hub, ModApi, ModContext } from './hub.ts'
import { call, type Outcome } from './rpc.ts'
import { PLUGIN_VERSION } from './version.ts'

/** The daemon clears a link's blocks 30 s after its last heartbeat. */
export const HEARTBEAT_MS = 10_000
/** One events:wait round; with the call's margin it stays under rpc's 25 s cap. */
export const ROUND_MS = 20_000
const ROUND_CALL_MS = 25_000
/** session.end runs under one short wall-clock bound for the whole chain. */
const END_CALL_MS = 2_000
const PROBE_WAIT_MS = 300_000
/** Clears that land within this window share one re-register. */
const REFRESH_DELAY_MS = 50
const COMMAND_ENVELOPE = /^<rt-mod-command id="([^"<>]+)" kind="([^"<>]+)"(?: link="([^"<>]*)")?>([\s\S]*)<\/rt-mod-command>$/

export type Command = { id: string; kind: string; data: unknown }
export type CommandHandler = (cmd: Command) => Promise<void>
export type WaitResult = { cursor: number; events: unknown[] }

export type Link = {
  /** Subscribes the link to the hub's lifecycle and receive hooks; call once, before blocks register. */
  start(): void
  /**
   * Routes daemon commands of `kind` to `handler`. The command is acked as soon
   * as it is accepted, before the handler runs: the ack means the mod owns it.
   * With `owner`, a command arriving while that block is not live is dropped
   * unacked, so the daemon takes its fallback.
   */
  onCommand(kind: string, handler: CommandHandler, owner?: ModBlock): void
  /**
   * Waits on the daemon's event bus from `after`, in rounds of ROUND_MS, until
   * `until` holds for the events gathered so far. Rejects with the signal's
   * reason once `signal` aborts.
   */
  wait(pattern: string, after: number, until: (events: unknown[]) => boolean, signal: AbortSignal): Promise<WaitResult>
  /**
   * Calls a daemon verb that names this link, adding `linkId` to `payload`.
   * An `unknown-link` answer registers again and sends the call once more on
   * the new link. Answers `no-link` without sending while there is no link.
   */
  call<T>(verb: string, payload: Record<string, unknown>): Promise<Outcome<T>>
  linkId(): string | null
}

type Registration = {
  sessionId: string
  previousSessionId?: string
  previousLinkId?: string
  cwd: string
  root: string
  pane?: string
  claudeCode: string
  plugin: string
  blocks: ModBlock[]
}

type Receive = EngineEventOf['session.receive']
type ReceiveResult = EngineResultOf['session.receive']

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('mattstack-mods: the wait was aborted')
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      err => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

const backoff = (failures: number) => Math.min(250 * 2 ** (failures - 1), 2_000)

export function createLink(hub: Hub): Link {
  let api: ModApi | null = null
  let id: string | null = null
  let sessionId: string | null = null
  /** A register the daemon has not taken yet; the next beat sends it again unchanged. */
  let pending: Registration | null = null
  /** Refused, rejected or ended: the link stays down until a resume opens another session (ended only). */
  let off = false
  /** Off because the session ended, not because rt declined: an in-process /resume registers the next session fresh. */
  let ended = false
  let beat: Timer | null = null
  let ticking = false
  let refreshing = false
  let subscribed = false
  let queue: Promise<void> = Promise.resolve()
  const handlers = new Map<string, { handler: CommandHandler; owner?: ModBlock }>()

  // Register, heartbeat, re-register and end each read and replace the link
  // id, so they run one at a time.
  const serial = (work: () => Promise<void>): Promise<void> => {
    const run = queue.then(work)
    queue = run.catch(() => {})
    return run
  }

  function log(text: string): void {
    try {
      api?.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change what the link does.
    }
  }

  async function remember(context: ModContext | null): Promise<void> {
    if (!api) return
    try {
      await api.state.linkId.set(context?.linkId ?? null)
      await api.state.context.set(context)
    } catch (err) {
      log(`could not record the link in state: ${String(err)}`)
    }
  }

  function stopBeat(): void {
    beat?.cancel()
    beat = null
  }

  async function registration(next: string, previous?: { sessionId: string; linkId: string }): Promise<Registration> {
    const a = api!
    const [cwd, root, pane, version] = await Promise.all([a.session.cwd(), a.session.root(), a.env.pane(), a.session.version()])
    return {
      sessionId: next,
      ...(previous && { previousSessionId: previous.sessionId, previousLinkId: previous.linkId }),
      cwd,
      root,
      ...(pane ? { pane } : {}),
      claudeCode: version.base ?? version.version,
      plugin: PLUGIN_VERSION,
      blocks: hub.liveBlocks(),
    }
  }

  async function register(reg: Registration): Promise<void> {
    const out = await call<{ linkId: string; blocks: string[] }>(api!, 'session:register', reg)
    if (out.ok) {
      pending = null
      id = out.data.linkId
      sessionId = reg.sessionId
      if (Array.isArray(out.data.blocks)) hub.keep(out.data.blocks)
      const blocks = hub.liveBlocks()
      await remember({ sessionId: reg.sessionId, linkId: id, cwd: reg.cwd, root: reg.root, pane: reg.pane ?? null, blocks })
      log(`linked as ${id} for ${reg.sessionId}; blocks: ${blocks.length > 0 ? blocks.join(', ') : 'none'}`)
      return
    }
    const { code, message } = out.error
    if (code === 'transport' || code === 'transient') {
      pending = reg
      log(`register not taken (${code}: ${message}); retrying on the next beat`)
      return
    }
    // refused (the switch is off), invalid, or a daemon without the verb: no retry helps.
    pending = null
    off = true
    id = null
    stopBeat()
    hub.keep([])
    await remember(null)
    log(`rt declined the link (${code}: ${message}); every block is off`)
  }

  /** Re-registers after the daemon forgot `stale` (a restart): same session id, today's blocks. */
  async function relink(stale: string): Promise<void> {
    if (off || id !== stale) return
    id = null
    await remember(null)
    log(`rt no longer knows link ${stale}; registering again`)
    await register(pending ?? (await registration(sessionId!)))
  }

  async function tick(): Promise<void> {
    if (off || !api) return
    if (pending) {
      await register(pending)
      if (off || !pending) return
    }
    if (!id) return
    const linkId = id
    const out = await call(api, 'session:heartbeat', { linkId })
    if (!out.ok && out.error.code === 'unknown-link') await relink(linkId)
  }

  function onBeat(): void {
    if (ticking) return
    ticking = true
    serial(tick)
      .catch(err => log(`heartbeat failed: ${String(err)}`))
      .finally(() => {
        ticking = false
      })
  }

  async function ack(a: ModApi, cmd: Command): Promise<void> {
    const linkId = id
    if (!linkId) {
      log(`command ${cmd.kind} ${cmd.id} handled with no link to ack it on`)
      return
    }
    const out = await call(a, 'session:ack', { linkId, id: cmd.id })
    if (!out.ok && out.error.code === 'unknown-link') await serial(() => relink(linkId))
  }

  async function handle(a: ModApi, cmd: Command): Promise<void> {
    const entry = handlers.get(cmd.kind)
    if (!entry) {
      log(`no handler for command ${cmd.kind} ${cmd.id}; not acked`)
      return
    }
    if (entry.owner && !hub.liveBlocks().includes(entry.owner)) {
      log(`command ${cmd.kind} ${cmd.id} is for ${entry.owner}, which is not live; not acked`)
      return
    }
    // The ack means the mod has taken the command, so rt never falls back
    // under a handler that is slow or straddles a /clear.
    await ack(a, cmd)
    try {
      await entry.handler(cmd)
    } catch (err) {
      log(`command ${cmd.kind} ${cmd.id} failed after its ack: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Re-registers the session with today's live blocks, so the daemon stops counting a block the mod cleared. */
  function refresh(): void {
    if (refreshing || off || !api) return
    refreshing = true
    api.clock.after(REFRESH_DELAY_MS, () => {
      serial(async () => {
        refreshing = false
        if (off || !sessionId) return
        if (!id) {
          if (pending) pending = { ...pending, blocks: hub.liveBlocks() }
          return
        }
        await register(await registration(sessionId))
      }).catch(err => log(`re-register after a cleared block failed: ${String(err)}`))
    })
  }

  // Only a delivery that is wholly one envelope is a command: a chat message
  // quoting an envelope arrives wrapped in its cross-session-message. Any
  // inbox writer can send one, so it must also carry this session's current
  // link id, which only the daemon holding the link knows.
  function receive(a: ModApi, e: Receive): ReceiveResult | undefined {
    const match = COMMAND_ENVELOPE.exec(e.text.trim())
    if (!match) return undefined
    const [, cmdId, kind, link, raw] = match as unknown as [string, string, string, string | undefined, string]
    if (id === null || link !== id) {
      log(`command ${kind} ${cmdId} is not from this link (it names ${link === undefined ? 'no link' : `link ${link || '""'}`}); passing it through`)
      return undefined
    }
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      log(`command ${kind} ${cmdId} carried unreadable data; not acked`)
      return { consumed: `mattstack-mods command ${kind} ${cmdId}` }
    }
    handle(api ?? a, { id: cmdId, kind, data }).catch(err => log(`command ${kind} ${cmdId}: ${String(err)}`))
    return { consumed: `mattstack-mods command ${kind} ${cmdId}` }
  }

  async function send(a: ModApi, event: 'resume' | 'compact'): Promise<{ ok: boolean; linkId: string } | null> {
    const linkId = id
    if (!linkId) return null
    const [cwd, root, pane] = await Promise.all([a.session.cwd(), a.session.root(), a.env.pane()])
    const out = await call(a, 'session:report', { linkId, event, context: { cwd, root, pane: pane || null } })
    return { ok: out.ok || out.error.code !== 'unknown-link', linkId }
  }

  /**
   * Registers `next` from scratch after this process's session ended without
   * a /clear (an in-process /resume to another session): no previous ids, so
   * nothing carries over. Every block that started and has not failed since
   * is live again from here and offered in the register; rt's answer keeps
   * only the blocks it counts, and a register rt declines turns them all off.
   */
  async function reopen(next: string): Promise<void> {
    if (!ended || !api) return
    ended = false
    off = false
    hub.restore()
    stopBeat()
    beat = api.clock.every(HEARTBEAT_MS, onBeat)
    log(`session ${next} resumed in this process after the last one ended; registering it`)
    await register(await registration(next))
  }

  /** Tells rt the session resumed or compacted. Only this link's own session counts, so another id's event is not sent. */
  async function report(event: 'resume' | 'compact', reported: string): Promise<void> {
    await serial(async () => {
      if (off || !api || reported !== sessionId) return
      const first = await send(api, event)
      if (!first || first.ok) return
      await relink(first.linkId)
      await send(api, event)
    })
  }

  async function wait(pattern: string, after: number, until: (events: unknown[]) => boolean, signal: AbortSignal): Promise<WaitResult> {
    const a = api
    if (!a) throw new Error('mattstack-mods: the link has not started')
    let cursor = after
    const events: unknown[] = []
    let failures = 0
    for (;;) {
      if (signal.aborted) throw abortReason(signal)
      const stale = id
      const out = await abortable(
        call<{ events?: unknown[]; cursor?: number }>(a, 'events:wait', { pattern, after: cursor, waitMs: ROUND_MS }, ROUND_CALL_MS),
        signal,
      )
      if (out.ok) {
        failures = 0
        if (Array.isArray(out.data?.events)) events.push(...out.data.events)
        if (typeof out.data?.cursor === 'number') cursor = out.data.cursor
        if (until(events)) return { cursor, events }
        continue
      }
      const { code, message } = out.error
      if (code !== 'transport' && code !== 'transient' && code !== 'unknown-link') {
        throw new Error(`mattstack-mods: events:wait on ${pattern} failed (${code}): ${message}`)
      }
      failures += 1
      log(`events:wait on ${pattern} from ${cursor} failed (${code}: ${message}); retrying from the same cursor`)
      // A lost round is most often a daemon restart, which forgot this link:
      // beat now rather than leave its blocks uncounted until the next beat.
      if (code === 'transport') onBeat()
      if (code === 'unknown-link' && stale) await serial(() => relink(stale))
      if (code !== 'unknown-link' || failures > 1) {
        const pause = new Promise<void>(resolve => {
          a.clock.after(backoff(failures), resolve)
        })
        await abortable(pause, signal)
      }
    }
  }

  // Diagnostics a person or a live check reaches with `session:push`.
  handlers.set('probe.ping', {
    handler: async cmd => {
      log(`probe.ping ${cmd.id}`)
    },
  })
  handlers.set('probe.wait', {
    handler: async cmd => {
      const input = (cmd.data ?? {}) as { pattern?: unknown; after?: unknown }
      if (typeof input.pattern !== 'string' || typeof input.after !== 'number') throw new Error('probe.wait takes { pattern, after }')
      const { pattern, after } = input
      const stop = new AbortController()
      const limit = api?.clock.after(PROBE_WAIT_MS, () => stop.abort(new Error(`probe.wait on ${pattern} saw nothing in ${PROBE_WAIT_MS} ms`)))
      wait(pattern, after, events => events.length > 0, stop.signal)
        .then(
          got => log(`probe.wait on ${pattern} from ${after} ended at cursor ${got.cursor} with ${got.events.length} event(s)`),
          err => log(err instanceof Error ? err.message : String(err)),
        )
        .finally(() => limit?.cancel())
    },
  })

  return {
    start() {
      if (subscribed) return
      subscribed = true
      hub.onReceive('rt-mod-command', (a, e) => receive(a, e))
      hub.onCleared(block => {
        log(`block ${block} cleared; telling rt`)
        refresh()
      })
      hub.onLifecycle('session-start', async a => {
        if (!hub.engaged()) return
        api = a
        beat = a.clock.every(HEARTBEAT_MS, onBeat)
        await serial(async () => register(await registration(await a.session.id())))
      })
      hub.onLifecycle('session-clear', async (_a, e) => {
        await serial(async () => {
          if (off || !api || e.session_id === sessionId) return
          const previous = id && sessionId ? { sessionId, linkId: id } : undefined
          await register(await registration(e.session_id, previous))
        })
      })
      hub.onLifecycle('session-resume', async (_a, e) => {
        if (ended) await serial(() => reopen(e.session_id))
        else await report('resume', e.session_id)
      })
      hub.onLifecycle('session-compact', async (_a, e) => report('compact', e.session_id))
      hub.onLifecycle('session-end', async () => {
        await serial(async () => {
          if (!api) return
          const was = id
          ended = !off
          off = true
          id = null
          pending = null
          stopBeat()
          hub.keep([])
          if (was) await call(api, 'session:end', { linkId: was }, END_CALL_MS)
          await remember(null)
        })
      })
    },

    onCommand(kind, handler, owner) {
      if (handlers.has(kind)) throw new Error(`mattstack-mods: command ${kind} already has a handler`)
      handlers.set(kind, owner ? { handler, owner } : { handler })
    },

    wait,

    async call<T>(verb: string, payload: Record<string, unknown>): Promise<Outcome<T>> {
      const a = api
      const linkId = id
      if (off || !a || !linkId) return { ok: false, error: { code: 'no-link', message: `no link to send ${verb} on` } }
      const first = await call<T>(a, verb, { ...payload, linkId })
      if (first.ok || first.error.code !== 'unknown-link') return first
      await serial(() => relink(linkId))
      const relinked = id
      if (!relinked || relinked === linkId) return first
      return call<T>(a, verb, { ...payload, linkId: relinked })
    },

    linkId() {
      return id
    },
  }
}
