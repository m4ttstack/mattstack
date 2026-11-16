import { cellWidth } from '../draw/cells'
import { sp, type Line, type Span } from '../draw/text'
import { QUIET, keySelected, pressed } from '../draw/theme'

export type NumberedRowsSpec<A> = {
  labels: string[]
  // The row the keys are on.
  selected: number
  // Without focus no row is marked, as a pane the keys are not in shows no selection.
  focused: boolean
  // A key's activation of the selected row is showing (KitUi `keyPressing`): that row draws pressed, as a click's would.
  pressing?: boolean
  indent?: number
  actionFor: (idx: number) => A
}

// Numbered answers, one per row, the way a permission prompt lists `1. Yes / 2. No`. Every row is a quiet control, so
// the pointer lights it; the keyed row also rests on the quiet fill with the ▎ edge. A row is one width with the widest.
export function numberedRows<A>(spec: NumberedRowsSpec<A>): Line<A>[] {
  const lead = sp<A>(' '.repeat(spec.indent ?? 3))
  const widest = Math.max(0, ...spec.labels.map(cellWidth))
  return spec.labels.map((label, idx): Line<A> => {
    const isKeyed = spec.focused && idx === spec.selected
    const look = isKeyed ? { quiet: true, bg: QUIET.rest, color: QUIET.label } : { quiet: true }
    const action = spec.actionFor(idx)
    const number: Span<A> = sp(` ${idx + 1}`, { ...look, dim: true, action })
    const text: Span<A> = sp(`  ${label}${' '.repeat(widest - cellWidth(label) + 2)}`, { ...look, action })
    if (!isKeyed) return [lead, number, text]
    const [n, t] = spec.pressing ? [pressed(number), pressed(text)] : [number, text]
    return [lead, ...keySelected(n), t]
  })
}
