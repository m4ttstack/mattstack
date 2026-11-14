import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderSurface, ToolCallInput, ToolCallResult } from 'claude-code'
import { addWheel, bandAbovePrompt, isEngaged, isPlaced, paneMessage, paneRows, registerPaneRedraw, showPane, wheelTotal, type HideablePane, type Waiting } from '@mattstack/mod-kit'

import type { BoardGate, Form, LegacyForm } from '../types'
import { bellArgs } from './gate/bell'
import { NO_ADDRESS, addBoardGate, boardAddress, boardText, boardUrl, kindTitle, readBoardOnly } from './gate/board'
import { addForm, currentForm, fitForm, fromLegacy, knownForms, openCount, patchForm } from './gate/forms'
import { agentFields, answerOutcome, boardFields, formFromRow, gateForm, listedGates, readKitResult, spilledGate, toForm } from './gate/parse'
import { BOARD_INSTRUCTION, BOARD_TOAST, GATE_ANSWERED, GATE_ASIDE, GATE_INSTRUCTION, agentReply, type Outcome } from './gate/reply'
import { RT_OVERRAN, RT_TIMEOUT_MS, rtError, runRt, settingIsOn } from './gate/rt'
import { INPUT_SCHEMA, TOOL_DESCRIPTION } from './gate/schema'
import { endNote, isSelf, rowEnd, waitFor, type GateEnd } from './gate/watch'

const PANE = 'gate-form'
const TOOL = 'ask'
const GATE_TITLE = 'Decision gate'
// Under the engine's 100,000-character cap on a Client's props, with room for the props beside the form.
const FORM_BUDGET = 95_000

const formsAtom = atom({ plugin: 'gate-form', key: 'forms' } as const, [] as Form[], { shape: 'forms-1' })
// The one form the form-3 code kept, read once into the list.
const legacyAtom = atom({ plugin: 'gate-form', key: 'form' } as const, null as LegacyForm | null, { shape: 'form-3' })
// The engine reports the pane's focus but not its Client's, so a click or key in the form sets this and typing in the prompt clears it.
const keysAtom = atom({ plugin: 'gate-form', key: 'keysInForm' } as const, false)
// Board-only gates raised in this pane, oldest first, while they wait on the board.
const boardAtom = atom({ plugin: 'gate-form', key: 'board' } as const, [] as BoardGate[], { shape: 'board-1' })
// tool.call carries no surface, so the band, which draws every frame, records the one this session draws on.
// A render hook may not write state, so this lives in the module; a reload forgets it until the next frame.
const drawn: { surface?: RenderSurface } = {}
// rt.gates.kitForm, read once per module on session.start: an rt or mattstack plugin too old for the flag must
// never be sent it, since the gate tools refuse an input they don't know. Unread or unreadable counts as off.
const setting: { isOn: boolean; reading?: Promise<void> } = { isOn: false }
const ELSEWHERE = 'Already answered elsewhere'
const ASK_OFF = 'The gate form is off. Turn on rt.gates.kitForm and run /reload-plugins to use it.'
const SETTING_TIMEOUT_MS = 5_000
const QUICK_TIMEOUT_MS = 5_000
// One `rt gate wait` per gate; the children die with the module, so a session start watches again.
const watching = new Set<string>()
// Forms whose answer rt is recording: the pane's own answer settles them, never a watcher.
const answering = new Set<string>()
// The board's local address as deck last gave it; null when deck has none.
const deck: { address?: string | null } = {}

type FormMessage = { type: 'answer'; formId: string; answers?: Record<string, unknown> } | { type: 'chat'; formId: string; draft?: Record<string, unknown> }
type Next = (e: ToolCallInput) => Promise<ToolCallResult>

const GATE_PANE: HideablePane = { id: PANE, label: 'mattstack gate waiting' }

async function readForms($: EngineInterface): Promise<Form[]> {
  const forms = knownForms(await read($, formsAtom))
  return forms.length > 0 ? forms : fromLegacy(await read($, legacyAtom))
}

async function writeForms($: EngineInterface, change: (list: Form[]) => Form[]): Promise<Form[]> {
  const legacy = fromLegacy(await read($, legacyAtom))
  let written: Form[] = []
  await update($, formsAtom, stored => {
    const list = knownForms(stored)
    return (written = change(list.length > 0 || legacy.length === 0 ? list : legacy))
  })
  if (legacy.length > 0) await update($, legacyAtom, () => null)
  return written
}

