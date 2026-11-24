import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderSurface, Timer, ToolCallInput, ToolCallResult } from 'claude-code'
import { addWheel, bandAbovePrompt, hotkeyChoices, isEngaged, isPlaced, paneMessage, paneRows, registerPaneRedraw, showPane, wheelTotal, type HideablePane, type Waiting } from '@mattstack/mod-kit'

import type { BoardGate, Form, GateFormAskResult, LegacyForm } from '../types'
import { bellArgs } from './gate/bell'
import { BLOCKER_MESSAGE_MAX, clearArgs, raiseArgs } from './gate/blocker'
import { NO_ADDRESS, addBoardGate, boardAddress, boardText, boardUrl, kindTitle, readBoardOnly } from './gate/board'
import { addForm, currentForm, fitForm, fromLegacy, knownForms, openCount, patchForm, waitingTitle } from './gate/forms'
import { runHerdr } from './gate/herdr'
import { PLUGIN_QUESTION, agentFields, answerOutcome, boardFields, formFromRow, gateForm, listedGates, pluginForm, readKitResult, savedResult, spillPaths, spilledGate, toForm, type GateCall } from './gate/parse'
import { BOARD_INSTRUCTION, BOARD_TOAST, GATE_ANSWERED, GATE_ASIDE, GATE_INSTRUCTION, agentReply, type Outcome } from './gate/reply'
import { rowInput } from './gate/row'
import { RT_TIMEOUT_MS, rtError, runRt, settingIsOn } from './gate/rt'
import { Overran } from './gate/run'
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
// The pause before each new `rt gate wait` after one failed; past the last, the gate waits for a session start.
const WAIT_RETRY_MS = [1_000, 5_000, 15_000]
// Forms whose answer rt is recording: the pane's own answer settles them, never a watcher.
const answering = new Set<string>()
// The board's local address as deck last gave it; null when deck has none.
const deck: { address?: string | null } = {}
// What herdr was last told for this pane (the message, null once cleared, undefined while unknown) and what the
// latest write wants it to show. Runs go through one chain, each sending the latest target when it runs.
// `isRaised` is whether herdr took the last raise. While a form shows, `watch` checks herdr's socket, last bound at
// `boundAt`; `again` counts the checks left that raise once more.
type Blocker = { shown?: string | null; target?: string | null; isRaised: boolean; chain: Promise<void>; watch?: Timer; boundAt?: number; again: number }
const blocker: Blocker = { isRaised: false, chain: Promise.resolve(), again: 0 }
const SOCKET_CHECK_MS = 5_000
// herdr drops a raise on a pane whose agent it has not detected yet, so a new server or a new session gets the raise
// a few times; a repeat of one it took changes nothing.
const RAISES = 3
// session.end's whole chain shares one short bound, so the clear leaves room for the hooks after it.
const END_MARGIN_MS = 250

// `$.gateForm` asks this load issued, by form id, until `wait` collects the outcome; a reload forgets them all.
type Asked = { outcome?: GateFormAskResult; wakes: (() => void)[]; timer?: Timer }
const asked = new Map<string, Asked>()
// Plugin forms waiting for the open one to end, oldest first: only one is open at a time.
const queued: Form[] = []
// Under the 10 s a call on a plugin noun has to answer in.
const WAIT_MS = 5_000
const TIMED_OUT = 'No answer in time.'
const CLOSED = 'Closed without an answer.'

type FormMessage = { type: 'answer'; formId: string; answers?: Record<string, unknown> } | { type: 'chat'; formId: string; draft?: Record<string, unknown> }
type Next = (e: ToolCallInput) => Promise<ToolCallResult>

const GATE_PANE: HideablePane = { id: PANE, label: 'mattstack gate waiting' }

async function readForms($: EngineInterface): Promise<Form[]> {
  const forms = knownForms(await read($, formsAtom))
  return forms.length > 0 ? forms : fromLegacy(await read($, legacyAtom))
}

const blockerTitle = (list: Form[]) => waitingTitle(list, BLOCKER_MESSAGE_MAX)

