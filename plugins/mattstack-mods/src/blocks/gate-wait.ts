import type { Hub, ModApi } from '../core/hub.ts'
import type { Command, Link } from '../core/link.ts'
import { call } from '../core/rpc.ts'
import { surface } from './gate-form.ts'
import { clip, oneLine } from './gate-view.ts'

/** The parts of rt's gate row (packages/rt-client GateRow) this block reads and hands on. */
export type WaitedGate = {
  id: string
  subject: string
  kind: string
  status: 'open' | 'parked' | 'answered' | 'closed'
  questions: unknown[]
  context?: string | null
  origin?: { presentation?: string; session?: string; wake?: string } | null
  answer: { answers: Record<string, unknown>; by: string; answeredAt: number; session?: string; overridden?: boolean } | null
  closedReason: string | null
  supersededBy: string | null
  consumedAt?: number | null
}

const GATE_ID = /^[A-Za-z0-9_-]{1,128}$/
/**
 * A handover is refused this long before its deadline: rt stops polling for
 * the ack at the deadline, so an ack sent closer to it may land after rt has
 * already sent the session to `rt gate wait`.
 */
const ACK_MARGIN_MS = 1_000
const MAX_RETRY_MS = 30_000
const retryMs = (failures: number) => Math.min(1_000 * 2 ** (failures - 1), MAX_RETRY_MS)
const LIST_PAGE = 200

function idOf(data: unknown): string | null {
  const id = (data as { id?: unknown } | null)?.id
  return typeof id === 'string' && GATE_ID.test(id) ? id : null
}

function deadlineOf(data: unknown): number | null {
  const deadline = (data as { deadline?: unknown } | null)?.deadline
  return typeof deadline === 'number' && Number.isFinite(deadline) ? deadline : null
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^mattstack-mods: /, '')
const terminal = (row: WaitedGate) => row.status === 'answered' || row.status === 'closed'

/**
 * What `rt gate wait` prints for an answered gate, less the gate's context
 * and questions: the session asked them itself and still holds them, and the
 * gate protocol reads only the answer.
 */
function waitResult(row: WaitedGate): string {
  const { id, subject, kind, status, answer, closedReason, supersededBy } = row
  return JSON.stringify({ ok: true, status, row: { id, subject, kind, status, answer, closedReason, supersededBy } })
}

const SUMMARY_CELLS = 400
const NOTE_CELLS = 120

/** One answer as the summary line spells it: its values, a typed text, and any note. */
function spellAnswer(raw: unknown): string {
  if (typeof raw === 'string') return oneLine(raw)
  if (Array.isArray(raw)) return raw.length > 0 ? raw.map(v => oneLine(String(v))).join(', ') : 'none'
  if (!raw || typeof raw !== 'object') return oneLine(String(raw))
  const { value, note, text } = raw as { value?: unknown; note?: unknown; text?: unknown }
  const chosen = typeof text === 'string' && text.trim() ? oneLine(text) : spellAnswer(value ?? '')
  return typeof note === 'string' && note.trim() ? `${chosen} (note: ${clip(oneLine(note), NOTE_CELLS)})` : chosen
}

export function answeredText(row: WaitedGate): string {
  const answers = Object.entries(row.answer?.answers ?? {}).map(([qid, raw]) => `${qid} = ${spellAnswer(raw)}`)
  const who = `[gate] gate ${row.id} was answered by ${surface(row.answer?.by)}`
  const summary = answers.length > 0 ? clip(`${who}: ${answers.join('; ')}`, SUMMARY_CELLS) : who
  return `${summary}. Its gate wait result: ${waitResult(row)}`
}

export function withdrawnText(row: WaitedGate): string {
  const why = row.closedReason === 'superseded' && row.supersededBy ? `superseded by ${row.supersededBy}` : (row.closedReason ?? 'closed')
  return `[gate] gate ${row.id} was withdrawn (${why}). Its gate wait status is closed.`
}

