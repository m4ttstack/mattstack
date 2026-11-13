import type { Form, FormOption, FormQuestion } from '../../types'

export const WRITE_IN = '__other__'

export type Phase = 'active' | 'submitted' | 'chat'

export type State = {
  page: number
  cursor: number[]
  picked: string[][]
  text: string[]
  answered: boolean[]
  // The cursor was moved by the person, so where it rests is their choice.
  moved: boolean[]
  phase: Phase
  hover?: string
  pressed?: string
  tabsFrom: number
  chatArmed?: true
}

const isRecommended = (o: FormOption) => /\(recommended\)\s*$/i.test(o.label)
const replaceAt = <T>(list: T[], i: number, value: T): T[] => list.map((old, k) => (k === i ? value : old))
const markAnswered = (s: State, i: number) => replaceAt(s.answered, i, true)

// Every question with options ends in a write-in row.
export function choicesOf(q: FormQuestion): FormOption[] {
  if (q.options.length === 0) return q.options
  return [...q.options, { value: WRITE_IN, label: 'Something else', description: 'Write in your answer' }]
}

export function initial(form: Form): State {
  return {
    page: 0,
    cursor: form.questions.map(q => Math.max(0, q.options.findIndex(isRecommended))),
    picked: form.questions.map(() => []),
    text: form.questions.map(() => ''),
    answered: form.questions.map(() => false),
    moved: form.questions.map(() => false),
    phase: 'active',
    tabsFrom: 0,
  }
}

export const unansweredCount = (s: State) => s.answered.filter(a => !a).length

export function isPicked(q: FormQuestion, s: State, i: number, idx: number): boolean {
  const value = choicesOf(q)[idx]?.value
  if (value === undefined) return false
  return s.picked[i]!.includes(value) || (value === WRITE_IN && q.multi && s.text[i]!.trim() !== '')
}

export function isTyping(form: Form, s: State): boolean {
  const q = form.questions[s.page]
  if (!q) return false
  const choices = choicesOf(q)
  return choices.length === 0 || choices[s.cursor[s.page]!]?.value === WRITE_IN
}

// gate_answer's shape: a value, an array for multi, text for free text, {writeIn} or {value, note} for typed text.
export function answersOf(form: Form, s: State): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  form.questions.forEach((q, i) => {
    if (!s.answered[i]) return
    const typed = s.text[i]!.trim()
    if (choicesOf(q).length === 0) out[q.id] = s.text[i]!
    else if (q.multi) {
      const values = s.picked[i]!.filter(v => v !== WRITE_IN)
      out[q.id] = typed === '' ? values : values.length > 0 ? { value: values, note: typed } : { writeIn: typed }
    } else {
      const value = choicesOf(q)[s.cursor[i]!]?.value
      out[q.id] = value === WRITE_IN ? { writeIn: typed } : value
    }
  })
  return out
}

// Navigation only: arrows, Tab and the tab strip look around without answering anything.
export function goTo(form: Form, s: State, page: number): State {
  return { ...s, page: Math.max(0, Math.min(form.questions.length, page)) }
}

// A single choice draws its cursor as the chosen ●, so Next takes that option as the answer.
// Where a single choice's cursor rests is a choice once it is answered, moved there by the person, or the recommended option;
// a cursor that merely starts on the first option is not.
export function cursorIsChoice(q: FormQuestion, s: State, i: number): boolean {
  const option = choicesOf(q)[s.cursor[i]!]
  if (!option || (option.value === WRITE_IN && s.text[i]!.trim() === '')) return false
  return s.answered[i] || s.moved[i] || isRecommended(option)
}

function takesCursorAsAnswer(form: Form, s: State): boolean {
  const q = form.questions[s.page]
  return q !== undefined && !q.multi && !s.answered[s.page] && cursorIsChoice(q, s, s.page)
}

// The Next (or Review) button: accepts a single choice's cursor, then moves on.
export function advance(form: Form, s: State): State {
  const answered = takesCursorAsAnswer(form, s) ? markAnswered(s, s.page) : s.answered
  return goTo(form, { ...s, answered }, s.page + 1)
}

export function moveCursor(form: Form, s: State, by: number): State {
  const q = form.questions[s.page]
  const count = q ? choicesOf(q).length : 0
  if (count === 0) return s
  return { ...s, cursor: replaceAt(s.cursor, s.page, (s.cursor[s.page]! + by + count) % count), moved: replaceAt(s.moved, s.page, true) }
}

function toggled(s: State, i: number, value: string): State {
  const has = s.picked[i]!.includes(value)
  return { ...s, picked: replaceAt(s.picked, i, has ? s.picked[i]!.filter(p => p !== value) : [...s.picked[i]!, value]), answered: markAnswered(s, i) }
}

export function toggleAtCursor(form: Form, s: State): State {
  const q = form.questions[s.page]
  const value = q && choicesOf(q)[s.cursor[s.page]!]?.value
  return value === undefined ? s : toggled(s, s.page, value)
}

// Enter: answers the page and moves on; on a multi it also ticks the focused choice.
export function confirm(form: Form, s: State): State {
  const i = s.page
  const q = form.questions[i]
  if (!q) return s
  const value = choicesOf(q)[s.cursor[i]!]?.value
  const adds = q.multi && value !== undefined && value !== WRITE_IN && !s.picked[i]!.includes(value)
  return { ...s, page: i + 1, answered: markAnswered(s, i), ...(adds && { picked: replaceAt(s.picked, i, [...s.picked[i]!, value]) }) }
}

// A click: picks a single choice, ticks a multi one, or opens the write-in field. It never changes page; Next does.
export function clickChoice(form: Form, s: State, idx: number): State {
  const i = s.page
  const q = form.questions[i]
  if (!q) return s
  const value = choicesOf(q)[idx]?.value
  const cursor = replaceAt(s.cursor, i, idx)
  if (value === undefined || value === WRITE_IN) return { ...s, cursor }
  if (!q.multi) return { ...s, cursor, answered: markAnswered(s, i) }
  return { ...toggled(s, i, value), cursor }
}

export function typeChar(s: State, ch: string): State {
  return { ...s, text: replaceAt(s.text, s.page, s.text[s.page]! + ch), answered: markAnswered(s, s.page) }
}

export function deleteChar(s: State): State {
  return { ...s, text: replaceAt(s.text, s.page, s.text[s.page]!.slice(0, -1)) }
}