// A form closed before it was answered waits above the prompt, with a way back to it.
async function waitingForm($: EngineInterface): Promise<Waiting | undefined> {
  const forms = await readForms($)
  const form = currentForm(forms)
  if (!form || form.status !== 'open') return undefined
  const more = openCount(forms) - 1
  return { formId: form.id, title: more > 0 ? `${form.title}, ${more} more waiting` : form.title }
}

async function setKeysInForm($: EngineInterface, value: boolean): Promise<void> {
  if ((await read($, keysAtom)) !== value) await update($, keysAtom, () => value)
}

async function wake($: EngineInterface, text: string, what: string): Promise<void> {
  const warn = () => $.ui.toast(`Could not tell Claude about ${what}`)
  void $.prompt
    .submit({ text })
    .then(sent => {
      if (sent.drop !== undefined) warn()
    })
    .catch(warn)
}

// After an answer the pane moves on to the next open form; with none left it closes, and `note`, the ending
// the closed form would have shown, becomes a toast.
async function showCurrent($: EngineInterface, forms: Form[], note?: string): Promise<void> {
  const next = currentForm(forms)
  if (next?.status === 'open') {
    await showPane($, GATE_PANE, next.title)
    return
  }
  if (note) $.ui.toast(note)
  await $.ui.close({ id: PANE })
  $.ui.invalidate('ui.render')
}

async function readSetting($: EngineInterface): Promise<void> {
  try {
    setting.isOn = settingIsOn(await runRt($, ['settings', 'get', 'rt.gates.kitForm', '--json'], SETTING_TIMEOUT_MS))
  } catch {
    setting.isOn = false
  }
}

const failureText = (failure: unknown) =>
  failure instanceof Error && failure.message === RT_OVERRAN
    ? `rt took longer than ${RT_TIMEOUT_MS / 1000}s, so the answer may already be recorded. Submit again to check.`
    : `Not recorded: rt could not run (${failure instanceof Error ? failure.message : String(failure)}).`

// The pane's own answer: no doorbell rings for it, so the mod wakes the agent once rt has recorded it.
// Lost to another surface, the form closes and that surface's doorbell wakes the agent.
// The form counts as answering until its outcome is written, so its watcher, returning on the same write, never settles it too.
async function answerGate($: EngineInterface, form: Form, answers: Record<string, unknown>): Promise<void> {
  const gateId = form.gateId ?? ''
  answering.add(form.id)
  // Any throw counts as a failed attempt, so the form never stays on "Recording your answer…".
  let failed = true
  try {
    failed = !(await recordAnswer($, form, gateId, answers))
  } catch (failure) {
    await markFailed($, form, `Not recorded: ${failure instanceof Error ? failure.message : String(failure)}`).catch(() => undefined)
  } finally {
    answering.delete(form.id)
    // A watcher that returned meanwhile left the form to this answer; a fresh wait on an ended gate returns at once and settles it.
    if (failed) watchGate($, gateId)
  }
}

// The error goes on the form only while it is still open: one already marked answered keeps its ending.
// A new attempt count is what makes the Client hand the form back with the picks kept.
async function markFailed($: EngineInterface, form: Form, error: string): Promise<void> {
  await writeForms($, list => list.map(f => (f.id === form.id && f.status === 'open' ? { ...f, error, attempt: (form.attempt ?? 0) + 1 } : f)))
}

// Whether rt recorded the answer (or another surface's won); false leaves the form open with the error.
async function recordAnswer($: EngineInterface, form: Form, gateId: string, answers: Record<string, unknown>): Promise<boolean> {
  const session = await $.session.id()
  const args = ['gate', 'answer', gateId, '--answers', JSON.stringify(answers), '--by', 'pane', '--session', session]
  let error: string | undefined
  let outcome: 'recorded' | 'elsewhere' = 'recorded'
  try {
    const ran = await runRt($, args)
    if (ran.exitCode !== 0) error = `Not recorded: ${rtError(ran)}`
    else outcome = answerOutcome(ran.stdout, session)
  } catch (failure) {
    error = failureText(failure)
  }
  if (error !== undefined) {
    await markFailed($, form, error)
    return false
  }
  const patch: Partial<Form> = outcome === 'elsewhere' ? { status: 'answered', error: undefined, note: ELSEWHERE } : { status: 'answered', error: undefined }
  const forms = await writeForms($, list => patchForm(list, form.id, patch))
  if (outcome === 'recorded') await wake($, GATE_ANSWERED(gateId), `the answer to gate ${gateId}`)
  await showCurrent($, forms, outcome === 'elsewhere' ? ELSEWHERE : undefined)
  return true
}

