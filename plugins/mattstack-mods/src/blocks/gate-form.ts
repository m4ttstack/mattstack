import type { EngineEventOf, EngineResultOf } from 'claude-code'
import type { Hub, ModApi, PermitNext } from '../core/hub.ts'
import type { Command, Link } from '../core/link.ts'
import { call } from '../core/rpc.ts'

type ToolCall = EngineEventOf['tool.call']
type ToolCallResult = EngineResultOf['tool.call']
type Render = EngineEventOf['ui.render']

/** The parts of rt's gate row (packages/rt-client GateRow) this block reads. */
export type GateOption = string | { value: string; label?: string }
export type GateQuestion = { id: string; label: string; multi?: boolean; options: GateOption[] }
export type GateAnswerValue = string | string[] | { value?: string | string[]; note?: string; text?: string }
export type GateRow = {
  id: string
  status: 'open' | 'parked' | 'answered' | 'closed'
  questions: GateQuestion[]
  answer?: { answers: Record<string, GateAnswerValue>; by?: string } | null
  closedReason?: string | null
}

type Asked = { question: string }

/** How many linked gate ids the block keeps for confirming completions and hiding leftover rows. */
const REMEMBERED = 200
const GATE_ID = /^[A-Za-z0-9_-]{1,128}$/
// The doorbell phrases rt's gate-push writes (GATE_ANSWERED_PHRASE, GATE_CLOSED_PHRASE).
const DOORBELL = /^\[gate\] (\S+) (?:answered by .+; re-read the registry and proceed on the recorded answer\.|superseded by a newer gate; re-read the registry and proceed\.|closed; re-read the registry and proceed\.)$/

// `by` is free text a caller chose; only a known surface is named back to the model.
const SURFACES: Record<string, string> = {
  pane: 'pane',
  'pane-person': "this session's pane, by a person",
  console: 'console',
  board: 'board',
  shepherd: 'shepherd',
  human: 'human',
}
export const surface = (by: string | undefined) => SURFACES[(by ?? '').trim()] ?? 'another surface'

const optionValue = (o: GateOption) => (typeof o === 'string' ? o : o.value)
const optionLabel = (o: GateOption) => (typeof o === 'string' ? o : o.label || o.value)

/**
 * A linked gate's dialog: still up, closed with a result the model read, or
 * dismissed by the person (Escape), which leaves the model with nothing.
 */
type Dialog = 'up' | 'closed' | 'dismissed'

function remember(linked: Map<string, Dialog>, id: string, dialog: Dialog): void {
  linked.delete(id)
  linked.set(id, dialog)
  while (linked.size > REMEMBERED) linked.delete(linked.keys().next().value!)
}

type Fits = (text: string, q: GateQuestion) => boolean

const label = (q: GateQuestion) => (typeof q.label === 'string' ? q.label.trim() : '')
/** The asked text is the gate question's label exactly. */
const same: Fits = (text, q) => label(q).length > 0 && text.trim() === label(q)
/** Or holds it, with the question's context flattened in around it. */
const holds: Fits = (text, q) => label(q).length > 0 && text.trim().includes(label(q))

/** Whether each asked question takes a different one of the gate's questions under `fits`. */
function pairs(gate: GateRow, asked: readonly Asked[], fits: Fits): boolean {
  const taken = new Set<GateQuestion>()
  for (const a of asked) {
    const q = gate.questions.find(q => !taken.has(q) && fits(a.question, q))
    if (!q) return false
    taken.add(q)
  }
  return true
}

/**
 * Of `gates` with as many questions as were asked, each asked question its
 * own: the newest matching every label exactly, else the one whose labels the
 * questions' text holds that are longest together (the newest on a tie).
 */
export function matchGate(gates: readonly GateRow[], asked: readonly Asked[]): GateRow | null {
  if (asked.length === 0) return null
  const sized = gates.filter(g => GATE_ID.test(g.id) && Array.isArray(g.questions) && g.questions.length === asked.length).reverse()
  const exact = sized.find(g => pairs(g, asked, same))
  if (exact) return exact
  let best: GateRow | null = null
  let bestLength = -1
  for (const g of sized) {
    if (!pairs(g, asked, (text, q) => same(text, q) || holds(text, q))) continue
    const length = g.questions.reduce((n, q) => n + label(q).length, 0)
    if (length > bestLength) {
      best = g
      bestLength = length
    }
  }
  return best
}

