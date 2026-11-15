import { cellWidth, cutCells } from '../draw/cells'
import { sp, widthOf, type Line } from '../draw/text'
import { BRAND, SYMBOL } from '../draw/theme'
import type { GridRow } from '../interact/grid'
import { gridLook } from '../interact/grid'
import { buttonRow, type Button } from '../widgets/buttons'

// A list taller than its window, drawn a window at a time beside a scroll bar, with keyboard stops over its buttons.

// A grid row placed in the list: `lines` is the line each button is on, `first`/`last` the lines the stop covers.
export type WindowStop<Id> = GridRow<Id> & { lines: number[]; first: number; last: number }
// The window's first line, the list's length in lines, the window's height, and the stops.
export type ScrollWindow<Id> = { top: number; total: number; windowRows: number; stops: WindowStop<Id>[] }

export const maxScroll = (total: number, windowRows: number): number => Math.max(0, total - windowRows)

// The offset that shows a stop whole, moving the window as little as it can; the window's own while the stop shows already.
export function revealOffset<Id>(view: ScrollWindow<Id>, index: number): number {
  const stop = view.stops[index]
  const most = maxScroll(view.total, view.windowRows)
  if (!stop) return view.top
  if (stop.first < view.top) return Math.max(0, stop.first)
  // A stop taller than the window shows its top.
  if (stop.last > view.top + view.windowRows - 1) return Math.min(most, Math.min(stop.first, stop.last - view.windowRows + 1))
  return view.top
}

// Whether a stop's button at `col` is on screen: what Enter needs, since a stop taller than the window never shows whole.
export function isButtonInView<Id>(view: ScrollWindow<Id>, index: number, col: number): boolean {
  const line = view.stops[index]?.lines[col]
  return line !== undefined && line >= view.top && line <= view.top + view.windowRows - 1
}

// The offset that shows a stop's button at `col`, moving the window as little as it can.
export function revealButtonOffset<Id>(view: ScrollWindow<Id>, index: number, col: number): number {
  const line = view.stops[index]?.lines[col]
  if (line === undefined || isButtonInView(view, index, col)) return view.top
  return line < view.top ? line : Math.min(maxScroll(view.total, view.windowRows), line - view.windowRows + 1)
}

// The first of `lines` holding a span that posts `action` (compared as JSON), or -1.
export function lineOfAction<A>(lines: Line<A>[], action: A): number {
  const wanted = JSON.stringify(action)
  return lines.findIndex(line => line.some(span => span.action !== undefined && JSON.stringify(span.action) === wanted))
}

export const ellipsize = (text: string, cells: number): string => (cellWidth(text) <= cells ? text : `${cutCells(text, Math.max(0, cells - 1))}…`)

// A last guard: the line cut and padded to exactly `cells`, however its pieces measured.
export function clipLine<A>(line: Line<A>, cells: number): Line<A> {
  const out: Line<A> = []
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

// Buttons after an optional lead, carried onto more rows as the room runs out. The first row carries the lead; rows carried on
// start at the indent with the whole room, so a button too wide to sit beside the lead still fits whole. A lead with no room
// for even one button beside it takes a row of its own.
export function wrappedButtons<A>(lead: Line<A>, buttons: Button<A>[], room: number, indent: number): Line<A>[] {
  const pad = sp<A>(' '.repeat(indent))
  let rest = buttons
  const out: Line<A>[] = []
  let withLead = lead.length > 0
  while (rest.length > 0) {
    // One cell between the lead and its buttons; none at the indent.
    const leadIn = withLead ? 1 : 0
    const avail = Math.max(1, room - widthOf([pad, ...(withLead ? lead : [])]))
    const draw = (some: Button<A>[]) => buttonRow(some, undefined, avail, leadIn)
    let n = rest.length
    while (n > 0 && widthOf(draw(rest.slice(0, n))) > avail) n--
    if (n === 0 && withLead) {
      out.push([pad, ...lead])
      withLead = false
      continue
    }
    n = Math.max(1, n)
    out.push([pad, ...(withLead ? lead : []), ...draw(rest.slice(0, n))])
    rest = rest.slice(n)
    withLead = false
  }
  return out
}

// What a focused list marks: the button the keys selected (its action), and the lines of the stop it belongs to.
// `marked` is keyboard mode: the selected button's edge, the stop's rail and its lead glyph show only then.
// `pressing` draws the selected button pressed while a key activates it.
export type ListFocus<A> = { selected?: A; range?: { first: number; last: number }; marked?: boolean; pressing?: boolean }

export type WindowSpec<A> = {
  // The window's lines, already cut to it; `top` is the first one's line in the whole list.
  shown: Line<A>[]
  top: number
  width: number
  // The cells left of each line for the rail, and the scroll bar's lines and cells on the right.
  gutter: number
  bar: Line<A>[]
  barCells: number
  focus?: ListFocus<A>
  // The glyph that leads a stop's first line, which turns pink while the stop is marked.
  leadGlyph?: string
}

// The stop's lead glyph turns pink on its first line.
function markLead<A>(line: Line<A>, glyph: string): Line<A> {
  const at = line.findIndex(span => span.t.startsWith(`${glyph} `))
  if (at < 0) return line
  const span = line[at]!
  return [...line.slice(0, at), { ...span, t: glyph, color: BRAND.pink }, { ...span, t: span.t.slice(glyph.length) }, ...line.slice(at + 1)]
}

// The window's lines, each in its gutter and ending in its scroll bar cells. The selected button takes the kit's selected
// look, and its stop carries the pink rail in the gutter, which fills it exactly, so rows keep their place as the selection moves.
export function windowLines<A>(spec: WindowSpec<A>): Line<A>[] {
  const focus = spec.focus ?? {}
  const chosen = focus.selected === undefined ? undefined : JSON.stringify(focus.selected)
  const range = focus.marked ? focus.range : undefined
  const rail: Line<A> = [sp(SYMBOL.bar, { color: BRAND.pink }), sp(' '.repeat(Math.max(0, spec.gutter - 1)))]
  const plain: Line<A> = [sp(' '.repeat(spec.gutter))]
  return spec.shown.map((line, n) => {
    const at = spec.top + n
    const lit = chosen ? line.flatMap(span => (span.action !== undefined && JSON.stringify(span.action) === chosen ? gridLook(span, focus) : [span])) : line
    const lead = range && at === range.first && spec.leadGlyph ? markLead(lit, spec.leadGlyph) : lit
    const gutter = range && at >= range.first && at <= range.last ? rail : plain
    return [...clipLine([...gutter, ...lead], spec.width - spec.barCells), ...(spec.bar[n] ?? [])]
  })
}
