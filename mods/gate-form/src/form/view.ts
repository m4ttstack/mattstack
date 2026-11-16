import { ACCENT, DIM, DONE, GRAY, ICON, MORE_ACTIONS, SYMBOL, WARN, brandBar, buttonRow, clipLine, fitToRows, gridLook, hang, maxScroll, menu, revealOffset, scrollBar, rail, reviewList as reviewItems, revealTab, selectList, sp, tabStrip, textCursor, widthOf, type Button, type Drawn, type Line, type Tab } from '@mattstack/mod-kit'

import type { Form, FormQuestion } from '../../types'
import type { Action } from './input'
import { canChat, canSubmit, choicesOf, cursorIsChoice, isOnNav, isPicked, menuRows, navAtOf, unansweredCount, WRITE_IN, type NavId, type State } from './state'

// `pressing`: a key's activation is showing, on whatever the keys are on (a choice, a nav button, a More actions row).
export type View = { width: number; focused: boolean; pressing?: boolean }

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
  if (choices.length === 0) return s.text[i]! === '' ? '(blank)' : s.text[i]!
  const label = (v: string) => (v === WRITE_IN ? `“${s.text[i]!}”` : (choices.find(o => o.value === v)?.label ?? v))
  if (!q.multi) return label(choices[s.cursor[i]!]?.value ?? '')
  const values = [...s.picked[i]!, ...(s.text[i]!.trim() !== '' ? [WRITE_IN] : [])]
  return values.length === 0 ? 'none' : values.map(label).join(', ')
}

// An answer another surface recorded, in gate_answer's shape, read against this form's options.
function wonSummary(q: FormQuestion, raw: unknown): string {
  const label = (v: unknown) => q.options.find(o => o.value === v)?.label ?? String(v)
  const labels = (v: unknown) => (Array.isArray(v) ? (v.length === 0 ? 'none' : v.map(label).join(', ')) : label(v))
  if (raw === undefined || raw === null) return 'skipped'
  if (typeof raw === 'string') return q.options.length > 0 ? label(raw) : raw === '' ? '(blank)' : raw
  if (Array.isArray(raw)) return labels(raw)
  if (typeof raw !== 'object') return String(raw)
  const typed = raw as { writeIn?: unknown; value?: unknown; note?: unknown }
  if (typeof typed.writeIn === 'string') return `“${typed.writeIn}”`
  const picked = typed.value === undefined ? '' : labels(typed.value)
  if (typeof typed.note !== 'string') return picked || 'skipped'
  return picked ? `${picked}, “${typed.note}”` : `“${typed.note}”`
}

const kindIcon = (q: FormQuestion) => (choicesOf(q).length === 0 ? ICON.text : q.multi ? ICON.multi : ICON.single)

function questionPage(q: FormQuestion, s: State, i: number, base: View): L[] {
  // On the nav row the keys are there, so the answer shows no caret.
  const view = { ...base, focused: base.focused && !s.onNav, pressing: base.pressing && !s.onNav }
  const bar = rail<Action>(ACCENT)
  const lines: L[] = hang([sp(kindIcon(q), ACCENT), sp('  ')], bar, q.label, view.width, { bold: true })
  if (q.multi) lines.push([...bar, sp('pick any number', DIM)])
  if (q.context) lines.push(...hang(bar, bar, q.context, view.width, DIM))
  lines.push([sp(SYMBOL.bar, ACCENT)])
  const choices = choicesOf(q)
  if (choices.length === 0) {
    lines.push([...bar, ...textCursor(s.text[i]!, 'Type your answer', view.focused)])
    return lines
  }
  lines.push(
    ...selectList<Action>({
      choices: choices.map(c => ({ label: c.label, description: c.description, isWriteIn: c.value === WRITE_IN })),
      cursor: s.cursor[i]!,
      multi: q.multi,
      isPicked: idx => isPicked(q, s, i, idx),
      cursorIsChoice: !q.multi && cursorIsChoice(q, s, i),
      writeIn: s.text[i]!,
      width: view.width,
      focused: view.focused,
      ...(view.pressing && { pressing: true }),
      // The page scrolls instead, so every choice is drawn.
      maxShown: choices.length,
      actionFor: idx => ({ type: 'option', idx }),
    }),
  )
  return lines
}

// Each entry is clickable while the form is open, so the review list is also how you go back to change or finish an answer.
function reviewList(form: Form, s: State, view: View): L[] {
  const isOpen = s.phase === 'active' && form.status === 'open'
  const won = form.status === 'open' ? undefined : form.won
  return reviewItems<Action>(
    form.questions.map((q, i) => ({
      label: q.label,
      summary: won ? wonSummary(q, won[q.id]) : s.answered[i] ? answerSummary(q, s, i) : undefined,
      ...(isOpen && { action: { type: 'page', page: i } as const }),
    })),
    view.width,
  )
}

