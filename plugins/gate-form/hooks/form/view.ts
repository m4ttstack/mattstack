import type { Form, FormQuestion } from '../../types'
import { hang, sp, withAction, type Line } from '../kit/text'
import { ACCENT, DIM, DONE, GRAY, ICON, SYMBOL, WARN, rail } from '../kit/theme'
import { brandBar, buttonRow, revealTab, selectList, tabStrip, textCursor, type Button, type Tab } from '../kit/widgets'
import type { Action } from './input'
import { choicesOf, cursorIsChoice, isPicked, unansweredCount, WRITE_IN, type State } from './state'

export type View = { width: number; focused: boolean }

type L = Line<Action>


// A gate-ctx@1 JSON context reads as `key: value` lines.
function contextText(context: string): string {
  try {
    const parsed: unknown = JSON.parse(context)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join('\n')
    }
  } catch {
    // prose context
  }
  return context
}

function answerSummary(q: FormQuestion, s: State, i: number): string {
  const choices = choicesOf(q)
  if (choices.length === 0) return s.text[i] === '' ? '(blank)' : s.text[i]
  const label = (v: string) => (v === WRITE_IN ? `“${s.text[i]}”` : (choices.find(o => o.value === v)?.label ?? v))
  if (!q.multi) return label(choices[s.cursor[i]]?.value ?? '')
  const values = [...s.picked[i], ...(s.text[i].trim() !== '' ? [WRITE_IN] : [])]
  return values.length === 0 ? 'none' : values.map(label).join(', ')
}

const kindIcon = (q: FormQuestion) => (choicesOf(q).length === 0 ? ICON.text : q.multi ? ICON.multi : ICON.single)

function questionPage(q: FormQuestion, s: State, i: number, view: View): L[] {
  const bar = rail<Action>(ACCENT)
  const lines: L[] = hang([sp(kindIcon(q), ACCENT), sp('  ')], bar, q.label, view.width, { bold: true })
  if (q.multi) lines.push([...bar, sp('pick any number', DIM)])
  if (q.context) lines.push(...hang(bar, bar, q.context, view.width, DIM))
  lines.push([sp(SYMBOL.bar, ACCENT)])
  const choices = choicesOf(q)
  if (choices.length === 0) {
    lines.push([...bar, ...textCursor(s.text[i], 'Type your answer', view.focused)])
    return lines
  }
  lines.push(
    ...selectList<Action>({
      choices: choices.map(c => ({ label: c.label, description: c.description, isWriteIn: c.value === WRITE_IN })),
      cursor: s.cursor[i],
      multi: q.multi,
      isPicked: idx => isPicked(q, s, i, idx),
      cursorIsChoice: !q.multi && cursorIsChoice(q, s, i),
      writeIn: s.text[i],
      width: view.width,
      focused: view.focused,
      actionFor: idx => ({ type: 'option', idx }),
    }),
  )
  return lines
}

// Each entry is clickable while the form is open, so the review list is also how you go back to change or finish an answer.
function reviewList(form: Form, s: State, view: View): L[] {
  const bar = rail<Action>(GRAY)
  const isOpen = s.phase === 'active'
  return form.questions.flatMap((q, i) => {
    const isDone = s.answered[i]
    const symbol = isDone ? sp(ICON.done, DONE) : sp(ICON.missing, WARN)
    const entry = [
      ...hang([symbol, sp('  ')], bar, q.label, view.width, isOpen ? { isLabel: true } : {}),
      ...(isDone ? hang(bar, bar, answerSummary(q, s, i), view.width, DIM) : [[...bar, sp('not answered', WARN)]]),
    ]
    return [[sp(SYMBOL.bar, GRAY)], ...(isOpen ? withAction<Action>(entry, { type: 'page', page: i }) : entry)]
  })
}

function reviewPage(form: Form, s: State, view: View): L[] {
  const missing = unansweredCount(s)
  const bar = rail<Action>(ACCENT)
  const lines: L[] = [...reviewList(form, s, view), [sp(SYMBOL.bar, GRAY)], [sp(ICON.review, ACCENT), sp('  Submit your answers?', { bold: true })]]
  if (missing > 0) lines.push([...bar, sp(`${missing} not answered; left out if you submit now`, WARN)])
  return lines
}

function closedPage(form: Form, s: State, view: View): L[] {
  const end: L = s.phase === 'submitted' ? [sp(SYMBOL.end, GRAY), sp('  Answers sent.')] : [sp(SYMBOL.end, GRAY), sp('  Set aside to chat about it.', WARN)]
  return [...reviewList(form, s, view), [sp(SYMBOL.bar, GRAY)], end]
}

function tabList(form: Form, s: State): Tab<Action>[] {
  const n = form.questions.length
  const list: Tab<Action>[] = form.questions.map((q, i) => ({
    label: q.header,
    mark: s.answered[i] ? ICON.done : ICON.todo,
    isDone: s.answered[i],
    action: { type: 'page', page: i },
  }))
  list.push({ label: 'Submit', isDone: false, action: { type: 'page', page: n } })
  return list
}

