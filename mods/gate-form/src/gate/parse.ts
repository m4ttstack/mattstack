import type { Form, FormOption, FormQuestion } from '../../types'

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

function toQuestion(q: RawQuestion, seen: Set<string>): FormQuestion | string {
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
    ...(isText(q.context) && { context: q.context }),
    options,
  }
}

// gate_ask's questions to a Form, or the reason they can't be one.
export function toForm(title: unknown, context: unknown, raw: unknown, replyTo: Form['replyTo']): Form | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'questions must be a non-empty array.'
  const seen = new Set<string>()
  const questions: FormQuestion[] = []
  for (const q of raw as RawQuestion[]) {
    const question = toQuestion(q, seen)
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
    replyTo,
  }
}