const notFoundText = (id: string) => `[gate] gate ${id} was not found in the registry. Its gate wait status is not found.`

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

/** How a wait ends: a turn to start, a gate the session itself answered (read, no turn), or one that is not this session's. */
type Ending = { kind: 'wake'; text: string; read: boolean } | { kind: 'read' } | { kind: 'not-ours' }

/**
 * The `gate-wait` block: a wait gate rt handed over (`gate-wait { id,
 * deadline }`) is waited on here instead of by a background `rt gate wait`,
 * and its answer or ending starts the session's next turn. The wait lives in
 * this process, so a /clear's new session is the one woken; a session end
 * drops it. rt stamps a gate whose handover was acked (`origin.wake: "mod"`),
 * so a reloaded block resumes those, and only those, from the registry.
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

  /** Every wait gate `session` asked, paged; throws when the registry cannot be read. */
  async function ownGates(api: ModApi, session: string): Promise<WaitedGate[]> {
    const rows: WaitedGate[] = []
    let cursor: number | undefined
    for (;;) {
      const out = await call<{ gates?: WaitedGate[]; cursor?: number }>(api, 'gate:list', {
        session,
        presentation: 'wait',
        limit: LIST_PAGE,
        ...(cursor !== undefined && { cursor }),
      })
      if (!out.ok || !Array.isArray(out.data?.gates)) throw new Error(`gate:list failed${out.ok ? '' : ` (${out.error.code}): ${out.error.message}`}`)
      rows.push(...out.data.gates)
      if (out.data.gates.length < LIST_PAGE || typeof out.data.cursor !== 'number') return rows
      cursor = out.data.cursor
    }
  }

  /** The gate's row once it is answered or closed, null while open, 'not-found' when the registry no longer has it. */
  async function readTerminal(api: ModApi, id: string): Promise<WaitedGate | null | 'not-found'> {
    const out = await call<{ status: string; row?: WaitedGate }>(api, 'gate:wait', { id, waitMs: 0 })
    if (!out.ok) {
      if (out.error.message === 'not-found') return 'not-found'
      throw new Error(`gate:wait failed (${out.error.code}): ${out.error.message}`)
    }
    const row = out.data.row
    return (out.data.status === 'answered' || out.data.status === 'closed') && row && row.id === id ? row : null
  }

  async function ending(api: ModApi, row: WaitedGate, asked: string): Promise<Ending> {
    if (row.status === 'closed') return { kind: 'wake', text: withdrawnText(row), read: true }
    const by = row.answer?.session
    if (by !== undefined && (by === asked || by === (await api.session.id()))) return { kind: 'read' }
    return { kind: 'wake', text: answeredText(row), read: true }
  }

  /** One pass: read the gate as `asked` owns it, then wait from the head of the bus until it ends. */
  async function pass(api: ModApi, id: string, asked: string, signal: AbortSignal): Promise<Ending> {
    // The cursor is taken before the row is read, so an answer landing in
    // between is still an event after it.
    const head = await call<{ cursor?: number }>(api, 'events:head', {})
    if (!head.ok || typeof head.data?.cursor !== 'number') throw new Error(`events:head failed${head.ok ? '' : ` (${head.error.code}): ${head.error.message}`}`)
    let cursor = head.data.cursor
    let row = (await ownGates(api, asked)).find(g => g.id === id)
    if (!row || row.origin?.session !== asked) {
      const read = await readTerminal(api, id)
      if (read === 'not-found') return { kind: 'wake', text: notFoundText(id), read: false }
      if (!read || read.origin?.session !== asked) return { kind: 'not-ours' }
      row = read
    }
    const ended = (events: unknown[]) =>
      events.some(ev => {
        const topic = (ev as { topic?: unknown }).topic
        return topic === `gate/answered/${id}` || topic === `gate/closed/${id}`
      })
    while (!terminal(row)) {
      cursor = (await link.wait(`gate/{answered,closed}/${id}`, cursor, ended, signal)).cursor
      const read = await readTerminal(api, id)
      if (read === 'not-found') return { kind: 'wake', text: notFoundText(id), read: false }
      if (read) row = read
    }
    return ending(api, row, asked)
  }

  /** Records the gate as read by `asked`, so a reloaded block never wakes the session with it again. */
  async function markRead(api: ModApi, id: string, asked: string): Promise<void> {
    const out = await call(api, 'gate:wait', { id, waitMs: 0, sessionId: asked })
    if (!out.ok) log(api, `gate ${id}: could not record it as read (${out.error.code}: ${out.error.message})`)
  }

  /** Starts one turn with `text`, asking again until it goes through or the session ends. */
  async function wake(api: ModApi, id: string, text: string, signal: AbortSignal): Promise<boolean> {
    for (let failures = 1; !signal.aborted; failures++) {
      let why: string
      try {
        const out = await api.prompt.submit({ text })
        if (typeof out.drop !== 'string') return true
        why = `dropped: ${out.drop}`
      } catch (err) {
        why = message(err)
      }
      log(api, `gate ${id}: the turn did not start (${why}); asking again`)
      await pause(api, retryMs(failures), signal)
    }
    return false
  }

  async function follow(api: ModApi, id: string, asked: string, signal: AbortSignal): Promise<void> {
    for (let failures = 1; !signal.aborted; failures++) {
      let end: Ending
      try {
        end = await pass(api, id, asked, signal)
      } catch (err) {
        if (signal.aborted) return
        log(api, `gate ${id}: the wait failed (${message(err)}); trying again`)
        await pause(api, retryMs(failures), signal)
        continue
      }
      if (end.kind === 'not-ours') {
        log(api, `gate ${id} is not a wait gate session ${asked} asked; not waiting on it`)
        return
      }
      if (end.kind === 'read') {
        log(api, `gate ${id} was answered by this session; no turn started`)
        await markRead(api, id, asked)
        return
      }
      if ((await wake(api, id, end.text, signal)) && end.read) {
        log(api, `gate ${id}: woke the session`)
        await markRead(api, id, asked)
      }
      return
    }
  }

  /** Waits on `id` for `asked` unless a wait on it already runs. */
  function start(api: ModApi, id: string, asked: string): Promise<void> {
    if (waits.has(id)) return Promise.resolve()
    const stop = new AbortController()
    waits.set(id, stop)
    log(api, `waiting on gate ${id}`)
    return follow(api, id, asked, stop.signal)
      .catch(err => log(api, `gate ${id}: the wait failed: ${message(err)}`))
      .finally(() => {
        if (waits.get(id) === stop) waits.delete(id)
      })
  }

  /** Resumes every wait rt stamped as this session's mod's and the session has not read yet. */
  async function resume(api: ModApi, session: string): Promise<void> {
    let rows: WaitedGate[]
    try {
      rows = await ownGates(api, session)
    } catch (err) {
      log(api, `could not list this session's wait gates to resume them: ${message(err)}`)
      return
    }
    for (const row of rows) {
      if (row.origin?.wake !== 'mod' || row.origin.session !== session || row.consumedAt != null || !GATE_ID.test(row.id)) continue
      void start(api, row.id, session)
    }
  }

  link.onCommand(
    'gate-wait',
    async (cmd: Command, api: ModApi) => start(api, idOf(cmd.data)!, await api.session.id()),
    'gate-wait',
    async (cmd: Command, api: ModApi) => {
      const deadline = deadlineOf(cmd.data)
      return idOf(cmd.data) !== null && deadline !== null && (await api.clock.now()) < deadline - ACK_MARGIN_MS
    },
  )

  link.onLinked((api, session) => {
    if (hub.liveBlocks().includes('gate-wait')) void resume(api, session)
  })

  hub.onLifecycle('session-end', async () => {
    for (const stop of waits.values()) stop.abort(new Error('mattstack-mods: the session ended'))
    waits.clear()
  })

  hub.block('gate-wait', async api => {
    const session = await api.session.id()
    void resume(api, session)
  })
}