function reviewPage(form: Form, s: State, view: View): L[] {
  const missing = unansweredCount(s)
  const bar = rail<Action>(ACCENT)
  const lines: L[] = [...reviewList(form, s, view), [sp(SYMBOL.bar, GRAY)], [sp(ICON.review, DONE), sp('  Submit your answers?', { bold: true })]]
  const warning = form.source === 'gate' ? `${missing} not answered. Answer every question to submit.` : `${missing} not answered; left out if you submit now`
  if (missing > 0) lines.push(...hang(bar, bar, warning, view.width, WARN))
  return lines
}

function ending(form: Form, s: State): { text: string; isWarn: boolean } {
  if (form.note) return { text: form.note, isWarn: false }
  if (s.phase === 'chat') return { text: 'Set aside to chat about it.', isWarn: true }
  if (form.source !== 'gate') return { text: 'Answers sent.', isWarn: false }
  if (form.status === 'open') return { text: 'Recording your answer…', isWarn: false }
  return { text: s.control ?? 'Answer recorded.', isWarn: false }
}

function closedPage(form: Form, s: State, view: View): L[] {
  const end = ending(form, s)
  const rest = [sp<Action>(' '), sp('  ')]
  return [...reviewList(form, s, view), [sp(SYMBOL.bar, GRAY)], ...hang([sp(SYMBOL.end, GRAY), sp('  ')], rest, end.text, view.width, end.isWarn ? WARN : {})]
}

