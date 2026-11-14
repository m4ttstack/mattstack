import type { ClientKeyEvent } from 'claude-code'

// One row of buttons the keyboard can rest on; `main` is the button a move onto the row lands on.
export type GridRow<Id> = { key: string; ids: readonly Id[]; main: number }
// Keyed by row and button id, so it follows its row through redraws; `at` is where it was, for when that row is gone.
export type GridSelection<Id> = { key: string; button: Id; at: number }
export type GridSpot = { at: number; col: number }

// Where a selection lands now: its own button; once that button has gone, its row's main one;
// once its row has gone, the nearest row left, on its main button.
export function gridResolve<Id>(rows: readonly GridRow<Id>[], sel: GridSelection<Id> | undefined): GridSpot & { hasFallen: boolean } {
  if (!sel) return { at: 0, col: rows[0]?.main ?? 0, hasFallen: false }
  const found = rows.findIndex(r => r.key === sel.key)
  if (found < 0) {
    const at = Math.min(sel.at, rows.length - 1)
    return { at, col: rows[at]?.main ?? 0, hasFallen: true }
  }
  const col = rows[found]!.ids.indexOf(sel.button)
  return { at: found, col: col >= 0 ? col : rows[found]!.main, hasFallen: false }
}

export function gridSelection<Id>(rows: readonly GridRow<Id>[], spot: GridSpot): GridSelection<Id> | undefined {
  const row = rows[spot.at]
  const button = row?.ids[spot.col]
  return row && button !== undefined ? { key: row.key, button, at: spot.at } : undefined
}

// Up and down step between rows onto each row's main button, left and right along a row, all stopping at the ends.
// With `tabSteps`, Tab and Shift+Tab step rows as down and up do. `handled` is true for every arrow, even at an end,
// so the key never falls through to anything else; `to` is set only when the selection moves.
export function gridMove<Id>(rows: readonly GridRow<Id>[], here: GridSpot, ev: Pick<ClientKeyEvent, 'key' | 'shift'>, options: { tabSteps?: boolean } = {}): { handled: boolean; to?: GridSpot } {
  if (rows.length === 0) return { handled: false }
  const tab = options.tabSteps === true && ev.key === 'tab'
  const step = ev.key === 'up' || (tab && ev.shift) ? -1 : ev.key === 'down' || tab ? 1 : 0
  if (step !== 0) {
    const at = Math.min(Math.max(0, here.at + step), rows.length - 1)
    return at === here.at ? { handled: true } : { handled: true, to: { at, col: rows[at]!.main } }
  }
  if (ev.key === 'left' || ev.key === 'right') {
    const col = here.col + (ev.key === 'left' ? -1 : 1)
    return col >= 0 && col < (rows[here.at]?.ids.length ?? 0) ? { handled: true, to: { at: here.at, col } } : { handled: true }
  }
  return { handled: false }
}
