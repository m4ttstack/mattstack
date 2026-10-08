import type { Hub, ModApi } from '../core/hub.ts'
import type { Command, Link } from '../core/link.ts'
import { call, type Outcome } from '../core/rpc.ts'
import { surface } from './gate-form.ts'

/** The parts of rt's gate row (packages/rt-client GateRow) this block reads and hands on. */
export type WaitedGate = {
  id: string
  subject: string
  kind: string
  status: 'open' | 'parked' | 'answered' | 'closed'
  questions: unknown[]
  context?: string | null
  answer: { answers: Record<string, unknown>; by: string; answeredAt: number; session?: string; overridden?: boolean } | null
  closedReason: string | null
  supersededBy: string | null
}

const GATE_ID = /^[A-Za-z0-9_-]{1,128}$/
/** A read the daemon could not answer is tried this many times before the wait is handed back. */
const READ_TRIES = 4
/** A turn the engine would not start is asked for this many times before the answer goes to the transcript. */
const SUBMIT_TRIES = 3
const retryMs = (failures: number) => 1_000 * 2 ** (failures - 1)

type Read = { status: 'answered' | 'closed'; row: WaitedGate } | { status: 'open' } | { status: 'not-found' }

class Lost extends Error {}

function idOf(data: unknown): string | null {
  const id = (data as { id?: unknown } | null)?.id
  return typeof id === 'string' && GATE_ID.test(id) ? id : null
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^mattstack-mods: /, '')

/** What `rt gate wait` prints for an answered gate, less the gate's context, which the session already holds. */
function waitResult(row: WaitedGate): string {
  const { id, subject, kind, status, questions, answer, closedReason, supersededBy } = row
  return JSON.stringify({ ok: true, status, row: { id, subject, kind, status, questions, answer, closedReason, supersededBy } })
}

export function answeredText(row: WaitedGate): string {
  return `[gate] gate ${row.id} was answered by ${surface(row.answer?.by)}. Its gate wait result: ${waitResult(row)}`
}

export function withdrawnText(row: WaitedGate): string {
  const why = row.closedReason === 'superseded' && row.supersededBy ? `superseded by ${row.supersededBy}` : (row.closedReason ?? 'closed')
  return `[gate] gate ${row.id} was withdrawn (${why}). Its gate wait status is closed.`
}

const notFoundText = (id: string) => `[gate] gate ${id} was not found in the registry. Its gate wait status is not found.`