async function writeForms($: EngineInterface, change: (list: Form[]) => Form[]): Promise<Form[]> {
  const legacy = fromLegacy(await read($, legacyAtom))
  let written: Form[] = []
  await update($, formsAtom, stored => {
    const list = knownForms(stored)
    written = change(list.length > 0 || legacy.length === 0 ? list : legacy)
    // Set as the list is written, so a later write's target is never overwritten by this one's.
    blocker.target = blockerTitle(written)
    return written
  })
  void syncBlocker($)
  if (legacy.length > 0) await update($, legacyAtom, () => null)
  return written
}

async function herdrPane($: EngineInterface): Promise<string | undefined> {
  if ((await $.env.get('HERDR_ENV')) !== '1') return undefined
  return (await $.env.get('HERDR_PANE_ID')) || undefined
}

// herdr shows the pane as blocked while a form waits. A herdr without the verb fails the run, which changes nothing.
function syncBlocker($: EngineInterface, target: () => string | null | undefined = () => blocker.target): Promise<void> {
  blocker.chain = blocker.chain.then(() => tellHerdr($, target())).catch(() => undefined)
  return blocker.chain
}

// A failed clear is tried again by the next run; a failed raise is not, so an old herdr is not called on every write.
async function tellHerdr($: EngineInterface, target: string | null | undefined): Promise<void> {
  if (target === undefined || target === blocker.shown) return
  blocker.shown = target
  const pane = await herdrPane($)
  if (!pane) return
  if (target === null) {
    stopWatch()
    const ran = await runHerdr($, clearArgs(pane)).catch(() => undefined)
    blocker.isRaised = false
    if (ran?.exitCode !== 0) blocker.shown = undefined
    return
  }
  await startWatch($)
  await raise($, pane, target)
}

async function raise($: EngineInterface, pane: string, message: string): Promise<void> {
  const ran = await runHerdr($, raiseArgs(pane, message)).catch(() => undefined)
  blocker.isRaised = ran?.exitCode === 0
}

async function socketBoundAt($: EngineInterface, socket: string): Promise<number | undefined> {
  const stat = await $.fs.stat(socket).catch(() => undefined)
  return stat?.mtimeMs
}

// A live handoff or a server restart binds a new socket at the same path, and the server behind it holds no blocker.
async function startWatch($: EngineInterface): Promise<void> {
  if (blocker.watch) return
  const socket = await $.env.get('HERDR_SOCKET_PATH')
  if (!socket) return
  blocker.boundAt = await socketBoundAt($, socket)
  blocker.watch = $.clock.every(SOCKET_CHECK_MS, () => void checkSocket($, socket).catch(() => undefined))
}

function stopWatch(): void {
  blocker.watch?.cancel()
  blocker.watch = undefined
  blocker.again = 0
}

async function checkSocket($: EngineInterface, socket: string): Promise<void> {
  const boundAt = await socketBoundAt($, socket)
  if (boundAt === undefined) return
  if (boundAt !== blocker.boundAt) blocker.again = RAISES
  blocker.boundAt = boundAt
  if (blocker.again === 0) return
  blocker.again -= 1
  // A clear already on the chain stops the watch, and nothing is raised after it.
  blocker.chain = blocker.chain
    .then(async () => {
      const pane = await herdrPane($)
      if (pane && blocker.watch && typeof blocker.shown === 'string') await raise($, pane, blocker.shown)
    })
    .catch(() => undefined)
}

// A form closed before it was answered waits above the prompt, with a way back to it.
async function waitingForm($: EngineInterface): Promise<Waiting | undefined> {
  const forms = await readForms($)
  const title = waitingTitle(forms)
  return title === null ? undefined : { formId: currentForm(forms)!.id, title }
}

async function setKeysInForm($: EngineInterface, value: boolean): Promise<void> {
  if ((await read($, keysAtom)) !== value) await update($, keysAtom, () => value)
}

async function wake($: EngineInterface, text: string, what: string, recovery?: string): Promise<void> {
  const warn = () => $.ui.toast(`Could not tell Claude about ${what}${recovery ? `. ${recovery}` : ''}`)
  void $.prompt
    .submit({ text })
    .then(sent => {
      if (sent.drop !== undefined) warn()
    })
    .catch(warn)
}

