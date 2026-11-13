import { ACCENT, BRAND, DIM, DONE, GRAY, SYMBOL, WARN, buttonRow, cellWidth, cutCells, keySelected, pressed, scrollBar, sp, widthOf, wrap } from '@mattstack/mod-kit'
import type { Line, Style } from '@mattstack/mod-kit'

import { endRows, messageOf } from './model'
import type { PaneButton, PaneMessage, PaneModel, PaneRow, Tone } from './model'

type L = Line<PaneMessage>
type Span = { first: number; last: number }
export type KitLayout = { lines: L[]; spans: Span[]; windowRows: number; rows: { row: PaneRow; first: number; count: number }[] }

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

const roomOf = (width: number) => Math.max(1, width - GUTTER - BAR)

// The first row carries the lead; rows carried on start at the item's indent with its whole room, so a button too wide
// to sit beside the lead still fits whole. A lead with no room for even one button beside it takes a row of its own.
function buttonLines(row: Extract<PaneRow, { kind: 'buttons' }>, room: number): L[] {
  const indent = sp<PaneMessage>(' '.repeat(row.flush ? 0 : INDENT))
  const lead: L = row.lead ? [sp(row.lead.pad ? `${row.lead.text} ` : row.lead.text, STYLE[row.lead.tone])] : []
  let rest = row.buttons.map(b => ({ label: b.label, tone: b.tone, action: messageOf(b) }))
  const out: L[] = []
  let withLead = lead.length > 0
  while (rest.length > 0) {
    // One cell between the lead and its buttons; none at the indent.
    const leadIn = withLead ? 1 : 0
    const avail = Math.max(1, room - widthOf([indent, ...(withLead ? lead : [])]))
    const draw = (buttons: typeof rest) => buttonRow(buttons, undefined, avail, leadIn)
    let n = rest.length
    while (n > 0 && widthOf(draw(rest.slice(0, n))) > avail) n--
    if (n === 0 && withLead) {
      out.push([indent, ...lead])
      withLead = false
      continue
    }
    n = Math.max(1, n)
    out.push([indent, ...(withLead ? lead : []), ...draw(rest.slice(0, n))])
    rest = rest.slice(n)
    withLead = false
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
  const room = roomOf(width)
  const windowRows = Math.max(1, bodyRows - BAR_ROWS)
  const rows: KitLayout['rows'] = []
  const lines: L[] = []
  const add = (row: PaneRow) => {
    const laid = rowLines(row, room)
    rows.push({ row, first: lines.length, count: laid.length })
    lines.push(...laid)
  }
  model.rows.forEach(add)
  const spans = model.spans.map(s => ({ first: rows[s.first]?.first ?? 0, last: (rows[s.last + 1]?.first ?? lines.length) - 1 }))
  if (lines.length > windowRows) endRows(model).forEach(add)
  return { lines, spans, windowRows, rows }
}

export function maxOffset(layout: KitLayout): number {
  return Math.max(0, layout.lines.length - layout.windowRows)
}

// What the keys move between: each actionable item's buttons in order, then Clear finished. `ids` are its buttons' ids, `main` the
// filled one, and `first`/`last` the lines the stop covers. Ids, not whole messages, keep the props small on a long list.
export type ViewStop = { key: string; ids: PaneButton['id'][]; main: number; first: number; last: number; isItem: boolean }

// The message the stop's button at `col` posts: the same one a click on it sends.
export function stopMessage(stop: ViewStop, col: number): PaneMessage | undefined {
  const id = stop.ids[col]
  return id === undefined ? undefined : messageOf({ id, todoId: stop.isItem ? stop.key : undefined })
}

// What the Client draws from: the model rows its window touches (laid out again there, `skip` lines into the first), the window's
// place in the whole list, and the key stops. The whole model would pass the engine's cap on a Client's props for a long list.
export type KitView = { rows: PaneRow[]; skip: number; top: number; total: number; windowRows: number; stops: ViewStop[] }

function keyStops(model: PaneModel, layout: KitLayout): ViewStop[] {
  const stops: (ViewStop & { tones: string[] })[] = []
  for (const row of model.rows) {
    if (row.kind !== 'buttons') continue
    for (const button of row.buttons) {
      const key = button.todoId ?? button.id
      const stop = stops.find(s => s.key === key)
      if (stop) {
        stop.ids.push(button.id)
        stop.tones.push(button.tone)
      } else stops.push({ key, ids: [button.id], tones: [button.tone], main: 0, first: 0, last: 0, isItem: button.todoId !== undefined })
    }
  }
  let item = 0
  return stops.map(({ tones, ...stop }) => {
    const wanted = JSON.stringify(stopMessage(stop, 0))
    const at = layout.lines.findIndex(line => line.some(span => span.action !== undefined && JSON.stringify(span.action) === wanted))
    // Actionable items come first among the model's spans, in the order of their stops.
    const span = stop.isItem ? layout.spans[item++] : { first: at, last: at }
    return { ...stop, main: Math.max(0, tones.findIndex(t => t !== 'quiet')), first: span?.first ?? 0, last: span?.last ?? 0 }
  })
}

// The hook's half: lays the whole list out to find the window, and keeps only what the Client needs to draw it.
export function kitView(model: PaneModel, width: number, bodyRows: number, offset: number): KitView {
  const layout = kitLayout(model, width, bodyRows)
  const top = Math.min(Math.max(0, offset), maxOffset(layout))
  const touched = layout.rows.filter(r => r.first + r.count > top && r.first < top + layout.windowRows)
  return {
    rows: touched.map(r => r.row),
    skip: top - (touched[0]?.first ?? top),
    top,
    total: layout.lines.length,
    windowRows: layout.windowRows,
    stops: keyStops(model, layout),
  }
}

// The offset that shows a stop whole, moving the window as little as it can; the window's own while the stop shows already.
export function revealOffset(view: KitView, index: number): number {
  const stop = view.stops[index]
  const most = Math.max(0, view.total - view.windowRows)
  if (!stop) return view.top
  if (stop.first < view.top) return Math.max(0, stop.first)
  // An item taller than the window shows its top.
  if (stop.last > view.top + view.windowRows - 1) return Math.min(most, Math.min(stop.first, stop.last - view.windowRows + 1))
  return view.top
}

export function isInView(view: KitView, index: number): boolean {
  const stop = view.stops[index]
  return stop !== undefined && stop.first >= view.top && stop.last <= view.top + view.windowRows - 1
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

// The Client's half: the window's rows laid out, each ending in its scroll bar cell.
// The button the keys selected takes the kit's selected look, and its item carries the pink rail in the gutter.
export function viewLines(view: KitView, width: number, focus: KitFocus = {}): L[] {
  const room = roomOf(width)
  const shown = view.rows.flatMap(row => rowLines(row, room)).slice(view.skip, view.skip + view.windowRows)
  const chosen = focus.selected && JSON.stringify(focus.selected)
  const range = focus.marked ? focus.range : undefined
  const look = (span: L[number]): L => {
    const base = focus.pressing ? pressed(span) : span
    return focus.marked ? keySelected(base) : [base]
  }
  const bar = scrollBar<PaneMessage>(view.windowRows, view.total, view.top)
  return shown.map((line, n) => {
    const at = view.top + n
    const lit = chosen ? line.flatMap(span => (span.action !== undefined && JSON.stringify(span.action) === chosen ? look(span) : [span])) : line
    const marked = range && at === range.first ? markFirst(lit) : lit
    const gutter = range && at >= range.first && at <= range.last ? RAIL : [sp(' '.repeat(GUTTER))]
    return [...clip([...gutter, ...marked], width - BAR), ...(bar[n] ?? [])]
  })
}