// A gate set aside stays open: the person comes back to it from the band.
async function setGateAside($: EngineInterface, form: Form): Promise<void> {
  await wake($, GATE_ASIDE(form.gateId ?? ''), `setting gate ${form.gateId} aside`)
  await $.ui.close({ id: PANE })
}

// Answers reach the agent as its next input: a tool call can't wait for a person past its 10s budget.
async function settle($: EngineInterface, formId: string, outcome: Outcome): Promise<void> {
  const form = (await readForms($)).find(f => f.id === formId)
  if (!form || form.status !== 'open') return
  if (form.source === 'gate') {
    if (outcome.status === 'answered') return answerGate($, form, outcome.answers)
    return setGateAside($, form)
  }
  const status: Form['status'] = outcome.status === 'answered' ? 'answered' : 'cancelled'
  const forms = await writeForms($, list => patchForm(list, formId, { status }))
  await wake($, agentReply(form, outcome), `the answers for ${formId}`)
  await showCurrent($, forms)
}

async function openForm($: EngineInterface, form: Form, supersededId?: string | null): Promise<void> {
  await writeForms($, list => addForm(list, form, supersededId))
  const shown = currentForm(await readForms($))
  const title = shown?.title ?? form.title
  // Opened from a tool, not by the person: on a narrow terminal it waits for the band's Show.
  if (!(await showPane($, GATE_PANE, title))) $.ui.toast(`${title} is waiting: press Show above the prompt`)
}

// The AskUserQuestion hook that rings herdr's bell never fires for a kit form, so opening one rings it. Outside herdr nothing rings.
async function ringBell($: EngineInterface, form: Form): Promise<void> {
  if ((await $.env.get('HERDR_ENV')) !== '1' || !(await $.env.get('HERDR_PANE_ID'))) return
  await $.process.run(bellArgs(await $.session.cwd(), form.questions), { timeoutMs: QUICK_TIMEOUT_MS }).catch(() => undefined)
}

// A gate ended on another surface: its form closes, or its band entry goes. That surface's doorbell wakes the agent;
// only the pane's own answer, which rings none, wakes it from here, and only when no answer of this pane's is settling it.
async function gateEnded($: EngineInterface, gateId: string, end: GateEnd): Promise<void> {
  if ((await read($, boardAtom)).some(b => b.gateId === gateId)) await update($, boardAtom, list => list.filter(b => b.gateId !== gateId))
  const open = (await readForms($)).filter(f => f.gateId === gateId && f.status === 'open' && !answering.has(f.id))
  if (open.length === 0) return $.ui.invalidate('ui.render')
  const self = isSelf(end, await $.session.id())
  const won = end.status === 'answered' ? end.answers : undefined
  const note = self ? undefined : [endNote(end), won && controlText(won)].filter(Boolean).join('. ')
  const patch: Partial<Form> = self
    ? { status: 'answered', error: undefined }
    : { status: end.status === 'answered' ? 'answered' : 'cancelled', error: undefined, note, ...(won && { won }) }
  const forms = await writeForms($, list => list.map(f => (open.some(o => o.id === f.id) ? { ...f, ...patch } : f)))
  if (self) await wake($, GATE_ANSWERED(gateId), `the answer to gate ${gateId}`)
  await showCurrent($, forms, note && `${open[0]!.title}: ${note}`)
}

// A run control's answer carries only the reserved keys, so the closed form says what it did.
function controlText(answers: Record<string, unknown>): string | undefined {
  if (answers.next === 'hold') return 'Paused the run'
  if (answers.next === 'go-back') return typeof answers.to === 'string' && answers.to !== '' ? `Went back to ${answers.to}` : 'Went back a stage'
  return undefined
}

// Runs for as long as the gate waits, after the hook that started it has returned.
function watchGate($: EngineInterface, gateId: string): void {
  if (!setting.isOn || watching.has(gateId)) return
  watching.add(gateId)
  void (async () => {
    try {
      const end = await waitFor($, gateId)
      if (end) await gateEnded($, gateId, end)
    } catch {
      // A module unloading mid-wait has nowhere left to write.
    } finally {
      watching.delete(gateId)
    }
  })()
}

async function gateOpened($: EngineInterface, form: Form): Promise<void> {
  if (form.gateId) watchGate($, form.gateId)
  void ringBell($, form)
}