// The pane's own answer is stamped consumed, so no sweep rings for it again: the toast is the only way back.
async function wakeAnswered($: EngineInterface, gateId: string): Promise<void> {
  await wake($, GATE_ANSWERED(gateId), `the answer to gate ${gateId}`, `Ask it to run gate_reconcile ${gateId}.`)
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
  failure instanceof Overran
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
  const by = form.relay ? 'shepherd' : 'pane'
  const args = ['gate', 'answer', gateId, '--answers', JSON.stringify(answers), '--by', by, '--session', session]
  let error: string | undefined
  let outcome: 'recorded' | 'elsewhere' = 'recorded'
  try {
    const ran = await runRt($, args)
    if (ran.exitCode !== 0) error = `Not recorded: ${rtError(ran)}`
    else outcome = answerOutcome(ran.stdout, session, by)
  } catch (failure) {
    error = failureText(failure)
  }
  if (error !== undefined) {
    await markFailed($, form, error)
    return false
  }
  const patch: Partial<Form> = outcome === 'elsewhere' ? { status: 'answered', error: undefined, note: ELSEWHERE } : { status: 'answered', error: undefined }
  const forms = await writeForms($, list => patchForm(list, form.id, patch))
  // A relayed answer wakes the worker through its own `rt gate wait`; the shepherd has nothing to reconcile.
  if (outcome === 'recorded' && !form.relay) await wakeAnswered($, gateId)
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
  if (form.source === 'plugin') return settlePlugin($, form, outcome)
  if (form.source === 'gate') {
    if (outcome.status === 'answered') return answerGate($, form, outcome.answers)
    return setGateAside($, form)
  }
  const status: Form['status'] = outcome.status === 'answered' ? 'answered' : 'cancelled'
  const forms = await writeForms($, list => patchForm(list, formId, { status }))
  await wake($, agentReply(form, outcome), `the answers for ${formId}`)
  await showCurrent($, forms)
}

// The timeout runs from the ask, queued or not, so the caller hears back within the time it gave.
async function askPlugin($: EngineInterface, args: unknown): Promise<{ value: { id: string } } | { deny: string }> {
  const form = pluginForm(args)
  if (typeof form === 'string') return { deny: form }
  const entry: Asked = { wakes: [] }
  asked.set(form.id, entry)
  entry.timer = $.clock.after((args as { timeoutMs: number }).timeoutMs, () => void endAsk($, form.id, { timedOut: true }, TIMED_OUT).catch(() => undefined))
  const isAsking = (await readForms($)).some(f => f.source === 'plugin' && f.status === 'open' && asked.has(f.id))
  if (isAsking || queued.length > 0) queued.push(form)
  else await openAsk($, form)
  return { value: { id: form.id } }
}

async function waitAsk($: EngineInterface, id: string): Promise<GateFormAskResult | { pending: true }> {
  const entry = asked.get(id)
  if (!entry) return { closed: true }
  if (!entry.outcome) {
    const stop = new AbortController()
    await Promise.race([new Promise<void>(resolve => entry.wakes.push(resolve)), $.clock.sleep(WAIT_MS, { signal: stop.signal }).catch(() => undefined)])
    stop.abort()
  }
  if (!entry.outcome) return { pending: true }
  asked.delete(id)
  return entry.outcome
}

// Records the outcome for the caller's `wait`, closes the form, and opens the next queued one.
// A form with no ask behind it, left from an earlier load, only closes.
async function endAsk($: EngineInterface, id: string, outcome: GateFormAskResult, note?: string): Promise<void> {
  const entry = asked.get(id)
  if (entry?.outcome) return
  if (entry) {
    entry.outcome = outcome
    entry.timer?.cancel()
    for (const wake of entry.wakes.splice(0)) wake()
  }
  const at = queued.findIndex(f => f.id === id)
  if (at >= 0) {
    queued.splice(at, 1)
    return
  }
  const status: Form['status'] = 'value' in outcome ? 'answered' : 'cancelled'
  // One write ends this form and opens the next, so herdr's blocker never drops between them.
  const next = queued.shift()
  const forms = await writeForms($, list => {
    const ended = patchForm(list, id, { status, ...(note && { note }) })
    return next ? addForm(ended, next) : ended
  })
  if (next) await revealForm($, forms, next).catch(() => undefined)
  else await showCurrent($, forms)
}

