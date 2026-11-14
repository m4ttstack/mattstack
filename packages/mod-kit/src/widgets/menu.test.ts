import { describe, expect, test } from 'bun:test'

import { widthOf, type Line } from '../draw/text'
import { QUIET } from '../draw/theme'
import { menu, menuHit, menuKey, type MenuHit, type MenuRow, type MenuState } from './menu'

const ROWS: MenuRow[] = [
  { id: 'pause', label: 'Pause run' },
  { id: 'go-back', label: 'Go back to stage', isHeading: true },
  { id: 'go-back:plan', label: 'plan' },
  { id: 'go-back:provision', label: 'provision' },
  { id: 'go-back:implement', label: 'implement' },
]

const textOf = (line: Line<MenuHit>) => line.map(span => span.t).join('')
const drawn = (state: Partial<MenuState> = {}, width = 80, indent = 14) =>
  menu({ label: 'More actions ▾', rows: ROWS, open: false, selected: 0, width, indent, ...state })

describe('menu', () => {
  test('closed, it draws as one quiet button labelled More actions ▾', () => {
    const lines = drawn()
    expect(lines).toHaveLength(1)
    const button = lines[0]!.find(span => span.action !== undefined)
    expect(button?.t.trim()).toBe('More actions ▾')
    expect(button).toMatchObject({ quiet: true, bg: QUIET.rest, action: { type: 'toggle' } })
  })

  test('open, it lists its rows under the button, the heading dim and its rows indented under it', () => {
    const lines = drawn({ open: true })
    const pad = ' '.repeat(14)
    expect(lines.map(textOf).slice(1)).toEqual([`${pad}├ Pause run`, `${pad}├ Go back to stage`, `${pad}├   plan`, `${pad}├   provision`, `${pad}└   implement`])
    expect(lines[2]!.find(span => span.t === 'Go back to stage')).toMatchObject({ dim: true })
    expect(lines[2]!.some(span => span.action !== undefined)).toBe(false)
  })

  test('row clicks carry their index, and the button toggles', () => {
    const actions = drawn({ open: true }).flatMap(line => line.flatMap(span => (span.action ? [span.action] : [])))
    expect(actions).toEqual([{ type: 'toggle' }, { type: 'row', at: 0 }, { type: 'row', at: 2 }, { type: 'row', at: 3 }, { type: 'row', at: 4 }])
  })

  test('at 40 columns with the button far right, every line fits', () => {
    for (const line of drawn({ open: true, selected: 3 }, 40, 20)) expect(widthOf(line)).toBeLessThanOrEqual(40)
  })
})

describe('menuKey', () => {
  const closed: MenuState = { open: false, selected: 0 }

  test('Enter opens it on the first row', () => {
    expect(menuKey(closed, ROWS, 'return')).toEqual({ state: { open: true, selected: 0 } })
  })

  test('arrows move through the rows, skip the heading and wrap', () => {
    const open: MenuState = { open: true, selected: 0 }
    expect(menuKey(open, ROWS, 'down')?.state.selected).toBe(2)
    expect(menuKey({ ...open, selected: 2 }, ROWS, 'up')?.state.selected).toBe(0)
    expect(menuKey({ ...open, selected: 4 }, ROWS, 'down')?.state.selected).toBe(0)
    expect(menuKey(open, ROWS, 'up')?.state.selected).toBe(4)
  })

  test('Enter picks the selected row and closes the menu', () => {
    expect(menuKey({ open: true, selected: 0 }, ROWS, 'return')).toEqual({ state: closed, picked: 'pause' })
    expect(menuKey({ open: true, selected: 3 }, ROWS, 'return')).toEqual({ state: { open: false, selected: 3 }, picked: 'go-back:provision' })
  })

  // A Client never receives Escape (the engine takes it to return the focus), so left and Backspace are the keyboard's way out.
  test('left and Backspace close it', () => {
    expect(menuKey({ open: true, selected: 2 }, ROWS, 'left')?.state).toEqual({ open: false, selected: 2 })
    expect(menuKey({ open: true, selected: 0 }, ROWS, 'backspace')?.state.open).toBe(false)
  })

  test('Escape closes it where the host delivers it', () => {
    expect(menuKey({ open: true, selected: 0 }, ROWS, 'escape')?.state.open).toBe(false)
  })

  test('a closed menu takes only Enter', () => {
    expect(menuKey(closed, ROWS, 'down')).toBeUndefined()
    expect(menuKey(closed, ROWS, 'escape')).toBeUndefined()
  })
})

describe('menuHit', () => {
  test('a click on the button opens or closes the menu', () => {
    expect(menuHit({ open: false, selected: 0 }, ROWS, { type: 'toggle' })).toEqual({ state: { open: true, selected: 0 } })
    expect(menuHit({ open: true, selected: 3 }, ROWS, { type: 'toggle' })).toEqual({ state: { open: false, selected: 3 } })
  })

  test('a click on a row picks it; a heading takes none', () => {
    const open: MenuState = { open: true, selected: 0 }
    expect(menuHit(open, ROWS, { type: 'row', at: 4 })).toEqual({ state: { open: false, selected: 4 }, picked: 'go-back:implement' })
    expect(menuHit(open, ROWS, { type: 'row', at: 1 })).toEqual({ state: open })
  })
})
