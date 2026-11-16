import type { Controls, Form, FormOption, FormQuestion } from '../../types'
import { WRITE_IN } from '../form/state'
import { BOARD_INSTRUCTION, GATE_INSTRUCTION } from './reply'

const DEFAULT_TITLE = 'Questions'

type RawOption = string | { value?: unknown; label?: unknown; description?: unknown }
type RawQuestion = { id?: unknown; header?: unknown; label?: unknown; multi?: unknown; writeIn?: unknown; context?: unknown; options?: unknown }

let counter = 0

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

function toOption(raw: RawOption): FormOption {
  if (typeof raw === 'string') return { value: raw, label: raw }
  return {
    value: String(raw.value ?? raw.label ?? ''),
    label: String(raw.label ?? raw.value ?? ''),
    ...(typeof raw.description === 'string' && { description: raw.description }),
  }
}

// A gate is already open by the time the mod reads it, and the daemon accepts a blank option and a value given twice,
// so a gate drops those rather than fail: the first of two equal values records the same answer as the second.
// The ask tool's caller can fix its call, so it is refused instead.
function toOptions(q: RawQuestion & { id: string }, source: Form['source']): FormOption[] | string {
  const raws = (Array.isArray(q.options) ? q.options : []) as RawOption[]
  const options: FormOption[] = []
  const seen = new Set<string>()
  for (const raw of raws) {
    const option = toOption(raw)
    const problem = option.value === '' ? `question ${q.id} has an option with no value.` : seen.has(option.value) ? `question ${q.id} has option ${option.value} twice.` : undefined
    if (problem && source !== 'gate') return problem
    if (problem) continue
    seen.add(option.value)
    options.push(option)
  }
  if (raws.length > 0 && options.length === 0) return `question ${q.id} has no option with a value.`
  return options
}

function toQuestion(q: RawQuestion, seen: Set<string>, source: Form['source']): FormQuestion | string {
  if (typeof q?.id !== 'string' || q.id === '') return 'every question needs a string id.'
  if (seen.has(q.id)) return `question id ${q.id} is used twice.`
  if (typeof q.label !== 'string') return `question ${q.id} needs a label.`
  seen.add(q.id)
  const options = toOptions(q as RawQuestion & { id: string }, source)
  if (typeof options === 'string') return options
  return {
    id: q.id,
    header: isText(q.header) ? q.header : q.id,
    label: q.label,
    multi: q.multi === true,
    writeIn: q.writeIn === true,
    other: source === 'ask' || q.writeIn === true,
    ...(isText(q.context) && { context: q.context }),
    options,
  }
}

// gate_ask's questions to a Form, or the reason they can't be one.
export function toForm(title: unknown, context: unknown, raw: unknown, source: Form['source']): Form | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'questions must be a non-empty array.'
  const seen = new Set<string>()
  const questions: FormQuestion[] = []
  for (const q of raw as RawQuestion[]) {
    const question = toQuestion(q, seen, source)
    if (typeof question === 'string') return question
    questions.push(question)
  }
  counter += 1
  return {
    id: `f${Date.now().toString(36)}${counter}`,
    title: isText(title) ? title : DEFAULT_TITLE,
    ...(isText(context) && { context }),
    questions,
    status: 'open',
    source,
  }
}

export const PLUGIN_QUESTION = 'choice'

// `$.gateForm.ask`'s arguments to a one-pick form, or the reason they can't be one.
export function pluginForm(raw: unknown): Form | string {
  const args = (raw ?? {}) as { title?: unknown; context?: unknown; kind?: unknown; label?: unknown; options?: unknown; timeoutMs?: unknown }
  if (!isText(args.title)) return 'title must be a non-empty string.'
  if (typeof args.timeoutMs !== 'number' || !(args.timeoutMs > 0)) return 'timeoutMs must be a positive number of milliseconds.'
  if (args.kind !== undefined && args.kind !== 'choice' && args.kind !== 'confirm') return "kind must be 'choice' or 'confirm'."
  const confirm = args.kind === 'confirm'
  if (!Array.isArray(args.options) || args.options.length === 0) return 'options must be a non-empty array.'
  if (confirm && (args.options.length < 2 || args.options.length > 3)) return 'a confirm takes 2 or 3 options.'
  // The form keeps this value for its write-in row, so an option carrying it could never be chosen.
  if (args.options.some(option => (option as { value?: unknown } | null)?.value === WRITE_IN)) return `option value ${WRITE_IN} is reserved.`
  // A confirm draws no question line, so its label is only a name for the answer.
  const label = confirm && args.label === undefined ? args.title : args.label
  const question = { id: PLUGIN_QUESTION, header: 'Choice', label, options: args.options }
  const form = toForm(args.title, args.context, [question], 'plugin')
  return typeof form === 'string' || !confirm ? form : { ...form, confirm: true }
}

type Fields = Record<string, unknown>

export type KitRead = { kind: 'kit'; fields: Fields } | { kind: 'spilled' } | { kind: 'other' }

const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v)

// A result too large for the model is saved to a file, and the text the hook reads is then a pointer, not JSON.
export function readKitResult(text: string): KitRead {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'spilled' }
  }
  return isObject(parsed) && parsed.paneAction === 'kit' ? { kind: 'kit', fields: parsed } : { kind: 'other' }
}