// A pane that can't be placed leaves the form stored, waiting above the prompt, and the ask's timer running.
async function openAsk($: EngineInterface, form: Form): Promise<void> {
  await openForm($, form).catch(() => undefined)
}

// A plugin form is answered here, never by the agent: no prompt is sent for it.
// A second press can land while the first answer is still being written: the ask's entry is gone by then, so it is ignored.
async function settlePlugin($: EngineInterface, form: Form, outcome: Outcome): Promise<void> {
  if (!asked.has(form.id)) return
  const value = outcome.status === 'answered' ? outcome.answers[PLUGIN_QUESTION] : undefined
  await (typeof value === 'string' ? endAsk($, form.id, { value }) : endAsk($, form.id, { closed: true }, CLOSED))
}

// A plugin form stored by an earlier load has no caller left to answer, so a session start closes it.
async function closeOrphans($: EngineInterface): Promise<void> {
  const isOrphan = (f: Form) => f.source === 'plugin' && f.status === 'open' && !asked.has(f.id)
  if (!(await readForms($)).some(isOrphan)) return
  const forms = await writeForms($, list => list.map(f => (isOrphan(f) ? { ...f, status: 'cancelled' as const, note: CLOSED } : f)))
  if (openCount(forms) === 0) await $.ui.close({ id: PANE })
  $.ui.invalidate('ui.render')
}

// Answers whether a form was open already.
async function openForm($: EngineInterface, form: Form, supersededId?: string | null): Promise<boolean> {
  let wasOpen = false
  const forms = await writeForms($, list => {
    wasOpen = openCount(list) > 0
    return addForm(list, form, supersededId)
  })
  await revealForm($, forms, form)
  return wasOpen
}

async function revealForm($: EngineInterface, forms: Form[], form: Form): Promise<void> {
  const title = currentForm(forms)?.title ?? form.title
  // Opened from a tool, not by the person: on a narrow terminal it waits for the band's Show.
  if (!(await showPane($, GATE_PANE, title))) $.ui.toast(`${title} is waiting: press Show above the prompt`)
}

// The AskUserQuestion hook that rings herdr's bell never fires for a kit form, so opening one shows its notification.
// herdr chimes by itself when a pane turns blocked, so the notification makes a sound only when the pane does not:
// it was blocked already, or this herdr can't show it. Outside herdr nothing rings.
async function ringBell($: EngineInterface, form: Form, wasOpen: boolean): Promise<void> {
  if (!(await herdrPane($))) return
  await blocker.chain
  const sound = wasOpen || !blocker.isRaised ? 'request' : 'none'
  await runHerdr($, bellArgs(await $.session.cwd(), form.questions, sound)).catch(() => undefined)
}

// A gate ended on another surface: its form closes, or its band entry goes. That surface's doorbell wakes the agent;
// only the pane's own answer, which rings none, wakes it from here, and only when no answer of this pane's is settling it.
async function gateEnded($: EngineInterface, gateId: string, end: GateEnd): Promise<void> {
  if ((await read($, boardAtom)).some(b => b.gateId === gateId)) await update($, boardAtom, list => list.filter(b => b.gateId !== gateId))
  const open = (await readForms($)).filter(f => f.gateId === gateId && f.status === 'open' && !answering.has(f.id))
  if (open.length === 0) return $.ui.invalidate('ui.render')
  const session = await $.session.id()
  const relay = open.some(f => f.relay)
  const self = isSelf(end, session) || (relay && end.status === 'answered' && end.by === 'shepherd' && end.session === session)
  const won = end.status === 'answered' ? end.answers : undefined
  const note = self ? undefined : [endNote(end), won && controlText(won)].filter(Boolean).join('. ')
  const patch: Partial<Form> = self
    ? { status: 'answered', error: undefined }
    : { status: end.status === 'answered' ? 'answered' : 'cancelled', error: undefined, note, ...(won && { won }) }
  const forms = await writeForms($, list => list.map(f => (open.some(o => o.id === f.id) ? { ...f, ...patch } : f)))
  if (self && !relay) await wakeAnswered($, gateId)
  await showCurrent($, forms, note && `${open[0]!.title}: ${note}`)
}

