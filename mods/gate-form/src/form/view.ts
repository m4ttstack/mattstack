import { DIM, DONE, ICON, MORE_ACTIONS, SYMBOL, WARN, brandBar, buttonRow, cellWidth, chunkCells, clipLine, fitToRows, hang, markButtonAt, maxScroll, menu, revealOffset, scrollBar, reviewList as reviewItems, selectList, sp, textCursor, widthOf, type Button, type Drawn, type Line, type Span } from '@mattstack/mod-kit'

import type { Form, FormQuestion } from '../../types'
import type { Action } from './input'
import { canChat, canSubmit, choicesOf, firstPage, isConfirm, isContextPage, isOneQuestion, isOnNav, isReview, isPicked, isSinglePage, menuRows, navAtOf, unansweredCount, WRITE_IN, type NavId, type State } from './state'

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

const CODE = { color: '#7fa7ad' }

// `code` reads dimmed, without its backticks; the rest keeps `style`. An unmatched backtick stays as typed.
function styledWords(text: string, style: Omit<Span<Action>, 't'>): Span<Action>[] {
  const parts = text.split('`')
  const balanced = parts.length % 2 === 1
  return parts.flatMap((part, n) => {
    const isCode = balanced && n % 2 === 1
    const piece = !balanced && n > 0 ? `\`${part}` : part
    return piece.split(/( +)/).filter(w => w !== '').map(w => sp<Action>(w, isCode ? { ...style, ...CODE } : style))
  })
}

// hang for text with inline code: words wrap as hang's do, a word wider than the row is cut, and spaces at a break drop.
function richHang(first: L, rest: L, text: string, width: number, style: Omit<Span<Action>, 't'> = {}): L[] {
  const out: L[] = []
  let row: L = [...first]
  let lead = first
  const flush = () => {
    while (row.length > lead.length && row[row.length - 1]!.t.trim() === '') row.pop()
    out.push(row)
    lead = rest
    row = [...rest]
  }
  for (const word of styledWords(text, style)) {
    const isSpace = word.t.trim() === ''
    if (isSpace && row.length === lead.length) continue
    if (widthOf(row) + cellWidth(word.t) > width && row.length > lead.length) {
      flush()
      if (isSpace) continue
    }
    const room = Math.max(1, width - widthOf(row))
    if (cellWidth(word.t) <= room) row.push(word)
    else for (const chunk of chunkCells(word.t, Math.max(1, width - widthOf(rest)))) {
      if (row.length > lead.length) flush()
      row.push({ ...word, t: chunk })
    }
  }
  if (row.length > lead.length || out.length === 0) flush()
  return out
}

