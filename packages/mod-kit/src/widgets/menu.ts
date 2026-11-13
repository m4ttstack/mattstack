import { cellWidth, cutCells, padCells } from '../draw/cells'
import { sp, type Line, type Span } from '../draw/text'
import { ACCENT, GRAY, keySelected } from '../draw/theme'
import { buttonSpan } from './buttons'

// A row with `rows` opens a sub-list instead of being picked; only rows without `rows` are picked, by `id`.
export type MenuRow = { id: string; label: string; rows?: MenuRow[] }

// `sub` is the cursor in the selected row's sub-list, present only while that sub-list is open.
export type MenuState = { open: boolean; selected: number; sub?: number }

export type MenuHit = { type: 'toggle' } | { type: 'row'; path: number[] }

export type MenuSpec<A = MenuHit> = MenuState & {
  label: string
  rows: MenuRow[]
  // The cells the rows may take; absent, no limit.
  width?: number
  // The column the button starts at on its row; the rows hang from it.
  indent?: number
  // The keyboard has the button selected.
  isSelected?: boolean
  actionFor?: (hit: MenuHit) => A
}

export type MenuMove = { state: MenuState; picked?: string }

export const MORE_ACTIONS = 'More actions ▾'

const SUB_MARK = ' ▸'
const GAP = 2
const CONNECTOR = 2

const labelOf = (row: MenuRow) => (row.rows ? `${row.label}${SUB_MARK}` : row.label)
const cut = (text: string, room: number) => (cellWidth(text) <= room ? text : `${cutCells(text, Math.max(0, room - 1))}…`)
const closed = (state: MenuState): MenuState => ({ open: false, selected: state.selected })
const wrapAt = (n: number, count: number) => (n + count) % count

// One quiet button; open, its rows hang under it, and the selected row's sub-list opens to its right,
// or under it when the row is too narrow for both.
export function menu<A = MenuHit>(spec: MenuSpec<A>): Line<A>[] {
  const act = spec.actionFor ?? ((hit: MenuHit) => hit as A)
  const indent = spec.indent ?? 0
  const button = buttonSpan<A>({ label: spec.label, action: act({ type: 'toggle' }), tone: 'quiet' })
  const head: Line<A> = [sp(' '.repeat(indent)), ...(spec.isSelected ? keySelected(button) : [button])]
  if (!spec.open || spec.rows.length === 0) return [head]

  const width = spec.width ?? Number.POSITIVE_INFINITY
  const labels = spec.rows.map(labelOf)
  const widest = Math.max(...labels.map(cellWidth))
  const at = Math.max(0, Math.min(indent, width - CONNECTOR - widest))
  const room = Math.max(1, width - at - CONNECTOR)
  const column = Math.min(widest, room)
  const lead = sp<A>(' '.repeat(at))
  const subs = spec.sub === undefined ? [] : (spec.rows[spec.selected]?.rows ?? [])
  const subWidest = Math.max(0, ...subs.map(row => cellWidth(row.label)))
  const isBeside = at + CONNECTOR + column + GAP + subWidest <= width

  const rowLine = (i: number): Line<A> => {
    const isLast = i === spec.rows.length - 1
    const look = i === spec.selected ? { ...ACCENT, bold: true } : {}
    const text = cut(labels[i]!, column)
    return [lead, sp(isLast ? '└ ' : '├ ', GRAY), sp(isBeside && subs.length > 0 ? padCells(text, column) : text, { ...look, action: act({ type: 'row', path: [i] }) })]
  }
  const subSpan = (row: MenuRow, j: number, cells: number): Span<A> =>
    sp(padCells(cut(row.label, cells), cells), { ...(j === spec.sub ? { ...ACCENT, bold: true } : {}), action: act({ type: 'row', path: [spec.selected, j] }) })

  const lines: Line<A>[] = spec.rows.map((_, i) => rowLine(i))
  if (subs.length > 0 && isBeside) {
    const blank = sp<A>(' '.repeat(CONNECTOR + column))
    subs.forEach((row, j) => {
      const k = spec.selected + j
      const left = lines[k] ?? [lead, blank]
      lines[k] = [...left, sp(' '.repeat(GAP)), subSpan(row, j, subWidest)]
    })
  } else if (subs.length > 0) {
    const isLastParent = spec.selected === spec.rows.length - 1
    const under = [lead, sp<A>(isLastParent ? '  ' : '│ ', GRAY), sp<A>('  ')]
    const cells = Math.max(1, Math.min(subWidest, width - at - CONNECTOR - 2))
    lines.splice(spec.selected + 1, 0, ...subs.map((row, j): Line<A> => [...under, subSpan(row, j, cells)]))
  }
  return [head, ...lines]
}

// Enter opens a closed menu; open, the arrows move, right or Enter opens a sub-list, left leaves it,
// Enter picks, and Escape closes. Undefined for a key the menu leaves alone.
export function menuKey(state: MenuState, rows: MenuRow[], key: string): MenuMove | undefined {
  const isEnter = key === 'return' || key === 'enter'
  if (!state.open) return isEnter && rows.length > 0 ? { state: { open: true, selected: 0 } } : undefined
  if (key === 'escape' || key === 'esc') return { state: closed(state) }
  const row = rows[state.selected]
  const subs = row?.rows ?? []
  if (state.sub !== undefined) {
    if (key === 'up' || key === 'down') return { state: { ...state, sub: wrapAt(state.sub + (key === 'up' ? -1 : 1), subs.length) } }
    if (key === 'left') return { state: { open: true, selected: state.selected } }
    if (isEnter) return { state: closed(state), picked: subs[state.sub]?.id }
    return undefined
  }
  if (key === 'up' || key === 'down') return { state: { open: true, selected: wrapAt(state.selected + (key === 'up' ? -1 : 1), rows.length) } }
  if ((isEnter || key === 'right') && subs.length > 0) return { state: { open: true, selected: state.selected, sub: 0 } }
  if (isEnter && row) return { state: closed(state), picked: row.id }
  return undefined
}

// A click: the button opens or closes the menu, a row with rows opens its sub-list, any other row is picked.
export function menuHit(state: MenuState, rows: MenuRow[], hit: MenuHit): MenuMove {
  if (hit.type === 'toggle') return { state: state.open ? closed(state) : { open: true, selected: 0 } }
  const [i = 0, j] = hit.path
  const row = rows[i]
  if (j !== undefined) return { state: { open: false, selected: i }, picked: row?.rows?.[j]?.id }
  if (row?.rows && row.rows.length > 0) return { state: { open: true, selected: i, sub: 0 } }
  return { state: { open: false, selected: i }, picked: row?.id }
}