function tabList(form: Form, s: State): Tab<Action>[] {
  const n = form.questions.length
  const list: Tab<Action>[] = form.questions.map((q, i) => ({
    label: q.header,
    mark: s.answered[i] ? ICON.done : ICON.todo,
    isDone: s.answered[i] === true,
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

const MORE: Action = { type: 'menu', hit: { type: 'toggle' } }

// Where each nav button's span sits in buttonRow's line: the indent, then each left button and its gap, the right button last.
function spanAt(id: NavId, line: L): number {
  const left: Record<Exclude<NavId, 'chat'>, number> = { back: 0, next: 1, more: 2 }
  return id === 'chat' ? line.length - 1 : 1 + 2 * left[id]
}

// The nav row, and under it the More actions rows while that menu is open (the review page only).
function navRows(form: Form, s: State, view: View): L[] {
  const n = form.questions.length
  const page = s.page
  const back: Button<Action> = { label: `${ICON.back} Back`, action: { type: 'page', page: page - 1 }, tone: 'secondary', disabled: page === 0 }
  const forward = (label: string): Button<Action> => ({ label, action: { type: 'advance' }, tone: 'secondary' })
  const submit: Button<Action> = { label: unansweredCount(s) === 0 || form.source === 'gate' ? 'Submit' : 'Submit anyway', action: { type: 'send' }, tone: 'brand', disabled: !canSubmit(form, s) }
  const next = page < n - 1 ? forward(`Next ${ICON.next}`) : page === n - 1 ? forward(`Review ${ICON.next}`) : submit
  const aside: Button<Action> | undefined = !canChat(form)
    ? undefined
    : s.chatArmed
    ? { label: `${ICON.chat} Press again to chat`, action: { type: 'chat' }, tone: 'caution' }
    : { label: `${ICON.chat} Chat about this`, action: { type: 'chat' }, tone: 'neutral' }
  const rows = page === n ? menuRows(form) : []
  const more: Button<Action> = { label: MORE_ACTIONS, action: MORE, tone: 'quiet' }
  const line = buttonRow(rows.length === 0 ? [back, next] : [back, next, more], aside, view.width)
  const marked = (row: L): L => {
    if (!view.focused || !isOnNav(form, s)) return row
    const at = spanAt(navAtOf(form, s), row)
    return [...row.slice(0, at), ...gridLook(row[at]!, { marked: true, pressing: view.pressing && !s.menu.open }), ...row.slice(at + 1)]
  }
  if (rows.length === 0) return [marked(line)]

  const at = line.findIndex(span => span.action === MORE)
  const indent = widthOf(line.slice(0, at))
  const hung = menu<Action>({ ...s.menu, label: MORE_ACTIONS, rows, width: view.width, indent, pressing: view.pressing === true, actionFor: hit => ({ type: 'menu', hit }) })
  return [marked(line), ...hung.slice(1)]
}

function errorLines(form: Form, view: View): L[] {
  if (form.status !== 'open' || !form.error) return []
  const lead = [sp<Action>(SYMBOL.warn, WARN), sp('  ')]
  return [[sp(' ')], ...hang(lead, [sp<Action>('   ')], form.error, view.width, WARN)]
}

// The same with or without focus: focus changes only how the selection is drawn, never what the form says.
function hint(form: Form, s: State): string | undefined {
  const q = form.questions[s.page]
  if (!q) return '←→ buttons  enter presses'
  if (s.onNav) return '←→ buttons  ↑ answers  enter presses'
  return choicesOf(q).length === 0 ? '←→ pages  ↓ buttons' : '←→ pages  ↑↓ move'
}

// The context is always drawn, wrapped in full: a page too tall for the pane scrolls to it rather than dropping it.
function draw(form: Form, s: State, view: View): Drawn<Action> {
  const head: L[] = [brandBar<Action>(form.source === 'plugin' ? 'mattstack' : 'mattstack decision gate', view.width, { type: 'hide' }), [sp(' ')], [sp(SYMBOL.start, GRAY), sp('  '), sp(form.title, { bold: true })]]
  if (s.phase !== 'active' || form.status !== 'open') return { head, page: closedPage(form, s, view), foot: [] }
  if (form.context) {
    const first = [sp<Action>(SYMBOL.bar, GRAY), sp('  '), sp(ICON.info, ACCENT), sp(' ')]
    const rest = [sp<Action>(SYMBOL.bar, GRAY), sp('    ')]
    head.push([sp(SYMBOL.bar, GRAY)], ...hang(first, rest, contextText(form.context), view.width))
  }
  const divider: L = [sp(`├${'─'.repeat(Math.max(4, view.width - 2))}`, GRAY)]
  head.push([sp(SYMBOL.bar, GRAY)], [sp(SYMBOL.bar, GRAY)], divider, [sp(SYMBOL.bar, GRAY)], tabs(form, s, view), [sp(SYMBOL.bar, GRAY)])

  const q = form.questions[s.page]
  const accentBar = rail<Action>(ACCENT)
  const page = q ? questionPage(q, s, s.page, view) : reviewPage(form, s, view)
  const keys = hint(form, s)
  const hintLines: L[] = keys === undefined ? [] : [[sp(SYMBOL.bar, ACCENT)], ...hang(accentBar, accentBar, keys, view.width, DIM)]
  const foot: L[] = [...hintLines, [sp(SYMBOL.end, ACCENT)], ...errorLines(form, view), [sp(' ')], ...navRows(form, s, view)]
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

const BAR_CELLS = 3
// The brand bar and the blank row under it stay on top while the rest scrolls, as in human-todos.
const FIXED_TOP = 2

// `followed` names the cursor the window last moved to show, and `wheelAt` the wheel total it last took;
// the Client keeps both, so a wheel turn can leave the cursor out of view until the cursor moves again.
export type Fitted = { lines: L[]; top: number; followed?: string; wheelAt?: number }

// Every page is padded to the tallest question's height, room allowing, so the buttons keep their row as you page.
// A page too tall for the pane scrolls between the brand bar and the nav rows instead, so nothing is cut: the window
// follows the cursor's choice when it moves, the wheel (`wheel`, the pane's running total) moves it too, and a scroll
// bar runs down its right edge.
export function fittedLines(form: Form, s: State, view: View, rows: number, wheel?: number): Fitted {
  const full = draw(form, s, view)
  const room = rows - FIXED_TOP - full.foot.length
  if (full.head.length - FIXED_TOP + full.page.length <= room) {
    const pad = s.phase === 'active' && form.status === 'open' ? { height: tallestQuestion(form, s, view), filler: [sp(SYMBOL.bar, ACCENT)] as L } : undefined
    return { lines: fitToRows(full, rows, () => full, pad), top: 0, ...(wheel !== undefined && { wheelAt: wheel }) }
  }
  const inner = { ...view, width: Math.max(20, view.width - BAR_CELLS) }
  const narrow = draw(form, s, inner)
  const region = [...narrow.head.slice(FIXED_TOP), ...narrow.page]
  const windowRows = Math.max(1, rows - FIXED_TOP - narrow.foot.length)
  const turned = wheel === undefined || s.wheelAt === undefined ? 0 : wheel - s.wheelAt
  const most = maxScroll(region.length, windowRows)
  const wheeled = Math.min(Math.max(0, (s.pageTop ?? 0) + turned), most)
  const cursor = `${s.page}:${s.onNav ? 'nav' : (s.cursor[s.page] ?? '')}`
  const top = cursor === s.followed ? wheeled : followCursor(region, s, windowRows, wheeled)
  const bar = scrollBar<Action>(windowRows, region.length, top)
  // A choice's click is on the line itself (`withAction`), so the drawn line keeps it.
  const shown = region.slice(top, top + windowRows).map((line, n): L => Object.assign([...clipLine(line, inner.width), ...(bar[n] ?? [])], line.action === undefined ? {} : { action: line.action }))
  return { lines: [...full.head.slice(0, FIXED_TOP), ...shown, ...narrow.foot], top, followed: cursor, ...(wheel !== undefined && { wheelAt: wheel }) }
}

// The window over `region` that shows the cursor's choice whole, moving as little as it can from `from`.
function followCursor(region: L[], s: State, windowRows: number, from: number): number {
  const at = s.cursor[s.page]
  const isCursor = (line: L) => line.action?.type === 'option' && line.action.idx === at
  const first = s.onNav || at === undefined ? -1 : region.findIndex(isCursor)
  let last = first
  while (first >= 0 && last + 1 < region.length && isCursor(region[last + 1]!)) last += 1
  if (first < 0) return from
  return revealOffset({ top: from, total: region.length, windowRows, stops: [{ key: 'cursor', ids: ['choice'], main: 0, lines: [first], first, last }] }, 0)
}

export function visibleLines(form: Form, s: State, view: View, rows: number): L[] {
  return fittedLines(form, s, view, rows).lines
}
