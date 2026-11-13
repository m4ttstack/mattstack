import { ACCENT, BRAND, DIM, DONE, GRAY, SYMBOL, WARN, buttonRow, cellWidth, cutCells, keySelected, pressed, scrollBar, sp, widthOf, wrap } from '@mattstack/mod-kit'
import type { Line, Style } from '@mattstack/mod-kit'

import { endRows, messageOf } from './model'
import type { PaneButton, PaneMessage, PaneModel, PaneRow, Tone } from './model'

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

// The focused item's rail fills the gutter exactly, so rows keep their place as the selection moves.
const RAIL: L = [sp(SYMBOL.bar, { color: BRAND.pink }), sp(' '.repeat(GUTTER - 1))]

// What the keys move between: each actionable item's buttons in order, then Clear finished.
export type KeyStop = { key: string; buttons: PaneButton[] }

export function keyStops(model: PaneModel): KeyStop[] {
  const stops: KeyStop[] = []
  for (const row of model.rows) {
    if (row.kind !== 'buttons') continue
    for (const button of row.buttons) {
      const key = button.todoId ?? button.id
      const stop = stops.find(s => s.key === key)
      if (stop) stop.buttons.push(button)
      else stops.push({ key, buttons: [button] })
    }
  }
  return stops
}

// The lines a stop covers: an item's whole span (actionable items come first among the spans), or the line holding its button.
export function stopLines(layout: KitLayout, stops: KeyStop[], index: number): Span | undefined {
  const stop = stops[index]
  if (!stop) return undefined
  if (stop.buttons[0]?.todoId !== undefined) return layout.spans[stops.slice(0, index).filter(s => s.buttons[0]?.todoId !== undefined).length]
  const wanted = JSON.stringify(messageOf(stop.buttons[0]!))
  const at = layout.lines.findIndex(line => line.some(span => span.action !== undefined && JSON.stringify(span.action) === wanted))
  return at < 0 ? undefined : { first: at, last: at }
}

// The offset that shows a stop whole, moving the window as little as it can; the offset itself while the stop shows already.
export function revealOffset(layout: KitLayout, stops: KeyStop[], index: number, offset: number): number {
  const range = stopLines(layout, stops, index)
  const most = maxOffset(layout)
  const top = Math.min(Math.max(0, offset), most)
  if (!range) return top
  const { first, last } = range
  if (first < top) return Math.max(0, first)
  // An item taller than the window shows its top.
  if (last > top + layout.windowRows - 1) return Math.min(most, Math.min(first, last - layout.windowRows + 1))
  return top
}

// What a focused pane marks: the button the keys selected, and the lines of the item it belongs to.
// `marked` is keyboard mode: the selected button's pink edge and its item's rail show only then. `pressing` draws the selected button pressed while a key activates it.
export type KitFocus = { selected?: PaneMessage; range?: Span; marked?: boolean; pressing?: boolean }

// The item's mark turns pink on its first line, as gate-form marks its current question.
function markFirst(line: L): L {
  const at = line.findIndex(span => span.t.startsWith('○ '))
  if (at < 0) return line
  const span = line[at]!
  return [...line.slice(0, at), { ...span, t: '○', color: BRAND.pink }, { ...span, t: span.t.slice(1) }, ...line.slice(at + 1)]
}

// The rows in view from `offset`, clamped to the list as it is now, each ending in its scroll bar cell.
// The button the keys selected takes the kit's selected look, and its item carries the pink rail in the gutter.
export function kitWindow(layout: KitLayout, width: number, offset: number, focus: KitFocus = {}): L[] {
  const { lines: all, windowRows } = layout
  const chosen = focus.selected && JSON.stringify(focus.selected)
  const range = focus.marked ? focus.range : undefined
  const look = (span: L[number]): L => {
    const base = focus.pressing ? pressed(span) : span
    return focus.marked ? keySelected(base) : [base]
  }
  const lines = all.map((line, n) => {
    const lit = chosen ? line.flatMap(span => (span.action !== undefined && JSON.stringify(span.action) === chosen ? look(span) : [span])) : line
    return range && n === range.first ? markFirst(lit) : lit
  })
  const top = Math.min(Math.max(0, offset), maxOffset(layout))
  const shown = lines.slice(top, top + windowRows)
  const bar = scrollBar<PaneMessage>(windowRows, lines.length, top)
  const gutter = (n: number): L => {
    const at = top + n
    return range && at >= range.first && at <= range.last ? RAIL : [sp(' '.repeat(GUTTER))]
  }
  return shown.map((line, n) => [...clip([...gutter(n), ...line], width - BAR), ...(bar[n] ?? [])])
}
