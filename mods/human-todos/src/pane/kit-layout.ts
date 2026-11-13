import { ACCENT, DIM, DONE, FILL, GRAY, WARN, buttonRow, cellWidth, cutCells, scrollBar, sp, widthOf, wrap } from '@mattstack/mod-kit'
import type { Line, Style } from '@mattstack/mod-kit'

import type { ButtonId } from '../items'
import { endRows, outOfView } from './model'
import type { PaneButton, PaneModel, PaneRow, Tone } from './model'

export type PaneMessage = { type: 'press'; id: string; button: ButtonId } | { type: 'toggle'; id: string } | { type: 'clear' }
type L = Line<PaneMessage>
type Span = { first: number; last: number }
export type KitLayout = { lines: L[]; spans: Span[]; windowRows: number }

const GUTTER = 2
const INDENT = 2
const BAR = 3
// The brand bar and the blank row under it stay on top; only the rows below them scroll.
export const BAR_ROWS = 2

// Every row leaves the gutter and the scroll bar's three cells free; an indented row is two cells narrower again, and the model's width is that row's.
export const modelWidth = (width: number): number => Math.max(1, width - GUTTER - BAR - INDENT)

const STYLE: Record<Tone, Style> = {
  title: { bold: true },
  dim: DIM,
  warning: WARN,
  script: ACCENT,
  link: ACCENT,
  success: DONE,
  error: { color: 'red' },
  inactive: GRAY,
  plain: {},
}

function messageOf(button: PaneButton): PaneMessage {
  if (button.id === 'clear') return { type: 'clear' }
  if (button.id === 'more') return { type: 'toggle', id: button.todoId ?? '' }
  return { type: 'press', id: button.todoId ?? '', button: button.id }
}

const fit = (text: string, cells: number) => (cellWidth(text) <= cells ? text : `${cutCells(text, Math.max(0, cells - 1))}…`)

// Buttons that do not fit side by side carry on to a row of their own, under the first button.
function buttonLines(row: Extract<PaneRow, { kind: 'buttons' }>, room: number): L[] {
  const indent = sp<PaneMessage>(' '.repeat(row.flush ? 0 : INDENT))
  const lead: L = row.lead ? [sp(row.lead.pad ? `${row.lead.text} ` : row.lead.text, STYLE[row.lead.tone])] : []
  const gap = row.lead ? 1 : 0
  const avail = Math.max(1, room - widthOf([indent, ...lead]))
  let rest = row.buttons.map(b => ({ label: b.label, tone: b.tone, action: messageOf(b) }))
  const draw = (buttons: typeof rest) => buttonRow(buttons, undefined, avail, gap)
  const out: L[] = []
  while (rest.length > 0) {
    let n = rest.length
    while (n > 1 && widthOf(draw(rest.slice(0, n))) > avail) n--
    out.push([indent, ...(out.length === 0 ? lead : [sp(' '.repeat(widthOf(lead)))]), ...draw(rest.slice(0, n))])
    rest = rest.slice(n)
  }
  return out
}

// The model wraps by characters; a row wider in cells than its room wraps again here.
function rowLines(row: PaneRow, room: number): L[] {
  switch (row.kind) {
    case 'blank':
      return [[]]
    case 'text': {
      const indent = row.indent ? INDENT : 0
      const cells = Math.max(1, room - indent)
      const pieces = cellWidth(row.text) > cells ? wrap(row.text, cells) : [row.text]
      return pieces.map(piece => [sp(' '.repeat(indent)), sp(piece, STYLE[row.tone])])
    }
    case 'finished': {
      const mark = `${row.mark} `
      const exit = row.exit === undefined ? '' : ` (exit ${row.exit})`
      const title = fit(row.title, room - cellWidth(mark) - cellWidth(exit))
      return [[sp(mark, STYLE[row.tone]), sp(title, DIM), ...(exit ? [sp(exit, DIM)] : [])]]
    }
    case 'buttons':
      return buttonLines(row, room)
  }
}

// Every body line of the list, with each item's span in lines and the end rows when it overflows the window.
export function kitLayout(model: PaneModel, width: number, bodyRows: number): KitLayout {
  const room = Math.max(1, width - GUTTER - BAR)
  const windowRows = Math.max(1, bodyRows - BAR_ROWS)
  const starts: number[] = []
  const lines: L[] = []
  for (const row of model.rows) {
    starts.push(lines.length)
    lines.push(...rowLines(row, room))
  }
  const spans = model.spans.map(s => ({ first: starts[s.first] ?? 0, last: (starts[s.last + 1] ?? lines.length) - 1 }))
  if (lines.length > windowRows) for (const row of endRows(model)) lines.push(...rowLines(row, room))
  return { lines, spans, windowRows }
}

export function maxOffset(layout: KitLayout): number {
  return Math.max(0, layout.lines.length - layout.windowRows)
}

// A last guard: no row reaches into the scroll bar, however its pieces measured.
function clip(line: L, cells: number): L {
  const out: L = []
  let used = 0
  for (const span of line) {
    const w = cellWidth(span.t)
    if (used + w <= cells) {
      out.push(span)
      used += w
      continue
    }
    const t = cutCells(span.t, cells - used)
    if (t !== '') out.push({ ...span, t })
    used += cellWidth(t)
    break
  }
  out.push(sp(' '.repeat(Math.max(0, cells - used))))
  return out
}

const hint = (text: string): L => [sp(` ${text} `, FILL.chip)]

// The rows in view from `offset`, clamped to the list as it is now, each ending in its scroll bar cell.
export function kitWindow(layout: KitLayout, width: number, offset: number): L[] {
  const { lines, spans, windowRows } = layout
  const top = Math.min(Math.max(0, offset), maxOffset(layout))
  const shown = lines.slice(top, top + windowRows)
  if (lines.length > windowRows) {
    const { above, below } = outOfView(spans, top, top + windowRows - 1)
    if (above > 0) shown[0] = hint(`↑ ${above} more`)
    if (below > 0) shown[shown.length - 1] = hint(`↓ ${below} more`)
  }
  const bar = scrollBar<PaneMessage>(windowRows, lines.length, top)
  return shown.map((line, n) => [...clip([sp(' '.repeat(GUTTER)), ...line], width - BAR), ...(bar[n] ?? [])])
}
