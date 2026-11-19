import { cellWidth, cutCells } from '../draw/cells'
import { sp, type Line } from '../draw/text'
import { ACCENT, DIM, GRAY, markButtonAt, pressed } from '../draw/theme'
import { buttonSpan } from './buttons'

// A heading names the rows after it, which hang indented under it; it is drawn as a dim label and is never selected or picked.
export type MenuRow = { id: string; label: string; isHeading?: true }

export type MenuState = { open: boolean; selected: number }

export type MenuHit = { type: 'toggle' } | { type: 'row'; at: number }

export type MenuSpec<A = MenuHit> = MenuState & {
  label: string
  rows: MenuRow[]
  // The cells the rows may take; absent, no limit.
  width?: number
  // The column the button starts at on its row; the rows hang from it.
  indent?: number
  // The keyboard has the button selected.
  isSelected?: boolean
  // A key's activation of the selected row is showing (KitUi `keyPressing`): that row draws pressed, as a click's would.
  pressing?: boolean
  actionFor?: (hit: MenuHit) => A
}

export type MenuMove = { state: MenuState; picked?: string }

export const MORE_ACTIONS = 'More actions ▾'

const CONNECTOR = 2
const GROUP_INDENT = 2

const cut = (text: string, room: number) => (cellWidth(text) <= room ? text : `${cutCells(text, Math.max(0, room - 1))}…`)
const closed = (state: MenuState): MenuState => ({ open: false, selected: state.selected })

// Rows under a heading are indented until the next heading.
function groupedFlags(rows: MenuRow[]): boolean[] {
  let inGroup = false
  return rows.map(row => {
    if (row.isHeading) {
      inGroup = true
      return false
    }
    return inGroup
  })
}

// The next row from `from` in `step`'s direction that is not a heading, wrapping; `from` itself when it is the only one.
function nextPickable(rows: MenuRow[], from: number, step: number): number {
  for (let n = 1; n <= rows.length; n += 1) {
    const at = (((from + step * n) % rows.length) + rows.length) % rows.length
    if (!rows[at]!.isHeading) return at
  }
  return from
}

const firstPickable = (rows: MenuRow[]) => Math.max(0, rows.findIndex(row => !row.isHeading))

// One quiet button; open, its rows hang under it in one flat list, headings among them.
export function menu<A = MenuHit>(spec: MenuSpec<A>): Line<A>[] {
  const act = spec.actionFor ?? ((hit: MenuHit) => hit as A)
  const indent = spec.indent ?? 0
  const button = buttonSpan<A>({ label: spec.label, action: act({ type: 'toggle' }), tone: 'quiet' })
  const plainHead: Line<A> = [sp(' '.repeat(indent)), button]
  const head = spec.isSelected ? markButtonAt(plainHead, 1) : plainHead
  if (!spec.open || spec.rows.length === 0) return [head]

  const width = spec.width ?? Number.POSITIVE_INFINITY
  const grouped = groupedFlags(spec.rows)
  const widest = Math.max(...spec.rows.map((row, i) => cellWidth(row.label) + (grouped[i] ? GROUP_INDENT : 0)))
  const at = Math.max(0, Math.min(indent, width - CONNECTOR - widest))
  const room = Math.max(1, width - at - CONNECTOR)
  const lead = sp<A>(' '.repeat(at))

  const rowLine = (row: MenuRow, i: number): Line<A> => {
    const connector = sp<A>(i === spec.rows.length - 1 ? '└ ' : '├ ', GRAY)
    if (row.isHeading) return [lead, connector, sp(cut(row.label, room), DIM)]
    const pad = grouped[i] ? sp<A>(' '.repeat(GROUP_INDENT)) : undefined
    const look = i === spec.selected ? { ...ACCENT, bold: true } : {}
    const label = sp(cut(row.label, room - (pad ? GROUP_INDENT : 0)), { ...look, action: act({ type: 'row', at: i }) })
    return [lead, connector, ...(pad ? [pad] : []), spec.pressing && i === spec.selected ? pressed(label) : label]
  }
  return [head, ...spec.rows.map(rowLine)]
}

// Enter opens a closed menu on its first pickable row; open, the arrows move over the rows, skipping headings, and Enter picks.
// Left, Backspace and Escape close it: a Client never receives Escape, which the engine keeps for returning the focus.
// Undefined for a key the menu leaves alone.
export function menuKey(state: MenuState, rows: MenuRow[], key: string): MenuMove | undefined {
  const isEnter = key === 'return' || key === 'enter'
  if (!state.open) return isEnter && rows.some(row => !row.isHeading) ? { state: { open: true, selected: firstPickable(rows) } } : undefined
  if (key === 'escape' || key === 'esc' || key === 'backspace' || key === 'left') return { state: closed(state) }
  if (key === 'up' || key === 'down') return { state: { open: true, selected: nextPickable(rows, state.selected, key === 'up' ? -1 : 1) } }
  const row = rows[state.selected]
  if (isEnter && row && !row.isHeading) return { state: closed(state), picked: row.id }
  return undefined
}

// A click: the button opens or closes the menu, a row is picked; a heading takes no click.
export function menuHit(state: MenuState, rows: MenuRow[], hit: MenuHit): MenuMove {
  if (hit.type === 'toggle') return { state: state.open ? closed(state) : { open: true, selected: firstPickable(rows) } }
  const row = rows[hit.at]
  if (!row || row.isHeading) return { state }
  return { state: { open: false, selected: hit.at }, picked: row.id }
}