async function readDeck($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  for (const name of ['deck', `${home ?? ''}/.local/bin/deck`]) {
    try {
      const ran = await $.process.run([name, 'list', '--json'], { timeoutMs: QUICK_TIMEOUT_MS })
      deck.address = ran.exitCode === 0 ? (boardAddress(ran.stdout) ?? null) : null
      return
    } catch {
      deck.address = null
    }
  }
}

// The result is left as the tool gave it: the agent still waits with `rt gate wait`, and the band is only a shortcut.
async function addBoard($: EngineInterface, gate: BoardGate, supersededId?: string): Promise<void> {
  await readDeck($)
  await update($, boardAtom, list => addBoardGate(list, gate, supersededId))
  watchGate($, gate.gateId)
  $.ui.invalidate('ui.render')
}

// A kit gate the form can't draw is open already, and the injector and the fork check keep the pane from answering it,
// so it goes to the band like a board-only gate: never left open with nothing drawn.
async function sendToBoard($: EngineInterface, gate: BoardGate, reason: string, supersededId?: string): Promise<void> {
  await addBoard($, gate, supersededId)
  $.ui.toast(BOARD_TOAST(kindTitle(gate.kind), reason))
}

async function openBoard($: EngineInterface, gateId: unknown): Promise<void> {
  const gate = (await read($, boardAtom)).find(b => b.gateId === gateId)
  if (!gate || !deck.address) return
  await $.process.run(['open', boardUrl(deck.address, gate.gateId)]).catch(() => $.ui.toast('Could not open the board'))
}

// Watchers die with the module, so a session start (a reload, a resume, a compaction) watches this session's gates again.
// It also draws a kit gate whose takeover failed after the daemon opened it. Nothing comes back for a gate that ended.
async function restore($: EngineInterface): Promise<void> {
  let rows
  try {
    const ran = await runRt($, ['gate', 'list', '--json'])
    rows = ran.exitCode === 0 ? listedGates(ran.stdout) : undefined
  } catch {
    rows = undefined
  }
  // Without the list nothing new is drawn and nothing reads as ended, but every stored form and band entry is watched again.
  const listed = rows ?? []
  const session = rows ? await $.session.id() : ''
  const byId = new Map(listed.map(row => [row.id, row]))
  const fresh: Form[] = []
  const undrawable: { gate: BoardGate; reason: string }[] = []
  for (const row of listed
    .filter(row => row.presentation === 'kit' && row.status === 'open' && (row.nudge as { session?: unknown } | null)?.session === session)
    .sort((a, b) => Number(a.openedAt ?? 0) - Number(b.openedAt ?? 0))) {
    const form = formFromRow(row)
    if (typeof form === 'string') undrawable.push({ gate: { gateId: row.id, kind: typeof row.kind === 'string' ? row.kind : '' }, reason: form })
    else fresh.push(form)
  }
  const added: Form[] = []
  const forms = await writeForms($, list =>
    fresh.reduce((acc, form) => {
      if (acc.some(f => f.gateId === form.gateId)) return acc
      added.push(form)
      return addForm(acc, form)
    }, list),
  )
  const onBoard = (await read($, boardAtom)).map(b => b.gateId)
  const newlyOnBoard = undrawable.filter(u => !onBoard.includes(u.gate.gateId) && !forms.some(f => f.gateId === u.gate.gateId))
  if (newlyOnBoard.length > 0) await update($, boardAtom, list => newlyOnBoard.reduce((acc, u) => addBoardGate(acc, u.gate), list))
  for (const u of newlyOnBoard) $.ui.toast(BOARD_TOAST(kindTitle(u.gate.kind), u.reason))
  const ended = (gateId: string) => {
    const row = byId.get(gateId)
    return row ? rowEnd(row) : undefined
  }
  for (const form of forms.filter(f => f.status === 'open' && f.gateId)) {
    const end = ended(form.gateId!)
    if (end) await gateEnded($, form.gateId!, end)
    else watchGate($, form.gateId!)
  }
  for (const gate of await read($, boardAtom)) {
    const end = ended(gate.gateId)
    if (end) await gateEnded($, gate.gateId, end)
    else watchGate($, gate.gateId)
  }
  // Read again on every start with a band: deck may have moved the board since the last read.
  if ((await read($, boardAtom)).length > 0) await readDeck($)
  for (const form of added) void ringBell($, form)
  $.ui.invalidate('ui.render')
}