// A run control's answer carries only the reserved keys, so the closed form says what it did.
function controlText(answers: Record<string, unknown>): string | undefined {
  if (answers.next === 'hold') return 'Paused the run'
  if (answers.next === 'go-back') return typeof answers.to === 'string' && answers.to !== '' ? `Went back to ${answers.to}` : 'Went back a stage'
  return undefined
}

// Whether this pane still shows the gate: an open form or a band entry, which a lost watcher would leave stale.
async function shownHere($: EngineInterface, gateId: string): Promise<boolean> {
  if ((await readForms($)).some(f => f.gateId === gateId && f.status === 'open')) return true
  return (await read($, boardAtom)).some(b => b.gateId === gateId)
}

// Runs for as long as the gate waits, after the hook that started it has returned. A failed wait is started again
// after each pause while this pane still shows the gate; the pause holds no watch, so any other start goes ahead.
function watchGate($: EngineInterface, gateId: string, retry = 0): void {
  if (!setting.isOn || watching.has(gateId)) return
  watching.add(gateId)
  void (async () => {
    let failed = false
    try {
      const end = await waitFor($, gateId)
      if (end) await gateEnded($, gateId, end)
      else failed = true
    } catch {
      // A module unloading mid-wait has nowhere left to write.
    } finally {
      watching.delete(gateId)
    }
    const pause = WAIT_RETRY_MS[retry]
    if (!failed || pause === undefined) return
    try {
      if (!(await shownHere($, gateId))) return
      await $.clock.sleep(pause)
      if (await shownHere($, gateId)) watchGate($, gateId, retry + 1)
    } catch {
      // As above: an unloaded module retries nothing.
    }
  })()
}

async function gateOpened($: EngineInterface, form: Form, wasOpen: boolean): Promise<void> {
  if (form.gateId) watchGate($, form.gateId)
  void ringBell($, form, wasOpen)
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
  let wasOpen = false
  const forms = await writeForms($, list => {
    added.length = 0
    wasOpen = openCount(list) > 0
    return fresh.reduce((acc, form) => {
      if (acc.some(f => f.gateId === form.gateId)) return acc
      added.push(form)
      return addForm(acc, form)
    }, list)
  })
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
  for (const [i, form] of added.entries()) void ringBell($, form, wasOpen && i === 0)
  $.ui.invalidate('ui.render')
}

// Only a main-loop call on a surface that draws the form takes it; a hand-back opens nothing to draw.
function canDraw(e: ToolCallInput): boolean {
  if (!setting.isOn) return false
  const args = e as unknown as { handBack?: unknown }
  return e.agentId === undefined && args.handBack !== true && drawsForm(drawn.surface)
}

const drawsForm = (surface?: RenderSurface) => surface === 'terminal' || surface === 'desktop'

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

