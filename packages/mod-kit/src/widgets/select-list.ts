import { hang, sp, widthOf, withAction, type Line, type Span } from '../draw/text'
import { ACCENT, CURSOR_ROW, DIM, DONE, ICON, SYMBOL, pressed } from '../draw/theme'
import { inputField } from './input-field'

export type Choice = { label: string; description?: string; isWriteIn?: boolean }

export type SelectSpec<A> = {
  choices: Choice[]
  cursor: number
  multi: boolean
  // What is picked, apart from where the cursor is: a single choice's ●, a multi choice's ticked box.
  isPicked: (idx: number) => boolean
  writeIn: string
  width: number
  focused: boolean
  actionFor: (idx: number) => A
  maxShown?: number
  // false drops the clack rail down the left, for a surface that sets its sections apart another way.
  rail?: boolean
  // A blank row between choices, for a list with room to breathe.
  spaced?: boolean
  // A key's activation of the cursor's choice is showing (KitUi `keyPressing`): its label draws pressed, as a click's would.
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
    const rows = padded(choiceRows(choice, idx, spec))
    lines.push(...withAction(isCursorRow(spec, idx) ? rows.map(line => tinted(line, spec.width)) : rows, spec.actionFor(idx)))
  })
  const below = total - start - shown.length
  if (below > 0) lines.push([bar, sp(`  ↓ ${below} more`, DIM)])
  return lines
}

function choiceMark(spec: SelectSpec<unknown>, idx: number): Span<never> {
  const isPicked = spec.isPicked(idx)
  if (!spec.multi) return isPicked ? sp(SYMBOL.radioOn, DONE) : sp(SYMBOL.radioOff, DIM)
  return isPicked ? sp(SYMBOL.boxOn, DONE) : sp(SYMBOL.boxOff, DIM)
}

const isCursorRow = (spec: SelectSpec<unknown>, idx: number) => spec.focused && idx === spec.cursor

function choiceRows<A>(choice: Choice, idx: number, spec: SelectSpec<A>): Line<A>[] {
  const bar = sp<A>(spec.rail === false ? '' : SYMBOL.bar, ACCENT)
  const isAt = isCursorRow(spec, idx)
  const lead = [bar, isAt ? sp(`${SYMBOL.selectEdge} `, { bold: true }) : sp('  '), choiceMark(spec, idx), sp(' ')]
  const under = [bar, sp('    ')]
  const rows = choiceLines(choice, idx, spec, lead, under)
  return isAt && spec.pressing ? rows.map(line => line.map(span => ((span as { isLabel?: boolean }).isLabel ? pressed(span) : span))) : rows
}

// The cursor's row, tinted from after the rail to the list's right edge; a span with its own fill (the write-in field) keeps it.
function tinted<A>(line: Line<A>, width: number): Line<A> {
  const [rail, ...rest] = line
  const filled = rest.map(span => (span.bg ? span : { ...span, bg: CURSOR_ROW }))
  const room = Math.max(0, width - widthOf(line))
  return [rail!, ...filled, ...(room > 0 ? [sp<A>(' '.repeat(room), { bg: CURSOR_ROW })] : [])]
}

function choiceLines<A>(choice: Choice, idx: number, spec: SelectSpec<A>, lead: Span<A>[], under: Span<A>[]): Line<A>[] {
  const isAt = idx === spec.cursor
  if (choice.isWriteIn) return writeInRows(choice, isAt, lead, under, spec)
  // Every choice wraps in full, label and description: a cut description hides what the choice means.
  return [...hang(lead, under, choice.label, spec.width, { isLabel: true, ...(isCursorRow(spec, idx) && { bold: true }) }), ...(choice.description ? hang(under, under, choice.description, spec.width, DIM) : [])]
}

// The label stays put; the row under it is the description until the choice is focused, then the line you type on,
// with the description as its placeholder. Typed text shows in that row once you move off.
function writeInRows<A>(choice: Choice, isAt: boolean, lead: Span<A>[], under: Span<A>[], spec: SelectSpec<A>): Line<A>[] {
  const label = [...lead, sp(`${ICON.edit} `, ACCENT), sp(choice.label, { isLabel: true, ...(isAt && { bold: true }) })]
  const typed = spec.writeIn
  // The field opens with a pad cell of its own, so the indent gives one up and the text stays where the description was.
  const fieldLead = [...under.slice(0, -1), sp<A>(under[under.length - 1]!.t.slice(1))]
  if (isAt) return [label, [...fieldLead, ...inputField(typed, choice.description ?? '', spec.width - widthOf(fieldLead), spec.focused)]]
  if (typed !== '') return [label, ...hang(under, under, `“${typed}”`, spec.width, {})]
  return [label, ...(choice.description ? hang(under, under, choice.description, spec.width, DIM) : [])]
}
