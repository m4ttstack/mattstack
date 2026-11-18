import { ACCENT, DIM, DONE, GRAY, WARN, cellWidth, ellipsize, lineOfAction, maxScroll, scrollBar, sp, windowLines, wrap, wrappedButtons } from '@mattstack/mod-kit'
import type { Line, ListFocus, Style, WindowStop } from '@mattstack/mod-kit'

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

const roomOf = (width: number) => Math.max(1, width - GUTTER - BAR)

// Every button row, Clear finished too, starts at the indent: it holds the ❯ when a row's first button is selected.
function buttonLines(row: Extract<PaneRow, { kind: 'buttons' }>, room: number): L[] {
  const lead: L = row.lead ? [sp(row.lead.pad ? `${row.lead.text} ` : row.lead.text, STYLE[row.lead.tone])] : []
  return wrappedButtons(lead, row.buttons.map(b => ({ label: b.label, tone: b.tone, action: messageOf(b) })), room, INDENT)
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
      const title = ellipsize(row.title, room - cellWidth(mark) - cellWidth(exit))
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
  return maxScroll(layout.lines.length, layout.windowRows)
}

// What the keys move between: each actionable item's buttons in order, then Clear finished. `ids` are its buttons' ids, `main` the
// filled one, `lines` the line each button is on, and `first`/`last` the lines the stop covers. Ids, not whole messages, keep the props small on a long list.
export type ViewStop = WindowStop<PaneButton['id']> & { ids: PaneButton['id'][]; isItem: boolean }

// The message the stop's button at `col` posts: the same one a click on it sends.
export function stopMessage(stop: ViewStop, col: number): PaneMessage | undefined {
  const id = stop.ids[col]
  return id === undefined ? undefined : messageOf({ id, todoId: stop.isItem ? stop.key : undefined })
}

// What the Client draws from: the model rows its window touches (laid out again there, `skip` lines into the first), the window's
// place in the whole list, and the key stops. The whole model would pass the engine's cap on a Client's props for a long list.
export type KitView = { rows: PaneRow[]; skip: number; top: number; total: number; windowRows: number; stops: ViewStop[] }

// The pane draws on every spinner tick, so each button's line is looked for only among its own row's lines.
function keyStops(model: PaneModel, layout: KitLayout): ViewStop[] {
  const stops = new Map<string, ViewStop & { tones: string[] }>()
  model.rows.forEach((row, r) => {
    if (row.kind !== 'buttons') return
    const laid = layout.rows[r]!
    for (const button of row.buttons) {
      const offsetInRow = lineOfAction(layout.lines.slice(laid.first, laid.first + laid.count), messageOf(button))
      const line = laid.first + Math.max(0, offsetInRow)
      const key = button.todoId ?? button.id
      const stop = stops.get(key)
      if (stop) {
        stop.ids.push(button.id)
        stop.tones.push(button.tone)
        stop.lines.push(line)
      } else stops.set(key, { key, ids: [button.id], tones: [button.tone], lines: [line], main: 0, first: line, last: line, isItem: button.todoId !== undefined })
    }
  })
  let item = 0
  return [...stops.values()].map(({ tones, ...stop }) => {
    // Actionable items come first among the model's spans, in the order of their stops; Clear finished keeps its own line.
    const span = stop.isItem ? layout.spans[item++] : undefined
    return { ...stop, main: Math.max(0, tones.findIndex(t => t !== 'quiet')), first: span?.first ?? stop.first, last: span?.last ?? stop.last }
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

// What a focused pane marks: the button the keys selected, and the lines of the item it belongs to.
export type KitFocus = ListFocus<PaneMessage>

// The Client's half: the window's rows laid out, each ending in its scroll bar cell.
// The button the keys selected takes the kit's selected look, and its item carries a rail in the gutter.
export function viewLines(view: KitView, width: number, focus: KitFocus = {}): L[] {
  const room = roomOf(width)
  const shown = view.rows.flatMap(row => rowLines(row, room)).slice(view.skip, view.skip + view.windowRows)
  const bar = scrollBar<PaneMessage>(view.windowRows, view.total, view.top)
  return windowLines({ shown, top: view.top, width, gutter: GUTTER, bar, barCells: BAR, focus })
}
