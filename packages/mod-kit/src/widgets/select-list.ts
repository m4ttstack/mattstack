import { hang, sp, widthOf, withAction, type Line, type Span } from '../draw/text'
import { ACCENT, DIM, DONE, ICON, SYMBOL } from '../draw/theme'
import { inputField } from './input-field'

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

// The label stays put; the row under it is the description until the choice is focused, then the line you type on,
// with the description as its placeholder. Typed text shows in that row once you move off.
function writeInRows<A>(choice: Choice, isAt: boolean, lead: Span<A>[], under: Span<A>[], spec: SelectSpec<A>): Line<A>[] {
  const label = [...lead, sp(`${ICON.edit} `, ACCENT), sp(choice.label, { isLabel: true, ...(isAt && { bold: true }) })]
  const typed = spec.writeIn
  if (isAt) return [label, [...under, ...inputField(typed, choice.description ?? '', spec.width - widthOf(under), spec.focused)]]
  if (typed !== '') return [label, [...under, sp(`“${typed}”`)]]
  return [label, ...(choice.description ? [[...under, sp(choice.description, DIM)]] : [])]
}