function tabs(form: Form, s: State, view: View): L {
  return tabStrip({ tabs: tabList(form, s), current: s.page, width: view.width, from: s.tabsFrom, scrollTo: from => ({ type: 'scroll-tabs', from }) })
}

// After a page change: the tab strip's start that keeps it still unless the new page is out of view.
export function withTabInView(form: Form, s: State, width: number): State {
  return { ...s, tabsFrom: revealTab(tabList(form, s), s.page, width, s.tabsFrom) }
}

function navRow(form: Form, s: State, view: View): L {
  const n = form.questions.length
  const page = s.page
  const left: Button<Action>[] = []
  left.push({ label: `${ICON.back} Back`, action: { type: 'page', page: page - 1 }, tone: 'secondary', disabled: page === 0 })
  if (page < n - 1) left.push({ label: `Next ${ICON.next}`, action: { type: 'advance' }, tone: 'secondary' })
  if (page === n - 1) left.push({ label: `Review ${ICON.next}`, action: { type: 'advance' }, tone: 'secondary' })
  if (page === n) left.push({ label: unansweredCount(s) === 0 ? 'Submit' : 'Submit anyway', action: { type: 'send' }, tone: 'primary' })
  const chat: Button<Action> = s.chatArmed
    ? { label: `${ICON.chat} Press again to chat`, action: { type: 'chat' }, tone: 'caution' }
    : { label: `${ICON.chat} Chat about this`, action: { type: 'chat' }, tone: 'neutral' }
  return buttonRow(left, chat, view.width)
}

// The review page has none: its Back and Submit buttons say it.
function hint(form: Form, s: State, view: View): string | undefined {
  if (!view.focused) return 'click the form to answer with the keyboard'
  const q = form.questions[s.page]
  if (!q) return undefined
  return choicesOf(q).length === 0 ? '←→ pages' : '←→ pages  ↑↓ move'
}

type Drawn = { head: L[]; page: L[]; foot: L[] }

function draw(form: Form, s: State, view: View, withContext: boolean): Drawn {
  const head: L[] = [brandBar('mattstack decision gate', view.width), [sp(' ')], [sp(SYMBOL.start, GRAY), sp('  '), sp(form.title, { bold: true })]]
  if (s.phase !== 'active') return { head, page: closedPage(form, s, view), foot: [] }
  if (withContext && form.context) {
    const first = [sp<Action>(SYMBOL.bar, GRAY), sp('  '), sp(ICON.info, ACCENT), sp(' ')]
    const rest = [sp<Action>(SYMBOL.bar, GRAY), sp('    ')]
    head.push([sp(SYMBOL.bar, GRAY)], ...hang(first, rest, contextText(form.context), view.width))
  }
  const divider: L = [sp(`├${'─'.repeat(Math.max(4, view.width - 2))}`, GRAY)]
  head.push([sp(SYMBOL.bar, GRAY)], [sp(SYMBOL.bar, GRAY)], divider, [sp(SYMBOL.bar, GRAY)], tabs(form, s, view), [sp(SYMBOL.bar, GRAY)])

  const q = form.questions[s.page]
  const accentBar = rail<Action>(ACCENT)
  const page = q ? questionPage(q, s, s.page, view) : reviewPage(form, s, view)
  const keys = hint(form, s, view)
  const hintLines: L[] = keys === undefined ? [] : [[sp(SYMBOL.bar, ACCENT)], ...hang(accentBar, accentBar, keys, view.width, DIM)]
  const foot: L[] = [...hintLines, [sp(SYMBOL.end, ACCENT)], [sp(' ')], navRow(form, s, view)]
  return { head, page, foot }
}

// The tallest any question page gets, over every cursor position (the focused choice wraps its label and description).
function tallestQuestion(form: Form, s: State, view: View): number {
  let tallest = 0
  form.questions.forEach((q, i) => {
    const positions = Math.max(1, choicesOf(q).length)
    for (let c = 0; c < positions; c += 1) {
      const at = { ...s, cursor: s.cursor.map((old, k) => (k === i ? c : old)) }
      tallest = Math.max(tallest, questionPage(q, at, i, view).length)
    }
  })
  return tallest
}

// What fits in `rows`: the head, then the end of the body. When the body overflows, the form context gives up its room first.
// Every page is padded to the tallest question's height, room allowing, so the buttons keep their row as you page.
export function visibleLines(form: Form, s: State, view: View, rows: number): L[] {
  const roomUnder = (head: L[]) => Math.max(6, rows - head.length)
  const full = draw(form, s, view, true)
  const { head, page, foot } = full.page.length + full.foot.length > roomUnder(full.head) ? draw(form, s, view, false) : full
  const room = roomUnder(head)
  const height = s.phase === 'active' ? Math.min(tallestQuestion(form, s, view), room - foot.length) : 0
  const padding: L[] = Array.from({ length: Math.max(0, height - page.length) }, () => [sp(SYMBOL.bar, ACCENT)])
  const body = [...page, ...padding, ...foot]
  return [...head, ...body.slice(Math.max(0, body.length - room))]
}
