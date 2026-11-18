import type { MenuRow, MenuState } from '@mattstack/mod-kit'

import type { Form, FormOption, FormQuestion } from '../../types'

export const WRITE_IN = '__other__'

export type Phase = 'active' | 'submitted' | 'chat'

// `next` is the nav row's forward button: Next, Review or Submit.
export type NavId = 'back' | 'next' | 'more' | 'chat'

export type State = {
  page: number
  cursor: number[]
  picked: string[][]
  text: string[]
  answered: boolean[]
  // A single choice's picked value, apart from the cursor; a multi question keeps its picks in `picked`.
  chosen: (string | undefined)[]
  phase: Phase
  hover?: string
  pressed?: string
  tabsFrom: number
  chatArmed?: true
  menu: MenuState
  // The keyboard is on the nav row rather than the page's answers; the review page has only the nav row.
  onNav?: true
  // Which of the nav row's buttons the keyboard is on.
  navAt: NavId
  // The form's failed-attempt count when this state sent its answer: a higher count means that send failed.
  sent?: number
  // The first scrolled row in view while a page is too tall for the pane.
  pageTop?: number
  // The cursor the scrolled window last moved to show, and the pane's wheel total it last took (view.ts `Fitted`).
  followed?: string
  wheelAt?: number
  // The last option click, so a second one on the same option soon after reads as a double click.
  lastClick?: { page: number; idx: number; at: number }
  // The context box's first row in view while the context is taller than its box.
  ctxTop?: number
  // The run control that was sent, for the closed form to name.
  control?: string
}

const isRecommended = (o: FormOption) => /\(recommended\)\s*$/i.test(o.label)
const replaceAt = <T>(list: T[], i: number, value: T): T[] => list.map((old, k) => (k === i ? value : old))
const markAnswered = (s: State, i: number) => replaceAt(s.answered, i, true)

// The recommended option leads the list, the rest keep their order, and a question that takes typed text ends in a write-in row.
export function choicesOf(q: FormQuestion): FormOption[] {
  const ordered = [...q.options.filter(isRecommended), ...q.options.filter(o => !isRecommended(o))]
  if (ordered.length === 0 || !q.other) return ordered
  return [...ordered, { value: WRITE_IN, label: 'Something else', description: 'Write in your answer' }]
}

// A single choice starts with its recommended option picked; a multi question starts with nothing ticked.
export function initial(form: Form): State {
  const chosen = form.questions.map(q => (isConfirm(form) || q.multi ? undefined : q.options.find(isRecommended)?.value))
  return {
    page: 0,
    cursor: form.questions.map(() => 0),
    picked: form.questions.map(() => []),
    text: form.questions.map(() => ''),
    answered: chosen.map(value => value !== undefined),
    chosen,
    phase: 'active',
    tabsFrom: 0,
    menu: { open: false, selected: 0 },
    navAt: 'next',
  }
}

// The daemon refuses a gate answer that leaves a question out; a one-page form needs its option chosen.
export function canSubmit(form: Form, s: State): boolean {
  if (isSinglePage(form)) return chosenValue(form, s) !== undefined
  return form.source !== 'gate' || unansweredCount(s) === 0
}

// The one-page form's picked option. A sole option counts as picked, since there is nothing else to choose.
export function chosenValue(form: Form, s: State): string | undefined {
  const q = form.questions[0]
  if (!q) return undefined
  return s.chosen[0] ?? (choicesOf(q).length === 1 ? choicesOf(q)[0]!.value : undefined)
}

const PAUSE = 'pause'
const GO_BACK = 'go-back:'

// A plugin form's caller waits on a pick, not on a talk with the agent.
export const canChat = (form: Form) => form.source !== 'plugin'

// A plugin form's one question is its only page, with Submit under the options in place of a review page.
export const isSinglePage = (form: Form) => form.source === 'plugin'

export const isConfirm = (form: Form) => form.confirm === true

export const isReview = (form: Form, s: State) => !isSinglePage(form) && s.page === form.questions.length
export const isOnNav = (form: Form, s: State) => s.onNav === true || isReview(form, s)

// The nav row's buttons the keyboard can rest on: a disabled Back is skipped, while a disabled Submit stays, as Enter on it does nothing.
// The review page has no Back: ← pages back there, as on every page.
export function navIds(form: Form, s: State): NavId[] {
  const ids: NavId[] = s.page > 0 && !isReview(form, s) ? ['back', 'next'] : ['next']
  if (isReview(form, s) && menuRows(form).length > 0) ids.push('more')
  if (canChat(form)) ids.push('chat')
  return ids
}

// The nav row's button the keyboard is on, or `next` when its own has gone.
export function navAtOf(form: Form, s: State): NavId {
  return navIds(form, s).includes(s.navAt) ? s.navAt : 'next'
}

