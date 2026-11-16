import { cellWidth } from '../draw/cells'
import { sp, type Line, type Span } from '../draw/text'
import { QUIET, keySelected, pressed } from '../draw/theme'

export type NumberedRowsSpec<A> = {
  labels: string[]
  // The row the keys are on. It stays marked when the pane loses focus; the unfocused look mutes it.
  selected: number
  // The numbers show only while the pane has the keys: without them a number reads as a key that does nothing.
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
    const isKeyed = idx === spec.selected
    const look = isKeyed ? { quiet: true, bg: QUIET.rest, color: QUIET.label } : { quiet: true }
    const action = spec.actionFor(idx)
    const number: Span<A> = sp(` ${spec.focused ? idx + 1 : ' '}`, { ...look, dim: true, action })
    const text: Span<A> = sp(`  ${label}${' '.repeat(widest - cellWidth(label) + 2)}`, { ...look, action })
    if (!isKeyed) return [lead, number, text]
    const [n, t] = spec.pressing ? [pressed(number), pressed(text)] : [number, text]
    return [lead, ...keySelected(n), t]
  })
}

export type NumberedRowsKey = { key: string; shift?: boolean; ctrl?: boolean; meta?: boolean }

// `picked`: the row the key answers. A number key also moves `selected` onto its row, so the caller can show the press
// there before it acts.
export type NumberedRowsMove = { selected: number; picked?: number }

// ↑↓ and Tab / Shift-Tab move between the rows and stop at the ends; Enter picks the selected row, a row's number picks
// that row. Undefined for a key the rows leave alone.
export function numberedRowsKey(selected: number, count: number, ev: NumberedRowsKey): NumberedRowsMove | undefined {
  if (ev.key === 'return' || ev.key === 'enter') return { selected, picked: selected }
  if (!ev.ctrl && !ev.meta && /^[1-9]$/.test(ev.key)) {
    const at = Number(ev.key) - 1
    return at < count ? { selected: at, picked: at } : undefined
  }
  const back = ev.key === 'up' || (ev.key === 'tab' && ev.shift === true)
  if (!back && ev.key !== 'down' && ev.key !== 'tab') return undefined
  return { selected: Math.max(0, Math.min(count - 1, selected + (back ? -1 : 1))) }
}