const lostText = (id: string, why: string) =>
  `[gate] The wait on gate ${id} was lost (${why}). Run \`rt gate wait ${id}\` as a background task and end the turn.`

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(api: ModApi, ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const timer = api.clock.after(ms, done)
    signal.addEventListener('abort', done, { once: true })
    function done() {
      timer.cancel()
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

/** A daemon call that a restart or a busy daemon may drop, tried again from scratch; throws Lost once it keeps failing. */
async function retried<T>(api: ModApi, signal: AbortSignal, what: string, attempt: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  for (let failures = 1; ; failures++) {
    const out = await attempt()
    if (out.ok || (out.error.code !== 'transport' && out.error.code !== 'transient')) return out
    if (failures >= READ_TRIES) throw new Lost(`${what} failed (${out.error.code}): ${out.error.message}`)
    await pause(api, retryMs(failures), signal)
    if (signal.aborted) throw signal.reason
  }
}

/**
 * The `gate-wait` block: a wait gate rt handed over (`gate-wait { id }`) is
 * waited on here instead of by a background `rt gate wait`, and its answer or
 * ending starts the session's next turn. The wait lives in this process, so a
 * /clear's new session is the one woken; a session end drops it.
 */
export function registerGateWait(hub: Hub, link: Link): void {
  const waits = new Map<string, AbortController>()

  function log(api: ModApi, text: string): void {
    try {
      api.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change what the block does.
    }
  }

  async function read(api: ModApi, id: string, signal: AbortSignal): Promise<Read> {
    const out = await retried(api, signal, 'gate:wait', () => call<{ status: string; row?: WaitedGate }>(api, 'gate:wait', { id, waitMs: 0 }))
    if (!out.ok) {
      if (out.error.message === 'not-found') return { status: 'not-found' }
      throw new Lost(`gate:wait failed (${out.error.code}): ${out.error.message}`)
    }
    const { status, row } = out.data
    if ((status === 'answered' || status === 'closed') && row && row.id === id) return { status, row }
    return { status: 'open' }
  }

  /** Starts one turn with `text`; a refused or dropped submit is asked again, so the answer is not lost. */
  async function wake(api: ModApi, id: string, text: string, signal: AbortSignal): Promise<void> {
    let why = ''
    for (let tries = 1; tries <= SUBMIT_TRIES; tries++) {
      try {
        const out = await api.prompt.submit({ text })
        if (typeof out.drop !== 'string') {
          log(api, `gate ${id}: woke the session`)
          return
        }
        why = `dropped: ${out.drop}`
      } catch (err) {
        why = message(err)
      }
      if (signal.aborted) return
      if (tries < SUBMIT_TRIES) await pause(api, retryMs(tries), signal)
      if (signal.aborted) return
    }
    try {
      api.ui.log(`mattstack-mods: could not wake this session for gate ${id} (${why}). ${text}`)
    } catch {
      // Nothing is left to tell.
    }
  }

  async function follow(api: ModApi, id: string, signal: AbortSignal): Promise<void> {
    const asked = await api.session.id()
    const pattern = `gate/{answered,closed}/${id}`
    let text: string | null
    try {
      // The cursor is taken before the row is read, so an answer landing in
      // between is still an event after it.
      const head = await retried(api, signal, 'events:head', () => call<{ cursor?: number }>(api, 'events:head', {}))
      if (!head.ok || typeof head.data?.cursor !== 'number') throw new Lost(`events:head failed${head.ok ? '' : ` (${head.error.code}): ${head.error.message}`}`)
      let cursor = head.data.cursor
      let state = await read(api, id, signal)
      while (state.status === 'open') {
        const ended = (events: unknown[]) =>
          events.some(ev => {
            const topic = (ev as { topic?: unknown }).topic
            return topic === `gate/answered/${id}` || topic === `gate/closed/${id}`
          })
        cursor = (await link.wait(pattern, cursor, ended, signal)).cursor
        state = await read(api, id, signal)
      }
      if (state.status === 'not-found') text = notFoundText(id)
      else if (state.status === 'closed') text = withdrawnText(state.row)
      else {
        const by = state.row.answer?.session
        // The session recorded this answer itself, so it already holds it.
        if (by !== undefined && (by === asked || by === (await api.session.id()))) {
          log(api, `gate ${id} was answered by this session; no turn started`)
          return
        }
        text = answeredText(state.row)
      }
    } catch (err) {
      if (signal.aborted) return
      text = lostText(id, message(err))
    }
    await wake(api, id, text, signal)
  }

  link.onCommand(
    'gate-wait',
    async (cmd: Command, api: ModApi) => {
      const id = idOf(cmd.data)!
      if (waits.has(id)) return
      const stop = new AbortController()
      waits.set(id, stop)
      log(api, `waiting on gate ${id}`)
      try {
        await follow(api, id, stop.signal)
      } catch (err) {
        log(api, `gate ${id}: the wait failed: ${message(err)}`)
      } finally {
        if (waits.get(id) === stop) waits.delete(id)
      }
    },
    'gate-wait',
    (cmd: Command) => idOf(cmd.data) !== null,
  )

  hub.onLifecycle('session-end', async () => {
    for (const stop of waits.values()) stop.abort(new Error('mattstack-mods: the session ended'))
    waits.clear()
  })

  hub.block('gate-wait', async () => {})
}
