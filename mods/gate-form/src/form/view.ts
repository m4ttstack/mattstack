import { ACCENT, DIM, DONE, GRAY, ICON, MORE_ACTIONS, SYMBOL, WARN, brandBar, buttonRow, clipLine, fitToRows, gridLook, hang, maxScroll, menu, revealOffset, scrollBar, rail, reviewList as reviewItems, selectList, sp, textCursor, widthOf, type Button, type Drawn, type Line } from '@mattstack/mod-kit'

import type { Form, FormQuestion } from '../../types'
import type { Action } from './input'
import { canChat, canSubmit, choicesOf, isConfirm, isOnNav, isPicked, isSinglePage, menuRows, navAtOf, navIds, unansweredCount, WRITE_IN, type NavId, type State } from './state'

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

// The context as light markdown: `#` headings and short lines ending in a colon read as bold labels, `-` and `*`
// items as bullets with a hanging indent, and runs of blank lines collapse to one.
export function contextBody(context: string, width: number): L[] {
  const out: L[] = []
  for (const raw of contextText(context).split('\n')) {
    const t = raw.trimEnd()
    const bullet = /^\s*[-*] +/.exec(t)
    if (t.trim() === '') {
      if (out.length > 0 && out[out.length - 1]!.length > 0) out.push([])
    } else if (bullet) out.push(...hang([sp('  • ', DIM)], [sp('    ')], t.slice(bullet[0].length), width))
    else if (/^#{1,6} /.test(t)) out.push(...hang<Action>([], [], t.replace(/^#+ +/, ''), width, { bold: true }))
    else if (t.endsWith(':') && t.length <= 60) out.push(...hang<Action>([], [], t.slice(0, -1), width, { bold: true }))
    else out.push(...hang<Action>([], [], t, width))
  }
  while (out.length > 0 && out[out.length - 1]!.length === 0) out.pop()
  return out
}

// The box's rail, its padding cell and the scroll bar's three cells.
const BOX_CELLS = 6
const CTX_BG = '#202020'
// The fewest context rows the box shrinks to before the whole page scrolls instead.
const MIN_CTX = 3

export type CtxView = { cap: number; top: number }

const tint = (line: L, width: number): L => {
  const filled = line.map(span => (span.bg ? span : { ...span, bg: CTX_BG }))
  const room = Math.max(0, width - widthOf(line))
  return room > 0 ? [...filled, sp(' '.repeat(room), { bg: CTX_BG })] : filled
}

// The context in its own box, `cap` rows tall from row `top`, with a scroll bar and a line saying what is out of view.
function contextBox(context: string, width: number, ctx: CtxView): L[] {
  if (ctx.cap <= 0) return []
  const inner = width - BOX_CELLS
  const body = contextBody(context, inner)
  const top = Math.min(Math.max(0, ctx.top), Math.max(0, body.length - ctx.cap))
  const bar = scrollBar<Action>(ctx.cap, body.length, top)
  const shown = body.slice(top, top + ctx.cap)
  const rail = sp<Action>(`${SYMBOL.bar} `, GRAY)
  const lines = shown.map((line, n): L => [rail, ...tint([sp(' '), ...clipLine(line, inner)], inner + 1), ...(body.length > ctx.cap ? bar[n]! : [])])
  if (body.length <= ctx.cap) return lines
  const below = body.length - top - ctx.cap
  const where = below > 0 ? `↓ ${below} more line${below === 1 ? '' : 's'}` : `↑ ${top} line${top === 1 ? '' : 's'} above`
  const keys = 'shift+↑↓ or wheel'
  const gapCells = Math.max(2, width - 2 - widthOf([sp(where), sp(keys)]))
  return [...lines, [sp(SYMBOL.bar, GRAY), sp(' '), sp(where, DIM), sp(' '.repeat(gapCells)), sp(keys, GRAY)]]
}

function answerSummary(q: FormQuestion, s: State, i: number): string {
  const choices = choicesOf(q)
  if (choices.length === 0) return s.text[i]! === '' ? '(blank)' : s.text[i]!
  const label = (v: string) => (v === WRITE_IN ? `“${s.text[i]!}”` : (choices.find(o => o.value === v)?.label ?? v))
  if (!q.multi) return label(s.chosen[i] ?? '')
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

// Progress, not navigation targets: a dot per question (answered, current, to do), each still a click to its page,
// then where you are and how many are left. There is no Submit item; the last page's button goes to the review.
function progress(form: Form, s: State, view: View): L {
  const n = form.questions.length
  const dots: L = form.questions.flatMap((_, i): L => [
    sp(i === s.page ? SYMBOL.radioOn : s.answered[i] ? SYMBOL.radioOn : SYMBOL.radioOff, { ...(i === s.page ? ACCENT : s.answered[i] ? DONE : GRAY), action: { type: 'page', page: i } }),
    sp(' '),
  ])
  const q = form.questions[s.page]
  const where: L = q ? [sp(` ${q.header}`, { bold: true }), sp(`  question ${s.page + 1} of ${n}`, DIM)] : [sp(' review', { bold: true })]
  const missing = unansweredCount(s)
  const left = sp<Action>(missing === 0 ? 'all answered' : `${missing} to answer`, missing === 0 ? DONE : DIM)
  const line: L = [sp(SYMBOL.bar, GRAY), sp('  '), ...dots, ...where]
  const room = view.width - widthOf(line) - widthOf([left])
  return room >= 2 ? [...line, sp(' '.repeat(room)), left] : line
}

const MORE: Action = { type: 'menu', hit: { type: 'toggle' } }

// Where each nav button's span sits in buttonRow's line: the indent, then each left button and its gap, the right button last.
function spanAt(id: NavId, left: NavId[], line: L): number {
  return id === 'chat' ? line.length - 1 : 1 + 2 * left.indexOf(id)
}

// The nav row, and under it the More actions rows while that menu is open (the review page only).
function navRows(form: Form, s: State, view: View): L[] {
  const n = form.questions.length
  const page = s.page
  const back: Button<Action> = { label: '← Back', action: { type: 'page', page: page - 1 }, tone: 'secondary', disabled: page === 0 }
  const forward = (label: string): Button<Action> => ({ label, action: { type: 'advance' }, tone: 'secondary' })
  const submit: Button<Action> = { label: unansweredCount(s) === 0 || form.source === 'gate' ? 'Submit' : 'Submit anyway', action: { type: 'send' }, tone: 'brand', disabled: !canSubmit(form, s) }
  const next = page < n - 1 ? forward('Next →') : page === n - 1 ? forward('Review →') : submit
  const aside: Button<Action> | undefined = !canChat(form)
    ? undefined
    : s.chatArmed
    ? { label: `${ICON.chat} Press again to chat`, action: { type: 'chat' }, tone: 'caution' }
    : { label: `${ICON.chat} Chat about this`, action: { type: 'chat' }, tone: 'neutral' }
  const rows = page === n ? menuRows(form) : []
  const more: Button<Action> = { label: MORE_ACTIONS, action: MORE, tone: 'quiet' }
  const left: [NavId, Button<Action>][] = [...(page === n ? [] : [['back', back] as [NavId, Button<Action>]]), ['next', next], ...(rows.length === 0 ? [] : [['more', more] as [NavId, Button<Action>]])]
  const line = buttonRow(left.map(([, button]) => button), aside, view.width)
  const marked = (row: L): L => {
    if (!view.focused || !isOnNav(form, s)) return row
    const at = spanAt(navAtOf(form, s), left.map(([id]) => id), row)
    return [...row.slice(0, at), ...gridLook(row[at]!, { marked: true, pressing: view.pressing && !s.menu.open }), ...row.slice(at + 1)]
  }
  if (rows.length === 0) return [marked(line)]

  const at = line.findIndex(span => span.action === MORE)
  const indent = widthOf(line.slice(0, at))
  const hung = menu<Action>({ ...s.menu, label: MORE_ACTIONS, rows, width: view.width, indent, pressing: view.pressing === true, actionFor: hit => ({ type: 'menu', hit }) })
  return [marked(line), ...hung.slice(1)]
}

// A confirm's Client draws only its head; the answers under it are the engine's Buttons (register.tsx), which take a
// focused pane's keys at once. Its rail stays the unfocused gray all the way down, having no question section.
function confirmFoot(form: Form, view: View): L[] {
  return [[sp(SYMBOL.end, GRAY)], ...errorLines(form, view)]
}

// The keys stay on the options, so Submit is never marked; Enter presses it from there.
function submitRow(form: Form, s: State, view: View): L {
  return buttonRow([{ label: 'Submit', action: { type: 'send' }, tone: 'brand', disabled: !canSubmit(form, s) }], undefined, view.width)
}

function errorLines(form: Form, view: View): L[] {
  if (form.status !== 'open' || !form.error) return []
  const lead = [sp<Action>(SYMBOL.warn, WARN), sp('  ')]
  return [[sp(' ')], ...hang(lead, [sp<Action>('   ')], form.error, view.width, WARN)]
}

// The same with or without focus: focus changes only how the selection is drawn, never what the form says.
function hint(form: Form, s: State): string | undefined {
  const q = form.questions[s.page]
  if (isSinglePage(form)) return '↑↓ move  space pick  enter pick + submit'
  if (!q) {
    const others = navIds(form, s).length > 1 ? '   tab buttons' : ''
    return `← back${others}   enter ${navAtOf(form, s) === 'next' ? 'submit' : 'presses'}`
  }
  if (s.onNav) return '←→ buttons  ↑ answers  enter presses'
  if (choicesOf(q).length === 0) return '←→ pages  ↓ buttons'
  return q.multi ? '↑↓ move  space tick  enter next  ←→ pages' : '↑↓ move  space pick  enter pick + next  ←→ pages'
}

// The context is always drawn, wrapped in full: a page too tall for the pane scrolls to it rather than dropping it.
function draw(form: Form, s: State, view: View, ctx?: CtxView): Drawn<Action> {
  const head: L[] = [brandBar<Action>(form.source === 'plugin' ? 'mattstack' : 'mattstack decision gate', view.width, { type: 'hide' }), [sp(' ')], [sp(SYMBOL.start, GRAY), sp('  '), sp(form.title, { bold: true })]]
  if (s.phase !== 'active' || form.status !== 'open') return { head, page: closedPage(form, s, view), foot: [] }
  const gap: L = [sp(SYMBOL.bar, GRAY)]
  head.push(gap)
  if (form.context && isConfirm(form)) {
    const indent = rail<Action>(GRAY)
    head.push(...hang(indent, indent, contextText(form.context), view.width))
  } else if (form.context) head.push(...contextBox(form.context, view.width, ctx ?? { cap: Number.MAX_SAFE_INTEGER, top: 0 }), gap)
  if (isConfirm(form)) return { head, page: [], foot: confirmFoot(form, view) }
  if (!isSinglePage(form)) head.push(progress(form, s, view), gap)

  const q = form.questions[s.page]
  const accentBar = rail<Action>(ACCENT)
  const page = q ? questionPage(q, s, s.page, view) : reviewPage(form, s, view)
  const keys = hint(form, s)
  const hintLines: L[] = keys === undefined ? [] : [[sp(SYMBOL.bar, ACCENT)], ...hang(accentBar, accentBar, keys, view.width, DIM)]
  const nav: L[] = [[sp(' ')], ...(isSinglePage(form) ? [submitRow(form, s, view)] : navRows(form, s, view))]
  const foot: L[] = [...hintLines, [sp(SYMBOL.end, ACCENT)], ...errorLines(form, view), ...nav]
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
// `ctxTop` is the context box's first row in view.
export type Fitted = { lines: L[]; top: number; followed?: string; wheelAt?: number; ctxTop?: number }

// The context box takes the rows the form leaves, down to MIN_CTX, and scrolls inside itself (shift+↑↓, or the wheel
// while it overflows), so the question and the buttons stay in view. Measured against the tallest question, so the box
// keeps its height as you page.
function contextFit(form: Form, s: State, view: View, rows: number, turned: number): { ctx?: CtxView; usedWheel: boolean } {
  if (!form.context || isConfirm(form) || s.phase !== 'active' || form.status !== 'open') return { usedWheel: false }
  const total = contextBody(form.context, view.width - BOX_CELLS).length
  const bare = draw(form, s, view, { cap: 0, top: 0 })
  const pageRows = Math.max(bare.page.length, tallestQuestion(form, s, view))
  const room = rows - bare.head.length - pageRows - bare.foot.length
  if (total <= Math.max(MIN_CTX, room)) return { ctx: { cap: total, top: 0 }, usedWheel: false }
  const cap = Math.max(MIN_CTX, room - 1)
  const top = Math.min(Math.max(0, (s.ctxTop ?? 0) + turned), total - cap)
  return { ctx: { cap, top }, usedWheel: true }
}

// Every page is padded to the tallest question's height, room allowing, so the buttons keep their row as you page.
// A page too tall for the pane even with the context box at its smallest scrolls between the brand bar and the nav
// rows instead, so nothing is cut: the window follows the cursor's choice when it moves, the wheel (`wheel`, the
// pane's running total) moves it too, and a scroll bar runs down its right edge.
export function fittedLines(form: Form, s: State, view: View, rows: number, wheel?: number): Fitted {
  const wheelTurn = wheel === undefined || s.wheelAt === undefined ? 0 : wheel - s.wheelAt
  const { ctx, usedWheel } = contextFit(form, s, view, rows, wheelTurn)
  const kept = { ...(wheel !== undefined && { wheelAt: wheel }), ...(ctx && { ctxTop: ctx.top }) }
  const full = draw(form, s, view, ctx)
  const room = rows - FIXED_TOP - full.foot.length
  if (full.head.length - FIXED_TOP + full.page.length <= room) {
    const pad = s.phase === 'active' && form.status === 'open' && !isConfirm(form) ? { height: tallestQuestion(form, s, view), filler: [sp(SYMBOL.bar, ACCENT)] as L } : undefined
    return { lines: fitToRows(full, rows, () => full, pad), top: 0, ...kept }
  }
  const inner = { ...view, width: Math.max(20, view.width - BAR_CELLS) }
  const narrow = draw(form, s, inner, ctx)
  const region = [...narrow.head.slice(FIXED_TOP), ...narrow.page]
  const windowRows = Math.max(1, rows - FIXED_TOP - narrow.foot.length)
  const turned = usedWheel ? 0 : wheelTurn
  const most = maxScroll(region.length, windowRows)
  const wheeled = Math.min(Math.max(0, (s.pageTop ?? 0) + turned), most)
  const cursor = `${s.page}:${s.onNav ? 'nav' : (s.cursor[s.page] ?? '')}`
  const top = cursor === s.followed ? wheeled : followCursor(region, s, windowRows, wheeled)
  const bar = scrollBar<Action>(windowRows, region.length, top)
  // A choice's click is on the line itself (`withAction`), so the drawn line keeps it.
  const shown = region.slice(top, top + windowRows).map((line, n): L => Object.assign([...clipLine(line, inner.width), ...(bar[n] ?? [])], line.action === undefined ? {} : { action: line.action }))
  return { lines: [...full.head.slice(0, FIXED_TOP), ...shown, ...narrow.foot], top, followed: cursor, ...kept }
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