// herd_gate_present always answers in the kit shape, so it takes no kitForm input.
async function takeGate($: EngineInterface, e: ToolCallInput, next: Next, present = false): Promise<ToolCallResult> {
  if (setting.reading) await setting.reading
  if (!canDraw(e)) return next(e)
  const out = await next(present ? e : ({ ...e, kitForm: true } as ToolCallInput))
  if (out.deny !== undefined || out.isError) return out
  const text = textOf(out)
  const kit = readKitResult(text)
  const board = kit.kind === 'other' ? readBoardOnly(text) : undefined
  // A presented gate's kind is in its result: the shepherd's call names only the gate.
  const boardKind = board && present ? (JSON.parse(text) as { kind?: unknown }).kind : (e as unknown as { kind?: unknown }).kind
  if (board) await addBoard($, { gateId: board.gateId, kind: String(boardKind ?? '') }, board.supersededId)
  if (kit.kind === 'other') return out
  const kind = present && kit.kind === 'kit' ? kit.fields.kind : (e as unknown as { kind?: unknown }).kind
  const title = typeof kind === 'string' && kind.trim() !== '' ? kind : GATE_TITLE
  const kindText = typeof kind === 'string' ? kind : ''
  // A presented gate is a worker's, not this agent's to hold on: one the form can't take goes back untouched,
  // so the shepherd presents it another way and keeps presenting the rest.
  if (present && (kit.kind !== 'kit' || typeof gateForm(kit.fields, GATE_TITLE) === 'string')) return out
  if (kit.kind === 'kit') {
    const gateId = kit.fields.id
    if (typeof gateId !== 'string' || gateId === '') return out
    // A gate presented again (a repeat push, a shepherd that compacted) keeps the form already queued, with its picks.
    if (present && (await readForms($)).some(f => f.gateId === gateId && f.status === 'open')) return { result: withText(out.result, JSON.stringify(agentFields(kit.fields))) as never }
    const shown = await showKitGate($, gateForm(kit.fields, title), { gateId, kind: kindText }, supersededOf(kit.fields))
    return { result: withText(out.result, JSON.stringify(shown === 'form' ? agentFields(kit.fields) : boardFields(kit.fields))) as never }
  }
  return takeSpilled($, e, out, text, title, kindText)
}

const supersededOf = (fields: Record<string, unknown>) => (typeof fields.supersededId === 'string' ? fields.supersededId : undefined)

// Opens the gate's form, or sends the gate to the board when the form can't draw it.
async function showKitGate($: EngineInterface, form: Form | string, gate: BoardGate, supersededId?: string): Promise<'form' | 'board'> {
  if (typeof form === 'string') {
    await sendToBoard($, gate, form, supersededId)
    return 'board'
  }
  await gateOpened($, form, await openForm($, form, supersededId))
  return 'form'
}

// A spilled result's own file names the exact gate; without it, only a gate matching this call is taken, and none is drawn on a guess.
async function takeSpilled($: EngineInterface, e: ToolCallInput, out: ToolCallResult, text: string, title: string, kindText: string): Promise<ToolCallResult> {
  const saved = await readSpill($, text)
  if (saved && saved.paneAction !== 'kit') return out
  let gateId: string
  let form: Form | string
  let supersededId: string | undefined
  if (saved && typeof saved.id === 'string' && saved.id !== '') {
    gateId = saved.id
    form = gateForm(saved, title)
    supersededId = supersededOf(saved)
  } else {
    const row = await matchingGate($, e)
    if (!row) return out
    gateId = row.id
    form = formFromRow(row)
  }
  const shown = await showKitGate($, form, { gateId, kind: kindText }, supersededId)
  return { result: withText(out.result, `${text}\n\n${shown === 'form' ? GATE_INSTRUCTION(gateId) : BOARD_INSTRUCTION(gateId)}`) as never }
}

async function readSpill($: EngineInterface, text: string): Promise<Record<string, unknown> | undefined> {
  for (const path of spillPaths(text)) {
    try {
      const saved = savedResult(await $.fs.read(path))
      if (saved) return saved
    } catch {
      // Not a file the pointer saved; the next path, or the gate list, may still say.
    }
  }
  return undefined
}