export function menuRows(form: Form): MenuRow[] {
  const controls = form.controls
  if (!controls) return []
  const rows: MenuRow[] = controls.pause ? [{ id: PAUSE, label: 'Pause run' }] : []
  if (controls.goBack.length > 0) rows.push({ id: 'go-back', label: 'Go back to stage', isHeading: true }, ...controls.goBack.map(stage => ({ id: `${GO_BACK}${stage}`, label: stage })))
  return rows
}

// A run control answers the run with the reserved keys only.
export function controlAnswers(id: string): { answers: Record<string, string>; label: string } | undefined {
  if (id === PAUSE) return { answers: { next: 'hold' }, label: 'Asked to pause the run.' }
  if (!id.startsWith(GO_BACK)) return undefined
  const to = id.slice(GO_BACK.length)
  return { answers: { next: 'go-back', to }, label: `Asked to go back to stage ${to}.` }
}

// After an answer that was not recorded, the form is answerable again with every pick kept.
export function afterAttempt(form: Form, s: State): State {
  if (s.phase !== 'submitted' || form.status !== 'open' || (form.attempt ?? 0) <= (s.sent ?? 0)) return s
  return { ...s, phase: 'active', sent: form.attempt, control: undefined }
}

export const unansweredCount = (s: State) => s.answered.filter(a => !a).length

export function isPicked(q: FormQuestion, s: State, i: number, idx: number): boolean {
  const value = choicesOf(q)[idx]?.value
  if (value === undefined) return false
  if (!q.multi) return s.chosen[i] === value
  return s.picked[i]!.includes(value) || (value === WRITE_IN && s.text[i]!.trim() !== '')
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
      const value = s.chosen[i]
      out[q.id] = value === WRITE_IN ? { writeIn: typed } : value
    }
  })
  return out
}

// Navigation only: arrows, Tab and the tab strip look around without answering anything.
export function goTo(form: Form, s: State, page: number): State {
  const last = isSinglePage(form) ? 0 : form.questions.length
  return { ...s, page: Math.max(0, Math.min(last, page)) }
}

// Next (or Review) only moves on: a single choice was picked by space, Enter, a click or its recommended default.
export function advance(form: Form, s: State): State {
  return goTo(form, s, s.page + 1)
}

export function moveCursor(form: Form, s: State, by: number): State {
  const q = form.questions[s.page]
  const count = q ? choicesOf(q).length : 0
  if (count === 0) return s
  return { ...s, cursor: replaceAt(s.cursor, s.page, (s.cursor[s.page]! + by + count) % count) }
}

function toggled(s: State, i: number, value: string): State {
  const has = s.picked[i]!.includes(value)
  return { ...s, picked: replaceAt(s.picked, i, has ? s.picked[i]!.filter(p => p !== value) : [...s.picked[i]!, value]), answered: markAnswered(s, i) }
}

// A single choice's pick. A write-in with nothing typed is not an answer yet.
function chose(s: State, i: number, value: string): State {
  if (value === WRITE_IN && s.text[i]!.trim() === '') return s
  return { ...s, chosen: replaceAt(s.chosen, i, value), answered: markAnswered(s, i) }
}

// Space: picks a single choice at the cursor, or ticks a multi one.
export function toggleAtCursor(form: Form, s: State): State {
  const q = form.questions[s.page]
  const value = q && choicesOf(q)[s.cursor[s.page]!]?.value
  if (value === undefined) return s
  return q?.multi ? toggled(s, s.page, value) : chose(s, s.page, value)
}

// Enter: picks a single choice at the cursor and moves on; on a multi it ticks the focused choice and moves on.
// A single choice that stays unanswered (an empty write-in) keeps the page.
export function confirm(form: Form, s: State): State {
  const i = s.page
  const q = form.questions[i]
  if (!q) return s
  const value = choicesOf(q)[s.cursor[i]!]?.value
  if (choicesOf(q).length > 0 && !q.multi) {
    const picked = value === undefined ? s : chose(s, i, value)
    return picked.answered[i] ? { ...picked, page: i + 1 } : picked
  }
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
  if (!q.multi) return chose({ ...s, cursor }, i, value)
  return { ...toggled(s, i, value), cursor }
}

// Typing into a single choice's write-in picks it.
export function typeChar(form: Form, s: State, ch: string): State {
  const typed = { ...s, text: replaceAt(s.text, s.page, s.text[s.page]! + ch), answered: markAnswered(s, s.page) }
  const q = form.questions[s.page]
  return q && !q.multi && choicesOf(q).length > 0 ? { ...typed, chosen: replaceAt(s.chosen, s.page, WRITE_IN) } : typed
}

export function deleteChar(s: State): State {
  return { ...s, text: replaceAt(s.text, s.page, s.text[s.page]!.slice(0, -1)) }
}
