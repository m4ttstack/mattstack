import type { Controls, Form, FormOption, FormQuestion } from '../../types'
import { GATE_INSTRUCTION } from './reply'

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

function toOptions(q: RawQuestion & { id: string }): FormOption[] | string {
  const options: FormOption[] = []
  const seen = new Set<string>()
  for (const raw of (Array.isArray(q.options) ? q.options : []) as RawOption[]) {
    const option = toOption(raw)
    if (option.value === '') return `question ${q.id} has an option with no value.`
    if (seen.has(option.value)) return `question ${q.id} has option ${option.value} twice.`
    seen.add(option.value)
    options.push(option)
  }
  return options
}

function toQuestion(q: RawQuestion, seen: Set<string>, source: Form['source']): FormQuestion | string {
  if (typeof q?.id !== 'string' || q.id === '') return 'every question needs a string id.'
  if (seen.has(q.id)) return `question id ${q.id} is used twice.`
  if (typeof q.label !== 'string') return `question ${q.id} needs a label.`
  seen.add(q.id)
  const options = toOptions(q as RawQuestion & { id: string })
  if (typeof options === 'string') return options
  return {
    id: q.id,
    header: isText(q.header) ? q.header : q.id,
    label: q.label,
    multi: q.multi === true,
    writeIn: q.writeIn === true,
    other: source !== 'gate' || q.writeIn === true,
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

export type GateRow = { id: string; kind?: unknown; questions?: unknown; context?: unknown; presentation?: unknown; status?: unknown; nudge?: unknown; openedAt?: unknown }

// The gate a spilled result opened: this session's newest open kit gate that has no form yet.
export function spilledGate(stdout: string, session: string, known: string[]): GateRow | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  const gates = isObject(parsed) && Array.isArray(parsed.gates) ? (parsed.gates as GateRow[]) : []
  const mine = gates.filter(
    g => isObject(g) && isText(g.id) && g.presentation === 'kit' && g.status === 'open' && isObject(g.nudge) && g.nudge.session === session && !known.includes(g.id),
  )
  return mine.sort((a, b) => Number(b.openedAt ?? 0) - Number(a.openedAt ?? 0))[0]
}

// A listed gate carries no run controls, so its form has no More actions.
export function formFromRow(row: GateRow): Form | string {
  return gateFormOf(row.id, isText(row.kind) ? row.kind : DEFAULT_TITLE, row.context, row.questions, undefined)
}