async function matchingGate($: EngineInterface, e: ToolCallInput) {
  const known = (await readForms($)).flatMap(f => (f.gateId ? [f.gateId] : []))
  try {
    const ran = await runRt($, ['gate', 'list', '--open', '--json'])
    return ran.exitCode === 0 ? spilledGate(ran.stdout, await $.session.id(), known, e as unknown as GateCall) : undefined
  } catch {
    return undefined
  }
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

  // Other plugins ask through `$.gateForm` whatever rt.gates.kitForm says: their question is not a gate.
  // This module's own hooks below answer each call; the functions here only stand beneath them.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    return { ...built, gateForm: { ask: async () => ({ id: '' }), wait: async () => ({ closed: true as const }) } }
  })
  on('gateForm.ask', ($, e) => askPlugin($, e))
  on('gateForm.wait', ($, e) => waitAsk($, e.id).then(value => ({ value })))

  // With rt.gates.kitForm off the mod registers nothing: an always-listed ask tool would invite agents to use it for any question.
  on('session.start', async ($, e, next) => {
    // Not awaited, so a slow rt never holds the session's start; a gate call waits for it, and the tool is listed from the next prompt.
    setting.reading = readSetting($)
    void setting.reading.then(() => (setting.isOn ? turnOn($) : undefined)).catch(() => undefined)
    await closeOrphans($).catch(() => undefined)
    // A load starts not knowing what herdr shows, so with nothing open this clears a blocker an earlier load left.
    // A write landing while the forms are read is newer than them.
    void readForms($)
      .then(forms => {
        if (blocker.target === undefined) blocker.target = blockerTitle(forms)
        blocker.again = RAISES - 1
        return syncBlocker($)
      })
      .catch(() => undefined)
    return next(e)
  })

  // /clear and a resume end the session, which clears the blocker, and go on in this process with no session.start:
  // what is still open then shows again.
  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    if (e.source === 'clear' || e.source === 'resume') {
      // A write that changes nothing shows what is stored, in order with any other write. The clear that ended the
      // session stops the watch and its repeats, so they are granted once it has run.
      void writeForms($, list => list)
        .then(() => blocker.chain)
        .then(() => {
          blocker.again = RAISES - 1
        })
        .catch(() => undefined)
    }
    return started
  })

  // The process lives on past a /clear: a clear that outlasts the bound still runs.
  on('session.end', async ($, e, next) => {
    const cleared = syncBlocker($, () => null)
    const boundMs = Math.min(QUICK_TIMEOUT_MS, next.budget.remainingMs - END_MARGIN_MS)
    if (boundMs > 0) {
      const stop = new AbortController()
      await Promise.race([cleared, $.clock.sleep(boundMs, { signal: stop.signal }).catch(() => undefined)])
      stop.abort()
    }
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
  on('tool.call', { tool: 'mcp__plugin_mattstack_mattstack__herd_gate_present' }, ($, e, next) => takeGate($, e, next, true)).catch(($, e, next) => next(e))

  // The engine's row draws a call's whole input, which the pane already shows. ctrl+o still has it all.
  on('ui.render', { component: 'ToolUse', props: { tool: ['mcp__gate-form__ask', 'mcp__plugin_mattstack_mattstack__gate_ask', 'mcp__plugin_mattstack_mattstack__gate_open'] } }, ($, e, next) => {
    const { input, isExpanded } = e.props
    const isHandBack = (input as { handBack?: unknown } | null | undefined)?.handBack === true
    if (!setting.isOn || isExpanded || isHandBack || !drawsForm(e.surface)) return next(e)
    return next({ ...e, props: { ...e.props, input: rowInput(input) } })
  })

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
    const rows = Math.max(8, body)
    const focused = e.props.isFocused || (await read($, keysAtom))
    // The Close row and the gap above it take two of the body's rows.
    const height = Math.max(1, form.status === 'open' ? body : body - 2)
    if (form.confirm && form.status === 'open') {
      const answers = (form.questions[0]?.options ?? []).map(option => ({ label: option.label, onPress: () => void settle($, form.id, { status: 'answered', answers: { [PLUGIN_QUESTION]: option.value } }) }))
      // The head is only as tall as it draws, so the answers sit one row under it.
      return (
        <Box flexDirection="column" paddingX={1} gap={1}>
          <Client key={`form-${form.id}`} module="./form.tsx" props={{ form: fitForm(form, FORM_BUDGET), rows, cols: (e.props.bodyColumns ?? 60) - 2, focused, wheel: wheelTotal(PANE) }} />
          {hotkeyChoices(els, { key: `confirm-${form.id}`, choices: answers, focused: e.props.isFocused === true })}
        </Box>
      )
    }
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
