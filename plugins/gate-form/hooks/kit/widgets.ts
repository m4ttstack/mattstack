import { ACCENT, BRAND, DIM, DONE, FILL, GRAY, ICON, PLACEHOLDER, SYMBOL, rail } from './theme'
import { hang, sp, widthOf, withAction, type Line, type Span, type Style } from './text'

// The mattstack header every kit surface opens with: a full-width pink bar, plum lettering.
export function brandBar(label: string, width: number): Line<never> {
  const text = `  ${BRAND.glyph}  ${label}`
  return [sp(text.padEnd(width), { bg: BRAND.pink, color: BRAND.plum, bold: true })]
}

export function textCursor(value: string, placeholder: string, showCursor: boolean): Span<never>[] {
  if (!showCursor) return value === '' ? [sp(placeholder, DIM)] : [sp(value)]
  if (value === '') return [sp(placeholder.slice(0, 1), { inverse: true }), sp(placeholder.slice(1), DIM)]
  return [sp(value), sp(' ', { inverse: true })]
}

// A filled box `width` cells wide, a cell of padding each side, that scrolls to keep the end of the text in view.
export function inputField(value: string, placeholder: string, width: number, showCursor: boolean): Span<never>[] {
  const room = width - 2
  const box = (spans: Span<never>[]): Span<never>[] => [
    sp(' ', FILL.field),
    ...spans.map(span => ({ ...span, bg: FILL.field.bg })),
    sp(' '.repeat(Math.max(0, width - 1 - widthOf(spans))), FILL.field),
  ]
  if (value === '') {
    const hint = placeholder.slice(0, room)
    return box([sp(hint.slice(0, 1) || ' ', showCursor ? { ...PLACEHOLDER, inverse: true } : PLACEHOLDER), sp(hint.slice(1), PLACEHOLDER)])
  }
  const shown = value.length >= room ? value.slice(value.length - room + 1) : value
  return box([sp(shown, { color: FILL.field.color }), ...(showCursor ? [sp(' ', { color: FILL.field.color, inverse: true })] : [])])
}

export type Choice = { label: string; description?: string; isWriteIn?: boolean }

export type SelectSpec<A> = {
  choices: Choice[]
  cursor: number
  multi: boolean
  isPicked: (idx: number) => boolean
  // A single choice draws its cursor as the chosen ● only when resting there counts as choosing it.
  cursorIsChoice: boolean
  writeIn: string
  width: number
  focused: boolean
  actionFor: (idx: number) => A
  maxShown?: number
}

// Clack's select and multiselect: a window of choices around the cursor, the focused one in full and the rest cut to a row each for label and description.
export function selectList<A>(spec: SelectSpec<A>): Line<A>[] {
  const max = spec.maxShown ?? 8
  const total = spec.choices.length
  const start = total <= max ? 0 : Math.min(Math.max(0, spec.cursor - Math.floor(max / 2)), total - max)
  const shown = spec.choices.slice(start, start + max)
  const bar = sp<A>(SYMBOL.bar, ACCENT)
  const lines: Line<A>[] = []
  // Every choice takes at least two rows, its description's row left blank when it has none, so every list keeps one rhythm.
  const padded = (rows: Line<A>[]) => [...rows, ...Array.from({ length: Math.max(0, 2 - rows.length) }, (): Line<A> => [bar])]
  if (start > 0) lines.push([bar, sp(`  ↑ ${start} more`, DIM)])
  shown.forEach((choice, n) => lines.push(...withAction(padded(choiceRows(choice, start + n, spec)), spec.actionFor(start + n))))
  const below = total - start - shown.length
  if (below > 0) lines.push([bar, sp(`  ↓ ${below} more`, DIM)])
  return lines
}

function choiceMark(spec: SelectSpec<unknown>, idx: number): Span<never> {
  const isAt = idx === spec.cursor
  if (!spec.multi) return isAt ? (spec.cursorIsChoice ? sp(SYMBOL.radioOn, DONE) : sp(SYMBOL.radioOff, ACCENT)) : sp(SYMBOL.radioOff, DIM)
  if (spec.isPicked(idx)) return sp(SYMBOL.boxOn, DONE)
  return isAt ? sp(SYMBOL.boxActive, ACCENT) : sp(SYMBOL.boxOff, DIM)
}

