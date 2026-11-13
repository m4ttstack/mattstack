import { cellWidth, cutCells } from '../draw/cells'
import { sp, widthOf, type Line, type Span, type Style } from '../draw/text'
import { FILL } from '../draw/theme'

// Every button is a filled block; its tone picks the fill. A disabled one keeps its place and shape but takes no clicks.
export type ButtonTone = 'primary' | 'secondary' | 'neutral' | 'caution' | 'brand'
export type Button<A> = { label: string; action: A; tone?: ButtonTone; disabled?: boolean }

const TONE_FILL: Record<ButtonTone, Style> = { primary: FILL.primary, secondary: FILL.secondary, neutral: FILL.neutral, caution: FILL.caution, brand: FILL.brand }

type Spacing = { indent: number; pad: number; gap: number }
const ROOMY: Spacing = { indent: 3, pad: 2, gap: 2 }
const COMPACT: Spacing = { indent: 1, pad: 1, gap: 1 }

export function buttonSpan<A>(button: Button<A>, pad = ROOMY.pad): Span<A> {
  const fill = button.disabled ? FILL.disabled : TONE_FILL[button.tone ?? 'secondary']
  const edge = ' '.repeat(pad)
  return sp(`${edge}${button.label}${edge}`, { ...fill, bold: !button.disabled, ...(!button.disabled && { action: button.action }) })
}

const widthWith = (left: Button<unknown>[], right: Button<unknown> | undefined, { indent, pad, gap }: Spacing) =>
  indent + left.reduce((n, button) => n + cellWidth(button.label) + 2 * pad + gap, 0) + (right ? gap + cellWidth(right.label) + 2 * pad : 0)

// A label cut to `room` cells, ending in an ellipsis.
const cut = (label: string, room: number) => (cellWidth(label) <= room ? label : `${cutCells(label, Math.max(0, room - 1))}…`)

// Buttons for mouse users: `left` from the indent, `right` against the far edge.
// A pane too narrow for the roomy layout tightens the padding and gaps, then cuts the right button's label.
export function buttonRow<A>(left: Button<A>[], right: Button<A> | undefined, width: number): Line<A> {
  const space = widthWith(left, right, ROOMY) <= width ? ROOMY : COMPACT
  const line: Line<A> = [sp(' '.repeat(space.indent))]
  for (const button of left) line.push(buttonSpan(button, space.pad), sp(' '.repeat(space.gap)))
  if (!right) return line
  const room = width - widthOf(line) - space.gap - 2 * space.pad
  const end = buttonSpan({ ...right, label: cut(right.label, Math.max(1, room)) }, space.pad)
  line.push(sp(' '.repeat(Math.max(space.gap, width - widthOf(line) - cellWidth(end.t)))), end)
  return line
}