// The context as light markdown: `#` headings and short lines ending in a colon read as bold labels, `-` and `*`
// items as bullets with a hanging indent, `code` dims without its backticks, and runs of blank lines collapse to one.
export function contextBody(context: string, width: number): L[] {
  const out: L[] = []
  for (const raw of contextText(context).split('\n')) {
    const t = raw.trimEnd()
    const bullet = /^\s*[-*] +/.exec(t)
    if (t.trim() === '') {
      if (out.length > 0 && out[out.length - 1]!.length > 0) out.push([])
    } else if (bullet) out.push(...richHang([sp('  • ', DIM)], [sp('    ')], t.slice(bullet[0].length), width))
    else if (/^#{1,6} /.test(t)) out.push(...richHang([], [], t.replace(/^#+ +/, ''), width, { bold: true }))
    else if (t.endsWith(':') && t.length <= 60) out.push(...richHang([], [], t.slice(0, -1), width, { bold: true }))
    else out.push(...richHang([], [], t, width))
  }
  while (out.length > 0 && out[out.length - 1]!.length === 0) out.pop()
  return out
}

// The scroll bar's three cells.
const BOX_CELLS = 3
// The fewest context rows the box shrinks to before the whole page scrolls instead.
const MIN_CTX = 3
// The fewest rows the context box gets beside the form before the context moves to its own page.
const CTX_FLOOR = 8

// `compact`: the context page drops its spacing rows and the Next line, for a pane too short to show them and the context.
export type CtxView = { cap: number; top: number; compact?: boolean }

// No rail runs down the side: sections are set apart by blank rows, a dim label and thin rules.
// A blank row holds a space: the engine drops a line with no text at all.
const BLANK: L = [sp(' ')]
const RULE_COLOR = '#3a3a3a'
const rule = (width: number): L => [sp('─'.repeat(width), { color: RULE_COLOR })]

// The context in its own box, `cap` rows tall from row `top`, with a scroll bar and a line saying what is out of view.
function contextBox(context: string, width: number, ctx: CtxView): L[] {
  if (ctx.cap <= 0) return []
  const inner = width - BOX_CELLS
  const body = contextBody(context, inner)
  const cap = Math.min(ctx.cap, body.length)
  const top = Math.min(Math.max(0, ctx.top), Math.max(0, body.length - cap))
  const bar = scrollBar<Action>(cap, body.length, top)
  const shown = body.slice(top, top + cap)
  const lines = shown.map((line, n): L => {
    const clipped = clipLine(line, inner)
    const text = clipped.length === 0 ? BLANK : clipped
    const pad = Math.max(0, inner - widthOf(text))
    return [...text, ...(body.length > cap ? [sp<Action>(' '.repeat(pad)), ...bar[n]!] : [])]
  })
  return lines
}

function answerSummary(q: FormQuestion, s: State, i: number): string {
  const choices = choicesOf(q)
  if (choices.length === 0) return s.text[i]! === '' ? '(blank)' : s.text[i]!
  const label = (v: string) => (v === WRITE_IN ? `“${s.text[i]!}”` : (choices.find(o => o.value === v)?.label ?? v))
  if (!q.multi) return label(s.chosen[i] ?? '')
  const values = [...s.picked[i]!, ...(s.text[i]!.trim() !== '' ? [WRITE_IN] : [])]
  return values.length === 0 ? 'none' : values.map(label).join(', ')
}

// A joined split's recorded answer is its parts' picks read as one list.
function wonOf(q: FormQuestion, won: Record<string, unknown>): unknown {
  if (!q.parts) return won[q.id]
  return q.parts.flatMap(part => (Array.isArray(won[part.id]) ? (won[part.id] as unknown[]) : []))
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


function questionPage(q: FormQuestion, s: State, i: number, base: View): L[] {
  // On the nav row the keys are there, so the answer shows no caret.
  const view = { ...base, focused: base.focused && !s.onNav, pressing: base.pressing && !s.onNav }
  const number = `${i + 1}.`.padEnd(4)
  const bar: L = [sp(' '.repeat(number.length))]
  const lines: L[] = hang([sp(number, DIM)], bar, q.label, view.width, { bold: true })
  if (q.multi) lines.push([...bar, sp('pick any number', DIM)])
  if (q.context) lines.push(...hang(bar, bar, q.context, view.width, DIM))
  lines.push(BLANK)
  const choices = choicesOf(q)
  if (choices.length === 0) {
    lines.push([sp('  '), ...textCursor(s.text[i]!, 'Type your answer', view.focused)])
    return lines
  }
  lines.push(
    ...selectList<Action>({
      choices: choices.map(c => ({ label: c.label, description: c.description, isWriteIn: c.value === WRITE_IN })),
      cursor: s.cursor[i]!,
      multi: q.multi,
      isPicked: idx => isPicked(q, s, i, idx),
      isDefault: () => !s.answered[i],
      writeIn: s.text[i]!,
      width: view.width,
      focused: view.focused,
      ...(view.pressing && { pressing: true }),
      // The page scrolls instead, so every choice is drawn.
      maxShown: choices.length,
      actionFor: idx => ({ type: 'option', idx }),
      rail: false,
      spaced: true,
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
      summary: won ? wonSummary(q, wonOf(q, won)) : s.answered[i] ? answerSummary(q, s, i) : undefined,
      ...(isOpen && { action: { type: 'page', page: i } as const }),
    })),
    view.width,
    { rail: false },
  )
}

function reviewPage(form: Form, s: State, view: View): L[] {
  const missing = unansweredCount(s)
  const bar: L = [sp('   ')]
  const lines: L[] = [...reviewList(form, s, view), BLANK, [sp(ICON.review, DONE), sp('  Submit your answers?', { bold: true })]]
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
  return [...reviewList(form, s, view), BLANK, ...hang<Action>([], [], end.text, view.width, end.isWarn ? WARN : {})]
}

// Progress only, nothing to click: a checkbox per question, ticked once answered and bright on the current page,
// then where you are and how many are left. There is no Submit item; the last page's button goes to the review.
function progress(form: Form, s: State, view: View): L {
  const n = form.questions.length
  const dots: L = form.questions.flatMap((_, i): L => [
    sp(s.answered[i] ? '☑' : '☐', { color: i === s.page ? 'white' : '#8a8a8a' }),
    sp(' '),
  ])
  const marker: L = s.contextPaged ? [sp('◆', { color: isContextPage(s) ? 'white' : '#8a8a8a' }), sp(' ')] : []
  const q = form.questions[s.page]
  const where: L = [sp(isContextPage(s) ? ` context, then ${n} question${n === 1 ? '' : 's'}` : q ? ` question ${s.page + 1} of ${n}` : ' review', DIM)]
  const missing = unansweredCount(s)
  const left = sp<Action>(missing === 0 ? 'all answered' : `${missing} to answer`, DIM)
  // The review page is a step of its own, so it ends the row in a different shape from the question boxes.
  const review: L = isOneQuestion(form) ? [] : [sp('⏎', { color: isReview(form, s) ? 'white' : '#8a8a8a' }), sp(' ')]
  const line: L = [...marker, ...dots, ...review, ...where]
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
  const back: Button<Action> = { label: '← Back', action: { type: 'page', page: page - 1 }, tone: 'secondary', disabled: page === firstPage(s) }
  const forward = (label: string): Button<Action> => ({ label, action: { type: 'advance' }, tone: 'secondary' })
  const submit: Button<Action> = { label: unansweredCount(s) === 0 || form.source === 'gate' ? 'Submit' : 'Submit anyway', action: { type: 'send' }, tone: 'brand', disabled: !canSubmit(form, s) }
  const next = isOneQuestion(form) || page === n ? submit : page < n - 1 ? forward('Next →') : forward('Review →')
  const aside = chatButton(form, s)
  const rows = page === n ? menuRows(form) : []
  const more: Button<Action> = { label: MORE_ACTIONS, action: MORE, tone: 'quiet' }
  const left: [NavId, Button<Action>][] = [...(page === n || (isOneQuestion(form) && !s.contextPaged) ? [] : [['back', back] as [NavId, Button<Action>]]), ['next', next], ...(rows.length === 0 ? [] : [['more', more] as [NavId, Button<Action>]])]
  const line = buttonRow(left.map(([, button]) => button), aside, view.width, 2)
  const marked = (row: L): L => {
    if (!view.focused || !isOnNav(form, s)) return row
    const at = spanAt(navAtOf(form, s), left.map(([id]) => id), row)
    return markButtonAt(row, at, { pressing: view.pressing && !s.menu.open })
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
  return [BLANK, ...errorLines(form, view)]
}

// The keys stay on the options, so Submit is never marked; Enter presses it from there.
function submitRow(form: Form, s: State, view: View): L {
  return buttonRow([{ label: 'Submit', action: { type: 'send' }, tone: 'brand', disabled: !canSubmit(form, s) }], undefined, view.width, 2)
}

function errorLines(form: Form, view: View): L[] {
  if (form.status !== 'open' || !form.error) return []
  const lead = [sp<Action>(SYMBOL.warn, WARN), sp('  ')]
  return [[sp(' ')], ...hang(lead, [sp<Action>('   ')], form.error, view.width, WARN)]
}

// Chat about this, or its armed state after a first press, on every page that offers it.
function chatButton(form: Form, s: State): Button<Action> | undefined {
  if (!canChat(form)) return undefined
  return s.chatArmed ? { label: `${ICON.chat} Press again to chat`, action: { type: 'chat' }, tone: 'caution' } : { label: `${ICON.chat} Chat about this`, action: { type: 'chat' }, tone: 'neutral' }
}

// The context page, a preface: how many questions follow, the context, then the first question named above Start.
function contextPage(form: Form, s: State, view: View, head: L[], ctx: CtxView): Drawn<Action> {
  const n = form.questions.length
  if (!ctx.compact) head.push([sp(`${n} question${n === 1 ? '' : 's'} after this`, DIM)], BLANK)
  const start: Button<Action> = { label: 'Start →', action: { type: 'page', page: 0 }, tone: 'secondary' }
  const line = buttonRow([start], chatButton(form, s), view.width, 2)
  const marked: L = view.focused ? markButtonAt(line, 1, { pressing: view.pressing }) : line
  const first = form.questions[0]
  const next: L = first ? clipLine([sp('Next: ', DIM), sp(first.label)], view.width) : BLANK
  const foot: L[] = ctx.compact ? [rule(view.width), marked] : [BLANK, rule(view.width), BLANK, next, BLANK, marked]
  return { head, page: contextBox(form.context ?? '', view.width, ctx), foot }
}

function draw(form: Form, s: State, view: View, ctx?: CtxView): Drawn<Action> {
  // The title rides in the brand bar, so the context and the form get its rows.
  const head: L[] = [brandBar<Action>(`mattstack · ${form.title}`, view.width, { type: 'hide' }), BLANK]
  if (s.phase !== 'active' || form.status !== 'open') return { head, page: closedPage(form, s, view), foot: [] }
  const gap = BLANK
  if (isContextPage(s) && form.context && !isConfirm(form)) return contextPage(form, s, view, head, ctx ?? { cap: Number.MAX_SAFE_INTEGER, top: 0 })
  if (form.context && isConfirm(form)) head.push(...hang<Action>([], [], contextText(form.context), view.width))
  else if (form.context && !s.contextPaged) head.push(...contextBox(form.context, view.width, ctx ?? { cap: Number.MAX_SAFE_INTEGER, top: 0 }), gap, rule(view.width))
  if (isConfirm(form)) return { head, page: [], foot: confirmFoot(form, view) }

  const q = form.questions[s.page]
  const page = [...progressRows(form, s, view), ...(q ? questionPage(q, s, s.page, view) : reviewPage(form, s, view))]
  const nav: L[] = [[sp(' ')], ...(isSinglePage(form) ? [submitRow(form, s, view)] : navRows(form, s, view))]
  const foot: L[] = [BLANK, rule(view.width), ...errorLines(form, view), ...nav]
  return { head, page, foot }
}

// The form's own head: a blank row, the progress line and a blank row under it, on a form with more than one page.
function progressRows(form: Form, s: State, view: View): L[] {
  return isSinglePage(form) || (isOneQuestion(form) && !s.contextPaged) ? [BLANK] : [BLANK, progress(form, s, view), BLANK]
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
  return tallest + progressRows(form, s, view).length
}

const BAR_CELLS = 3
// The brand bar and the blank row under it stay on top while the rest scrolls, as in human-todos.
const FIXED_TOP = 2

// `followed` names the cursor the window last moved to show, and `wheelAt` the wheel total it last took;
// the Client keeps both, so a wheel turn can leave the cursor out of view until the cursor moves again.
// `ctxTop` is the context box's first row in view.
export type Fitted = { lines: L[]; top: number; followed?: string; wheelAt?: number; ctxTop?: number; contextPaged?: boolean }

// The context box takes the rows the form leaves, down to MIN_CTX, and scrolls inside itself (shift+↑↓, or the wheel
// while it overflows), so the question and the buttons stay in view. Measured against the tallest question, so the box
// keeps its height as you page.
// Where the context goes: in full beside the form when it fits, in a box that scrolls when at least CTX_FLOOR rows
// are left for it, and on a page of its own before the first question when even that leaves it squashed.
function contextFit(form: Form, s: State, view: View, rows: number, turned: number): { ctx?: CtxView; usedWheel: boolean; paged: boolean } {
  if (!form.context || isConfirm(form) || s.phase !== 'active' || form.status !== 'open') return { usedWheel: false, paged: false }
  const total = contextBody(form.context, view.width - BOX_CELLS).length
  // Scrolling is bounded by the context as the narrowest draw wraps it (the page's own scroll bar takes cells), so the
  // last line stays reachable when the page scrolls too; the box clamps the offset again at the width it draws.
  const most = (cap: number) => Math.max(0, contextBody(form.context ?? '', view.width - BOX_CELLS - BAR_CELLS).length - cap)
  // Measured on a question page with the menu shut, so opening the review or its menu never moves the context.
  const last = Math.max(0, form.questions.length - 1)
  const inline = { ...s, page: Math.min(Math.max(0, s.page), last), contextPaged: undefined, menu: { ...s.menu, open: false } }
  const bare = draw(form, inline, view, { cap: 0, top: 0 })
  const pageRows = Math.max(bare.page.length, tallestQuestion(form, inline, view))
  const room = rows - bare.head.length - pageRows - bare.foot.length
  const scrolled = (cap: number, compact?: boolean) => ({ cap, top: Math.min(Math.max(0, (s.ctxTop ?? 0) + turned), most(cap)), ...(compact && { compact }) })
  if (total <= Math.max(MIN_CTX, room)) return { ctx: { cap: total, top: 0 }, usedWheel: false, paged: false }
  if (room >= CTX_FLOOR) return { ctx: scrolled(room), usedWheel: true, paged: false }
  if (!isContextPage(s)) return { usedWheel: false, paged: true }
  // The context page's own rows: roomy when MIN_CTX context rows still fit, compact otherwise, and the box never
  // promises more rows than the pane has left.
  const roomy = draw(form, s, view, { cap: 0, top: 0 })
  const compact = rows - roomy.head.length - roomy.foot.length < MIN_CTX
  const page = compact ? draw(form, s, view, { cap: 0, top: 0, compact }) : roomy
  const cap = Math.max(1, rows - page.head.length - page.foot.length)
  return { ctx: total <= cap ? { cap: total, top: 0, ...(compact && { compact }) } : scrolled(cap, compact), usedWheel: total > cap, paged: true }
}

// Every page is padded to the tallest question's height, room allowing, so the buttons keep their row as you page.
// A page too tall for the pane even with the context box at its smallest scrolls between the brand bar and the nav
// rows instead, so nothing is cut: the window follows the cursor's choice when it moves, the wheel (`wheel`, the
// pane's running total) moves it too, and a scroll bar runs down its right edge.
export function fittedLines(form: Form, s: State, view: View, rows: number, wheel?: number): Fitted {
  const wheelTurn = wheel === undefined || s.wheelAt === undefined ? 0 : wheel - s.wheelAt
  const { ctx, usedWheel, paged } = contextFit(form, s, view, rows, wheelTurn)
  // The stored offset is clamped at the width the box is drawn, so scrolling back up never turns through dead rows.
  const keptAt = (width: number) => ({
    ...(wheel !== undefined && { wheelAt: wheel }),
    ...(ctx && { ctxTop: Math.min(ctx.top, Math.max(0, contextBody(form.context ?? '', width - BOX_CELLS).length - ctx.cap)) }),
    contextPaged: paged,
  })
  const kept = keptAt(view.width)
  const full = draw(form, s, view, ctx)
  const room = rows - FIXED_TOP - full.foot.length
  if (full.head.length - FIXED_TOP + full.page.length <= room) {
    // The form docks to the bottom of the pane at the tallest question's height, so the progress line and the buttons
    // keep their rows as you page: a shorter question leaves blank rows under its options, the spare rows sit above.
    if (isContextPage(s)) {
      const spare = Math.max(0, rows - full.head.length - full.page.length - full.foot.length)
      return { lines: [...full.head, ...full.page, ...Array.from({ length: spare }, () => BLANK), ...full.foot], top: 0, ...kept }
    }
    if (s.phase === 'active' && form.status === 'open' && !isConfirm(form)) {
      const height = Math.max(full.page.length, Math.min(tallestQuestion(form, s, view), rows - full.head.length - full.foot.length))
      const page = [...full.page, ...Array.from({ length: height - full.page.length }, () => BLANK)]
      const spare = Math.max(0, rows - full.head.length - page.length - full.foot.length)
      return { lines: [...full.head, ...Array.from({ length: spare }, () => BLANK), ...page, ...full.foot], top: 0, ...kept }
    }
    const pad = s.phase === 'active' && form.status === 'open' && !isConfirm(form) ? { height: tallestQuestion(form, s, view), filler: BLANK } : undefined
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
  return { lines: [...full.head.slice(0, FIXED_TOP), ...shown, ...narrow.foot], top, followed: cursor, ...keptAt(inner.width) }
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
