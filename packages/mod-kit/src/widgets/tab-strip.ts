import { cellWidth, cutCells } from '../draw/cells'
import { sp, widthOf, type Line, type Span } from '../draw/text'
import { DIM, DONE, FILL, GRAY, rail } from '../draw/theme'

export type Tab<A> = { label: string; mark?: string; isDone: boolean; action: A }

export type TabStripSpec<A> = {
  tabs: Tab<A>[]
  current: number
  width: number
  // The first tab shown; the strip stays put while the current tab is in view.
  from: number
  scrollTo: (from: number) => A
}

type TabWindow = { lo: number; hi: number }

// Grows a window from one tab, toward `first` while tabs fit, then the other way.
function fillWindow(seed: number, first: 'left' | 'right', count: number, room: number, cost: (k: number) => number): TabWindow {
  let lo = seed
  let hi = seed
  let used = cost(seed)
  const right = () => hi + 1 < count && used + cost(hi + 1) <= room && ((used += cost(++hi)), true)
  const left = () => lo > 0 && used + cost(lo - 1) <= room && ((used += cost(--lo)), true)
  while (first === 'right' ? right() || left() : left() || right());
  return { lo, hi }
}

// A label wider than the strip's room is cut with an ellipsis, so the seed tab always fits and the right mark stays at the edge.
function tabText(tab: Tab<unknown> | undefined, room: number): string {
  if (!tab) return ''
  const text = tab.mark ? `${tab.mark} ${tab.label}` : tab.label
  const limit = Math.max(1, room - 2)
  return cellWidth(text) <= limit ? text : `${cutCells(text, limit - 1)}…`
}

// Each scroll mark takes a fixed width, so the tabs never shift as the counts change.
const MARK_WIDTH = 5
// The rail (3), both marks, and a space after the left one and before the right one.
const STRIP_CHROME = 3 + 2 * MARK_WIDTH + 2
const CHIP = { ...FILL.chip, bold: true }

// A scroll mark: a filled chip while tabs hide that way, an unfilled dim one once none do.
function scrollMark<A>(side: 'left' | 'right', hidden: number, action: A): Span<A> {
  const arrow = side === 'left' ? '‹' : '›'
  const label = hidden === 0 ? ` ${arrow} ` : side === 'left' ? ` ${arrow} ${hidden} ` : ` ${hidden} ${arrow} `
  const text = side === 'left' ? label.padEnd(MARK_WIDTH) : label.padStart(MARK_WIDTH)
  return hidden > 0 ? sp(text, { ...CHIP, action }) : sp(text, DIM)
}

function windowFiller(tabs: Tab<unknown>[], width: number) {
  const room = width - STRIP_CHROME
  const cost = (k: number) => cellWidth(tabText(tabs[k], room)) + 2
  return (seed: number, first: 'left' | 'right') => fillWindow(Math.max(0, Math.min(tabs.length - 1, seed)), first, tabs.length, room, cost)
}

// Where the strip should start so the current tab shows: where it already is while that holds,
// else a windowful on, starting at the current tab (or back, ending at it).
export function revealTab(tabs: Tab<unknown>[], current: number, width: number, from: number): number {
  const fill = windowFiller(tabs, width)
  const shown = fill(from, 'right')
  if (current > shown.hi) return fill(current, 'right').lo
  if (current < shown.lo) return fill(current, 'left').lo
  return shown.lo
}

// When the tabs overflow the row, a window of them shows, with a count of the hidden ones either side,
// the right one pinned to the strip's right edge. A count scrolls the strip one tab that way; the current tab stays where it was.
export function tabStrip<A>(spec: TabStripSpec<A>): Line<A> {
  const { tabs, current } = spec
  const fill = windowFiller(tabs, spec.width)
  const { lo, hi } = fill(spec.from, 'right')

  const line: Line<A> = [...rail<A>(GRAY), scrollMark('left', lo, spec.scrollTo(lo - 1)), sp(' ')]
  for (let k = lo; k <= hi; k += 1) {
    const tab = tabs[k]
    if (!tab) continue
    const look = k === current ? FILL.current : tab.isDone ? DONE : DIM
    line.push(sp(` ${tabText(tab, spec.width - STRIP_CHROME)} `, { ...look, action: tab.action }))
  }
  const after = tabs.length - 1 - hi
  line.push(sp(' '.repeat(Math.max(1, spec.width - widthOf(line) - MARK_WIDTH))), scrollMark('right', after, spec.scrollTo(lo + 1)))
  return line
}