// Only a main-loop call on a surface that draws the form takes it; a hand-back opens nothing to draw.
function canDraw(e: ToolCallInput): boolean {
  if (!setting.isOn) return false
  const surface = drawn.surface
  const args = e as unknown as { handBack?: unknown }
  return e.agentId === undefined && args.handBack !== true && (surface === 'terminal' || surface === 'desktop')
}

const textOf = (out: ToolCallResult): string => {
  if (typeof out.text === 'string') return out.text
  const result: unknown = out.result
  if (typeof result === 'string') return result
  const blocks = Array.isArray(result) ? result : ((result as { content?: unknown } | null)?.content ?? [])
  return (Array.isArray(blocks) ? blocks : []).map(b => (typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('')
}

// The tool's own shape, its text replaced.
function withText(result: unknown, text: string): unknown {
  if (Array.isArray(result)) return [{ type: 'text', text }]
  if (result && typeof result === 'object' && 'content' in result) return { ...(result as object), content: [{ type: 'text', text }], structuredContent: undefined }
  return text
}

async function takeGate($: EngineInterface, e: ToolCallInput, next: Next): Promise<ToolCallResult> {
  if (setting.reading) await setting.reading
  if (!canDraw(e)) return next(e)
  const out = await next({ ...e, kitForm: true } as ToolCallInput)
  if (out.deny !== undefined || out.isError) return out
  const text = textOf(out)
  const kit = readKitResult(text)
  const board = kit.kind === 'other' ? readBoardOnly(text) : undefined
  if (board) await addBoard($, { gateId: board.gateId, kind: String((e as unknown as { kind?: unknown }).kind ?? '') }, board.supersededId)
  if (kit.kind === 'other') return out
  const kind = (e as unknown as { kind?: unknown }).kind
  const title = typeof kind === 'string' && kind.trim() !== '' ? kind : GATE_TITLE
  if (kit.kind === 'kit') {
    const form = gateForm(kit.fields, title)
    if (typeof form === 'string') {
      const gateId = kit.fields.id
      if (typeof gateId !== 'string' || gateId === '') return out
      const superseded = kit.fields.supersededId
      await sendToBoard($, { gateId, kind: typeof kind === 'string' ? kind : '' }, form, typeof superseded === 'string' ? superseded : undefined)
      return { result: withText(out.result, JSON.stringify(boardFields(kit.fields))) as never }
    }
    await openForm($, form, kit.fields.supersededId as string | null | undefined)
    await gateOpened($, form)
    return { result: withText(out.result, JSON.stringify(agentFields(kit.fields))) as never }
  }
  return takeSpilled($, out, text)
}

async function takeSpilled($: EngineInterface, out: ToolCallResult, text: string): Promise<ToolCallResult> {
  const known = (await readForms($)).flatMap(f => (f.gateId ? [f.gateId] : []))
  let row
  try {
    const ran = await runRt($, ['gate', 'list', '--open', '--json'])
    row = ran.exitCode === 0 ? spilledGate(ran.stdout, await $.session.id(), known) : undefined
  } catch {
    row = undefined
  }
  if (!row) return out
  const form = formFromRow(row)
  if (typeof form === 'string') {
    await sendToBoard($, { gateId: row.id, kind: typeof row.kind === 'string' ? row.kind : '' }, form)
    return { result: withText(out.result, `${text}\n\n${BOARD_INSTRUCTION(row.id)}`) as never }
  }
  await openForm($, form)
  await gateOpened($, form)
  return { result: withText(out.result, `${text}\n\n${GATE_INSTRUCTION(row.id)}`) as never }
}

// The newest board gate above the prompt, its button opening it on the board. A surface without Client gets the engine's own Button.
function boardBand($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], rest: RenderElement, board: BoardGate[]) {
  const newest = board.at(-1)!
  const text = boardText(board)
  const hasAddress = typeof deck.address === 'string'
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const Client = 'Client' in els ? els.Client : undefined
  const band = Client ? (
    <Client key="board-band" module="./board-band.tsx" props={{ text, gateId: newest.gateId, hasAddress }} />
  ) : (
    <Box flexDirection="row" gap={2}>
      <Text wrap="truncate-end">{text}</Text>
      {hasAddress ? <Button key="open-board" label="Open on board" onPress={() => openBoard($, newest.gateId)} /> : <Text dimColor>{NO_ADDRESS}</Text>}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {band}
      {rest}
    </Box>
  )
}

async function turnOn($: EngineInterface): Promise<void> {
  // Gates still restore when the tool can't be listed.
  await $.tool.register({ name: TOOL, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA, isDeferred: false }).catch(() => undefined)
  await restore($)
}

// A function declaration, not a const arrow: a bundler keeps it one, and the engine's source check requires it.
export function register(on: On): void {
  registerPaneRedraw(on)

  // With rt.gates.kitForm off the mod registers nothing: an always-listed ask tool would invite agents to use it for any question.
  on('session.start', async ($, e, next) => {
    // Not awaited, so a slow rt never holds the session's start; a gate call waits for it, and the tool is listed from the next prompt.
    setting.reading = readSetting($)
    void setting.reading.then(() => (setting.isOn ? turnOn($) : undefined)).catch(() => undefined)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__gate-form__ask' }, async ($, e) => {
    if (setting.reading) await setting.reading
    if (!setting.isOn) return { deny: ASK_OFF }
    const args = e as unknown as { title?: unknown; context?: unknown; questions?: unknown }
    const form = toForm(args.title, args.context, args.questions, 'ask')
    if (typeof form === 'string') return { deny: form }
    await openForm($, form)
    return {
      result: `Form ${form.id} is open in the pane with ${form.questions.length} questions. End your turn now: the user's answers arrive as your next input, as JSON keyed by question id.`,
    }
  })

  // A failed takeover leaves the call as the tool answered it: `next` replays a settled call rather than opening a second gate.
  on('tool.call', { tool: 'mcp__plugin_mattstack_mattstack__gate_ask' }, ($, e, next) => takeGate($, e, next)).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'mcp__plugin_mattstack_mattstack__gate_open' }, ($, e, next) => takeGate($, e, next)).catch(($, e, next) => next(e))

  on('prompt.edit', async ($, e, next) => {
    await setKeysInForm($, false)
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    await setKeysInForm($, false)
    return next(e)
  })
  on('ui.focus', async ($, e, next) => {
    await setKeysInForm($, false)
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    if (isEngaged(e)) await setKeysInForm($, true)
    await paneMessage($, e, GATE_PANE, await waitingForm($))
    const posted = e.data as { type?: unknown; gateId?: unknown } | null
    if (posted?.type === 'open-board') await openBoard($, posted.gateId)
    if (e.requestId !== PANE) return next(e)
    const message = e.data as FormMessage
    if (message.type === 'answer') await settle($, message.formId, { status: 'answered', answers: message.answers ?? {} })
    if (message.type === 'chat') await settle($, message.formId, { status: 'chat', draft: message.draft ?? {} })
    return next(e)
  })

  // Other plugins' bands draw under this one.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    drawn.surface = e.surface
    if (e.props.hasSurvey) return next(e)
    const waiting = await waitingForm($)
    const formWaits = waiting !== undefined && !(await isPlaced($, GATE_PANE))
    // Until deck has been asked, the band can't say whether the board can be opened, so it waits for the answer.
    const board = setting.isOn && deck.address !== undefined ? await read($, boardAtom) : []
    if (!formWaits && board.length === 0) return next(e)
    const rest = formWaits ? await bandAbovePrompt($, e, await next(e), waiting, GATE_PANE, { engineShow: true }) : await next(e)
    return board.length > 0 ? boardBand($, e, rest, board) : rest
  })

  // The form draws only the rows that fit, so the engine has nothing to scroll: a wheel turn scrolls the form's own page.
  on('ui.scroll', { component: 'Pane', requestId: 'gate-form' }, async ($, e, next) => {
    if (e.contentRows > e.bodyRows) return next(e)
    addWheel($, PANE, e.by)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Client = 'Client' in els ? els.Client : undefined
    const form = currentForm(await readForms($))
    if (!form) return <Text dimColor>No questions right now.</Text>
    if (!Client) return <Text dimColor>This screen can't draw the form yet. Answer in the terminal.</Text>
    const body = paneRows(e)
    const rows = Math.max(8, body - 3)
    const focused = e.props.isFocused || (await read($, keysAtom))
    // The Close row and the gap above it take two of the body's rows.
    const height = Math.max(1, form.status === 'open' ? body : body - 2)
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Client key={`form-${form.id}`} module="./form.tsx" height={height} props={{ form: fitForm(form, FORM_BUDGET), rows, cols: (e.props.bodyColumns ?? 60) - 2, focused, wheel: wheelTotal(PANE) }} />
        {form.status === 'open' ? null : (
          <Box flexDirection="row" gap={1}>
            <Button key="close" role="dismiss" label="Close" onPress={() => void $.ui.close({ id: PANE })} />
          </Box>
        )}
      </Box>
    )
  })
}
