import { hang, sp, widthOf, withAction, type Line, type Span } from '../draw/text'
import { ACCENT, CURSOR_ROW, DIM, DONE, SYMBOL } from '../draw/theme'
import { inputField } from './input-field'

export type Choice = { label: string; description?: string; isWriteIn?: boolean }

export type SelectSpec<A> = {
  choices: Choice[]
  cursor: number
  multi: boolean
  // What is picked, apart from where the cursor is: a single choice's ●, a multi choice's ticked box.
  isPicked: (idx: number) => boolean
  // A single choice's pick that is only a default so far (not yet accepted): its ● draws dim instead of green.
  isDefault?: (idx: number) => boolean
  writeIn: string
  width: number
  focused: boolean
  actionFor: (idx: number) => A
  maxShown?: number
  // false drops the clack rail down the left, for a surface that sets its sections apart another way.
  rail?: boolean
  // A blank row between choices, for a list with room to breathe.
  spaced?: boolean
  // A key's activation of the cursor's choice is showing (KitUi `keyPressing`): its row draws pressed, as a click's would.
  pressing?: boolean
}

// Clack's select and multiselect: a window of choices around the cursor, each wrapped in full. While the list is focused
// the cursor's choice has a ❯ in its gutter and a tinted row, apart from the pick, so moving never looks like picking.
export function selectList<A>(spec: SelectSpec<A>): Line<A>[] {
  const max = spec.maxShown ?? 8
  const total = spec.choices.length
  const start = total <= max ? 0 : Math.min(Math.max(0, spec.cursor - Math.floor(max / 2)), total - max)
  const shown = spec.choices.slice(start, start + max)
  const bar = sp<A>(spec.rail === false ? '' : SYMBOL.bar, ACCENT)
  const lines: Line<A>[] = []
  // Every choice takes at least two rows, its description's row left blank when it has none, so every list keeps one rhythm.
  // A blank row keeps a space after the rail, since the engine drops a line with no text when there is no rail.
  const blank = (): Line<A> => [bar, sp(' ')]
  const padded = (rows: Line<A>[]) => [...rows, ...Array.from({ length: Math.max(0, 2 - rows.length) }, blank)]
  if (start > 0) lines.push([bar, sp(`  ↑ ${start} more`, DIM)])
  shown.forEach((choice, n) => {
    const idx = start + n
    if (spec.spaced && n > 0) lines.push(blank())
    const rows = choice.isWriteIn ? choiceRows(choice, idx, spec) : padded(choiceRows(choice, idx, spec))
    lines.push(...withAction(isCursorRow(spec, idx) ? rows.map(line => tinted(line, spec.width, CURSOR_ROW)) : rows.map(line => hoverTinted(line, spec.width)), spec.actionFor(idx)))
  })
  const below = total - start - shown.length
  if (below > 0) lines.push([bar, sp(`  ↓ ${below} more`, DIM)])
  return lines
}

function choiceMark(spec: SelectSpec<unknown>, idx: number): Span<never> {
  const isPicked = spec.isPicked(idx)
  if (!spec.multi) return isPicked ? sp(SYMBOL.radioOn, spec.isDefault?.(idx) ? DIM : DONE) : sp(SYMBOL.radioOff, DIM)
  return isPicked ? sp(SYMBOL.boxOn, DONE) : sp(SYMBOL.boxOff, DIM)
}

const isCursorRow = (spec: SelectSpec<unknown>, idx: number) => spec.focused && idx === spec.cursor

function choiceRows<A>(choice: Choice, idx: number, spec: SelectSpec<A>): Line<A>[] {
  const bar = sp<A>(spec.rail === false ? '' : SYMBOL.bar, ACCENT)
  const isAt = isCursorRow(spec, idx)
  // A box glyph draws wider than its cell in many fonts and runs into the space after it, so a box gets two.
  const gap = spec.multi ? '  ' : ' '
  const lead = [bar, isAt ? sp(`${SYMBOL.selectEdge} `, { bold: true }) : sp('  '), choiceMark(spec, idx), sp(gap)]
  const under = [bar, sp(`   ${gap}`)]
  const rows = choiceLines(choice, idx, spec, lead, under)
  return rows
}

// The cursor's row, tinted from after the rail to the list's right edge; a span with its own fill (the write-in field) keeps it.
function tinted<A>(line: Line<A>, width: number, fill: string): Line<A> {
  const [rail, ...rest] = line
  const filled = rest.map(span => (span.bg ? span : { ...span, bg: fill, rowTint: true }))
  const room = Math.max(0, width - widthOf(line))
  return [rail!, ...filled, ...(room > 0 ? [sp<A>(' '.repeat(room), { bg: fill, rowTint: true })] : [])]
}

// A choice the pointer is over looks like the cursor's: its rows carry the row tint for the renderer to show on hover,
// padded to the list's edge so the tint spans the row.
function hoverTinted<A>(line: Line<A>, width: number): Line<A> {
  const [rail, ...rest] = line
  const room = Math.max(0, width - widthOf(line))
  return [rail!, ...rest.map(span => ({ ...span, rowTint: true })), ...(room > 0 ? [sp<A>(' '.repeat(room), { rowTint: true })] : [])]
}

function choiceLines<A>(choice: Choice, idx: number, spec: SelectSpec<A>, lead: Span<A>[], under: Span<A>[]): Line<A>[] {
  const isAt = idx === spec.cursor
  if (choice.isWriteIn) return writeInRows(choice, isAt, lead, under, spec)
  // Every choice wraps in full, label and description: a cut description hides what the choice means.
  return [...hang(lead, under, choice.label, spec.width, { isLabel: true, ...(isCursorRow(spec, idx) && { bold: true }) }), ...(choice.description ? hang(under, under, choice.description, spec.width, DIM) : [])]
}

// One row, as Claude Code draws it: the label is the placeholder, and with the cursor on it you type in that row.
// Typed text shows there once you move off.
function writeInRows<A>(choice: Choice, isAt: boolean, lead: Span<A>[], under: Span<A>[], spec: SelectSpec<A>): Line<A>[] {
  const typed = spec.writeIn
  // The field opens with a pad cell of its own, so it takes the place of the space after the mark.
  const fieldLead = lead.slice(0, -1)
  if (isAt) return [[...fieldLead, ...inputField(typed, choice.label, spec.width - widthOf(fieldLead), spec.focused)]]
  if (typed !== '') return hang(lead, under, typed, spec.width, {})
  return hang(lead, under, choice.label, spec.width, { ...DIM, isLabel: true })
}