function choiceRows<A>(choice: Choice, idx: number, spec: SelectSpec<A>): Line<A>[] {
  const bar = sp<A>(SYMBOL.bar, ACCENT)
  const lead = [bar, sp('  '), choiceMark(spec, idx), sp(' ')]
  const under = [bar, sp('    ')]
  const isAt = idx === spec.cursor
  if (choice.isWriteIn) return writeInRows(choice, isAt, lead, under, spec)
  if (!isAt) return [[...lead, sp(choice.label, { isLabel: true })], ...(choice.description ? [[...under, sp(choice.description, DIM)]] : [])]
  return [...hang(lead, under, choice.label, spec.width, { bold: true, isLabel: true }), ...(choice.description ? hang(under, under, choice.description, spec.width, DIM) : [])]
}

const WRITE_IN_WIDTH = 48

// The label stays put; the row under it is the description until the choice is focused, then the line you type on,
// with the description as its placeholder. Typed text shows in that row once you move off.
function writeInRows<A>(choice: Choice, isAt: boolean, lead: Span<A>[], under: Span<A>[], spec: SelectSpec<A>): Line<A>[] {
  const label = [...lead, sp(`${ICON.edit} `, ACCENT), sp(choice.label, { isLabel: true, ...(isAt && { bold: true }) })]
  const typed = spec.writeIn
  if (isAt) return [label, [...under, ...inputField(typed, choice.description ?? '', Math.min(WRITE_IN_WIDTH, spec.width - 8), spec.focused)]]
  if (typed !== '') return [label, [...under, sp(`“${typed}”`)]]
  return [label, ...(choice.description ? [[...under, sp(choice.description, DIM)]] : [])]
}

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

const tabText = (tab: Tab<unknown>) => (tab.mark ? `${tab.mark} ${tab.label}` : tab.label)

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
  const cost = (k: number) => tabText(tabs[k]).length + 2
  return (seed: number, first: 'left' | 'right') => fillWindow(Math.max(0, Math.min(tabs.length - 1, seed)), first, tabs.length, width - STRIP_CHROME, cost)
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
  const text = (k: number) => tabText(tabs[k])
  const fill = windowFiller(tabs, spec.width)
  const { lo, hi } = fill(spec.from, 'right')

  const line: Line<A> = [...rail<A>(GRAY), scrollMark('left', lo, spec.scrollTo(lo - 1)), sp(' ')]
  for (let k = lo; k <= hi; k += 1) {
    const look = k === current ? FILL.current : tabs[k].isDone ? DONE : DIM
    line.push(sp(` ${text(k)} `, { ...look, action: tabs[k].action }))
  }
  const after = tabs.length - 1 - hi
  line.push(sp(' '.repeat(Math.max(1, spec.width - widthOf(line) - MARK_WIDTH))), scrollMark('right', after, spec.scrollTo(lo + 1)))
  return line
}

// Every button is a filled block; its tone picks the fill. A disabled one keeps its place and shape but takes no clicks.
export type ButtonTone = 'primary' | 'secondary' | 'neutral' | 'caution'
export type Button<A> = { label: string; action: A; tone?: ButtonTone; disabled?: boolean }

const TONE_FILL: Record<ButtonTone, Style> = { primary: FILL.primary, secondary: FILL.secondary, neutral: FILL.neutral, caution: FILL.caution }

function buttonSpan<A>(button: Button<A>): Span<A> {
  const fill = button.disabled ? FILL.disabled : TONE_FILL[button.tone ?? 'secondary']
  return sp(`  ${button.label}  `, { ...fill, bold: !button.disabled, ...(!button.disabled && { action: button.action }) })
}

// Buttons for mouse users: `left` from the indent, `right` against the far edge.
export function buttonRow<A>(left: Button<A>[], right: Button<A> | undefined, width: number): Line<A> {
  const line: Line<A> = [sp('   ')]
  for (const button of left) line.push(buttonSpan(button), sp('  '))
  if (!right) return line
  const end = buttonSpan(right)
  line.push(sp(' '.repeat(Math.max(2, width - widthOf(line) - end.t.length))), end)
  return line
}