// A gate that asks its own `next` question would have a run control checked against that question's options, so it gets none.
function controlsOf(raw: unknown, questions: FormQuestion[]): Controls | undefined {
  if (!isObject(raw) || questions.some(q => q.id === 'next')) return undefined
  const pause = raw.pause === true
  const goBack = Array.isArray(raw.goBack) ? raw.goBack.filter((s): s is string => typeof s === 'string' && s !== '') : []
  return pause || goBack.length > 0 ? { pause, goBack } : undefined
}

function gateFormOf(id: unknown, title: string, context: unknown, questions: unknown, controls: unknown): Form | string {
  if (!isText(id)) return 'the gate result has no id.'
  const form = toForm(title, context, questions, 'gate')
  if (typeof form === 'string') return form
  const allowed = controlsOf(controls, form.questions)
  return { ...form, gateId: id, ...(allowed && { controls: allowed }) }
}

export function gateForm(fields: Fields, title: string): Form | string {
  const kit = isObject(fields.kitForm) ? fields.kitForm : {}
  return gateFormOf(fields.id, title, kit.context, kit.questions, kit.controls)
}

// What the agent reads: every field of the tool's result but the form it no longer has to draw, and what to do now.
export function agentFields(fields: Fields): Fields {
  const { kitForm: _, ...rest } = fields
  return { ...rest, instruction: GATE_INSTRUCTION(String(fields.id)) }
}

// What the agent reads when the form can't draw the gate: the wait branch, so it holds with `rt gate wait`.
export function boardFields(fields: Fields): Fields {
  const { kitForm: _, ...rest } = fields
  return { ...rest, paneAction: 'wait', instruction: BOARD_INSTRUCTION(String(fields.id)) }
}

export type GateRow = {
  id: string
  kind?: unknown
  subject?: unknown
  questions?: unknown
  context?: unknown
  presentation?: unknown
  status?: unknown
  nudge?: unknown
  openedAt?: unknown
  answer?: unknown
  closedReason?: unknown
  meta?: unknown
}

// The rows `rt gate list --json` printed, or undefined when it printed something else.
export function listedGates(stdout: string): GateRow[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  if (!isObject(parsed) || !Array.isArray(parsed.gates)) return undefined
  return (parsed.gates as unknown[]).filter((g): g is GateRow => isObject(g) && isText(g.id))
}

// The absolute paths a spill pointer names, where the full result was saved.
export function spillPaths(text: string): string[] {
  const found = [...text.matchAll(/(?:^|[\s:"'`(])(\/[^\s"'`<>()[\]{},;]+)/g)].map(m => m[1]!.replace(/[.:]+$/, ''))
  return [...new Set(found)].filter(p => p.length > 1 && !p.endsWith('/'))
}

// The tool's result as a saved file holds it: its own JSON, or the content blocks around it.
export function savedResult(fileText: string): Fields | undefined {
  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  const parsed = parse(fileText)
  const blocks = Array.isArray(parsed) ? parsed : isObject(parsed) && Array.isArray(parsed.content) ? parsed.content : undefined
  if (!blocks) return isObject(parsed) ? parsed : undefined
  const inner = parse(blocks.map(b => (isObject(b) && typeof b.text === 'string' ? b.text : '')).join(''))
  return isObject(inner) ? inner : undefined
}

export type GateCall = { kind?: unknown; subject?: unknown; questions?: unknown }

const shapeOf = (questions: unknown) => JSON.stringify((Array.isArray(questions) ? questions : []).map(q => (isObject(q) ? [q.id, q.label] : null)))

// The gate a spilled result opened, when its saved file can't say: an open kit gate of this session with no form yet,
// matching this call's kind, its subject when given, and its questions when given. Equal matches take the newest.
export function spilledGate(stdout: string, session: string, known: string[], call: GateCall): GateRow | undefined {
  const kind = isText(call.kind) ? call.kind.trim() : 'question'
  const gates = listedGates(stdout) ?? []
  const mine = gates.filter(
    g =>
      g.presentation === 'kit' &&
      g.status === 'open' &&
      isObject(g.nudge) &&
      g.nudge.session === session &&
      !known.includes(g.id) &&
      g.kind === kind &&
      (!isText(call.subject) || g.subject === call.subject.trim()) &&
      (!Array.isArray(call.questions) || shapeOf(g.questions) === shapeOf(call.questions)),
  )
  return mine.sort((a, b) => Number(b.openedAt ?? 0) - Number(a.openedAt ?? 0))[0]
}

// A listed gate carries the run controls its kit form opened with in meta.kitControls; a gate without them gets no More actions.
export function formFromRow(row: GateRow): Form | string {
  const controls = isObject(row.meta) ? row.meta.kitControls : undefined
  return gateFormOf(row.id, isText(row.kind) ? row.kind : DEFAULT_TITLE, row.context, row.questions, controls)
}

// What `rt gate answer` exiting 0 means: recorded, unless it lost the race, when its winning row says by whom.
// This pane's own earlier answer (a retried submit) is as good as recorded; output that won't parse is recorded.
export function answerOutcome(stdout: string, session: string): 'recorded' | 'elsewhere' {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return 'recorded'
  }
  if (!isObject(parsed) || parsed.conflict !== true) return 'recorded'
  const answer = isObject(parsed.row) && isObject(parsed.row.answer) ? parsed.row.answer : {}
  return answer.by === 'pane' && answer.session === session ? 'recorded' : 'elsewhere'
}