/** One gate answer as the AskUserQuestion result spells it: option labels, comma-joined for several. */
function spell(q: GateQuestion, raw: GateAnswerValue): string {
  const named = (v: string) => {
    const option = q.options.find(o => optionValue(o) === v)
    return option ? optionLabel(option) : v
  }
  const values = (v: string | string[] | undefined) => (v === undefined ? '' : Array.isArray(v) ? v.map(named).join(', ') : named(v))
  if (typeof raw === 'string' || Array.isArray(raw)) return values(raw)
  const chosen = raw.text?.trim() ? raw.text.trim() : values(raw.value)
  return raw.note?.trim() ? `${chosen} (${raw.note.trim()})` : chosen
}

const withdrawnText = (row: GateRow) =>
  row.closedReason === 'superseded'
    ? `[gate] ${row.id} was superseded by a newer gate while this form was open; nothing was answered here. Re-read the registry and proceed.`
    : `[gate] ${row.id} was closed while this form was open; nothing was answered here. Re-read the registry and proceed.`

/**
 * The dialog's result from the gate's stored row: its recorded answers keyed
 * by the question text, or a withdrawn result for a gate that ended
 * unanswered. Null while the row is neither.
 */
export function resultFromRow(e: { questions: readonly Asked[] }, row: GateRow): ToolCallResult | null {
  const questions = e.questions
  if (row.status === 'closed') return { result: { questions, answers: {} }, context: [withdrawnText(row)] }
  if (row.status !== 'answered' || !row.answer) return null
  const answers: Record<string, string> = {}
  for (const q of row.questions) {
    const raw = row.answer.answers[q.id]
    if (raw === undefined) continue
    const key = (e.questions.find(a => same(a.question, q)) ?? e.questions.find(a => holds(a.question, q)))?.question ?? q.label
    answers[key] = spell(q, raw)
  }
  const context = `[gate] ${row.id} was answered by ${surface(row.answer.by)} while this form was open: the answers above are its recorded answers, and the gate is already answered.`
  return { result: { questions, answers }, context: [context] }
}

/**
 * Whether the dialog's result carries an answer. The engine resolves (never
 * rejects) a dialog the person dismissed with Escape: as an errored call
 * (`isError`), or as a result with no answers and no typed response. The
 * 2.1.293 types give no declined flag, so the shape is what is matched.
 */
export function answered(out: ToolCallResult): boolean {
  if (out.deny !== undefined || out.isError === true) return false
  const result = out.result as { answers?: unknown; response?: unknown } | null | undefined
  if (!result || typeof result !== 'object') return false
  const answers = result.answers
  if (answers && typeof answers === 'object' && Object.keys(answers).length > 0) return true
  return typeof result.response === 'string' && result.response.trim().length > 0
}

function idOf(data: unknown): string | null {
  const id = (data as { id?: unknown } | null)?.id
  return typeof id === 'string' && GATE_ID.test(id) ? id : null
}

/**
 * The `gate-form` block: an AskUserQuestion this session asks for one of its
 * own live form gates stays the built-in dialog, and the first answer wins.
 * A person's pick goes through as usual. An answer or a close committed
 * elsewhere closes the dialog with what the gate's row says.
 */
export function registerGateForm(hub: Hub, link: Link): void {
  const linked = new Map<string, Dialog>()

  function log(api: ModApi, text: string): void {
    try {
      api.ui.log(`mattstack-mods: ${text}`, { to: 'debug' })
    } catch {
      // A failed log must not change what the block does.
    }
  }

  async function readRow(api: ModApi, session: string, id: string): Promise<GateRow | null> {
    const out = await call<{ gates?: GateRow[] }>(api, 'gate:list', { session, presentation: 'form' })
    if (!out.ok || !Array.isArray(out.data?.gates)) return null
    return out.data.gates.find(g => g.id === id) ?? null
  }

  async function present(api: ModApi, e: ToolCall, next: PermitNext): Promise<ToolCallResult> {
    if (e.tool !== 'AskUserQuestion') return next(e)
    const asked = e.questions as readonly Asked[]
    const session = await api.session.id()
    // The cursor is taken before the gate is read, so an answer landing in
    // between is still an event after it.
    const head = await call<{ cursor?: number }>(api, 'events:head', {})
    if (!head.ok || typeof head.data?.cursor !== 'number') return next(e)
    const listed = await call<{ gates?: GateRow[] }>(api, 'gate:list', { open: true, session, presentation: 'form' })
    if (!listed.ok || !Array.isArray(listed.data?.gates)) return next(e)
    const gate = matchGate(listed.data.gates, asked)
    if (!gate) return next(e)
    remember(linked, gate.id, 'up')
    log(api, `AskUserQuestion linked to gate ${gate.id}`)

    const stop = new AbortController()
    const interrupted = () => stop.abort(next.signal.reason)
    if (next.signal.aborted) interrupted()
    else next.signal.addEventListener('abort', interrupted, { once: true })
    const shown = next(e)
    const ended = link.wait(
      `gate/{answered,closed}/${gate.id}`,
      head.data.cursor,
      events => events.some(ev => typeof (ev as { topic?: unknown }).topic === 'string' && (ev as { topic: string }).topic.endsWith(`/${gate.id}`)),
      stop.signal,
    )
    try {
      const { result, read } = await settle(api, e, gate.id, session, shown, ended, stop.signal)
      remember(linked, gate.id, read ? 'closed' : 'dismissed')
      return result
    } catch (err) {
      remember(linked, gate.id, 'dismissed')
      throw err
    } finally {
      next.signal.removeEventListener('abort', interrupted)
      stop.abort()
    }
  }

  /**
   * The first of the dialog's own answer and the gate's ending; the gate's is
   * read back from its row. `read` says whether the model got an answer or an
   * ending to act on, rather than a dialog the person declined.
   */
  async function settle(
    api: ModApi,
    e: ToolCall,
    id: string,
    session: string,
    shown: Promise<ToolCallResult>,
    ended: Promise<unknown>,
    stopped: AbortSignal,
  ): Promise<{ result: ToolCallResult; read: boolean }> {
    const fromDialog = (result: ToolCallResult) => ({ result, read: answered(result) })
    const first = await Promise.race([
      shown.then(result => ({ kind: 'dialog' as const, result })),
      ended.then(
        () => ({ kind: 'gate' as const }),
        err => ({ kind: 'lost' as const, err }),
      ),
    ])
    if (first.kind === 'dialog') return fromDialog(first.result)
    if (first.kind === 'lost') {
      if (!stopped.aborted) log(api, `gate ${id}: the wait ended (${first.err instanceof Error ? first.err.message : String(first.err)}); the dialog stays`)
      return fromDialog(await shown)
    }
    const row = await readRow(api, session, id)
    const out = row ? resultFromRow(e as { questions: readonly Asked[] }, row) : null
    if (!out) {
      log(api, `gate ${id}: its row could not be read back; the dialog stays`)
      return fromDialog(await shown)
    }
    log(api, `gate ${id} ${row!.status} elsewhere; closing its dialog with the row's ${row!.status === 'answered' ? 'answer' : 'ending'}`)
    return { result: out, read: true }
  }

  function leftover(e: Render): boolean {
    if (e.component !== 'UserMessage') return false
    const { text, origin, isExpanded } = e.props
    if (isExpanded || origin.kind !== 'peer') return false
    const m = DOORBELL.exec(text.trim())
    const dialog = m ? linked.get(m[1]!) : undefined
    return dialog !== undefined && dialog !== 'dismissed'
  }

  // The ack only confirms the mod owns the gate: the event path is what
  // closes the dialog, so a gate whose dialog already closed is still acked.
  // A dialog the person dismissed left the model nothing to read, so that
  // gate is not acked and rt rings its doorbell, as it would without the mod.
  link.onCommand(
    'gate-complete',
    async () => {},
    'gate-form',
    (cmd: Command) => {
      const id = idOf(cmd.data)
      const dialog = id === null ? undefined : linked.get(id)
      return dialog !== undefined && dialog !== 'dismissed'
    },
  )

  hub.block('gate-form', async (_api, scope) => {
    scope.onToolCall({ stage: 'permit', tool: 'AskUserQuestion', run: present })
    scope.onRender('UserMessage', async (api, e, next) => (leftover(e) ? api.ui.blank(e) : next(e)))
  })
}
