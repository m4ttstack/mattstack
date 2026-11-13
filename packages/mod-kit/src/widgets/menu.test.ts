import { describe, expect, test } from 'bun:test'

import { widthOf, type Line } from '../draw/text'
import { QUIET } from '../draw/theme'
import { menu, menuHit, menuKey, type MenuHit, type MenuRow, type MenuState } from './menu'

const ROWS: MenuRow[] = [
  { id: 'pause', label: 'Pause run' },
  {
    id: 'go-back',
    label: 'Go back to stage',
    rows: [
      { id: 'go-back:plan', label: 'plan' },
      { id: 'go-back:provision', label: 'provision' },
      { id: 'go-back:implement', label: 'implement' },
    ],
  },
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

  test('open, it lists its rows under the button with ├ and └', () => {
    const lines = drawn({ open: true })
    expect(lines.map(textOf).slice(1)).toEqual([`${' '.repeat(14)}├ Pause run`, `${' '.repeat(14)}└ Go back to stage ▸`])
  })

  test('a row with rows opens its sub-list to the right, the first sub-row on its own line', () => {
    const lines = drawn({ open: true, selected: 1, sub: 0 })
    const text = lines.map(textOf)
    const parent = text[2]!
    expect(parent).toContain('└ Go back to stage ▸')
    expect(parent.trimEnd().endsWith('plan')).toBe(true)
    const column = parent.lastIndexOf('plan')
    expect(text[3]!.indexOf('provision')).toBe(column)
    expect(text[4]!.indexOf('implement')).toBe(column)
  })

  test('row clicks carry their path, and the button toggles', () => {
    const lines = drawn({ open: true, selected: 1, sub: 0 })
    const actions = lines.flatMap(line => line.flatMap(span => (span.action ? [span.action] : [])))
    expect(actions).toContainEqual({ type: 'toggle' })
    expect(actions).toContainEqual({ type: 'row', path: [0] })
    expect(actions).toContainEqual({ type: 'row', path: [1] })
    expect(actions).toContainEqual({ type: 'row', path: [1, 2] })
  })

  test('at 40 columns the sub-list drops under its row and every line fits', () => {
    const lines = drawn({ open: true, selected: 1, sub: 0 }, 40, 20)
    for (const line of lines) expect(widthOf(line)).toBeLessThanOrEqual(40)
    const text = lines.map(textOf)
    expect(text.some(row => row.includes('Go back to stage ▸') && row.includes('plan'))).toBe(false)
    expect(text.some(row => row.trim() === 'plan')).toBe(true)
  })

  test('at 80 columns with the button far right, every line still fits', () => {
    for (const line of drawn({ open: true, selected: 1, sub: 2 }, 80, 60)) expect(widthOf(line)).toBeLessThanOrEqual(80)
  })
})

describe('menuKey', () => {
  const closed: MenuState = { open: false, selected: 0 }

  test('Enter opens it on the first row', () => {
    expect(menuKey(closed, ROWS, 'return')).toEqual({ state: { open: true, selected: 0 } })
  })

  test('arrows move through the rows and wrap', () => {
    const open: MenuState = { open: true, selected: 0 }
    expect(menuKey(open, ROWS, 'down')?.state.selected).toBe(1)
    expect(menuKey({ ...open, selected: 1 }, ROWS, 'down')?.state.selected).toBe(0)
    expect(menuKey(open, ROWS, 'up')?.state.selected).toBe(1)
  })

  test('Enter on a leaf picks it and closes the menu', () => {
    expect(menuKey({ open: true, selected: 0 }, ROWS, 'return')).toEqual({ state: closed, picked: 'pause' })
  })

  test('Enter or right on a row with rows opens its sub-list; arrows move in it; Enter picks', () => {
    const atGoBack: MenuState = { open: true, selected: 1 }
    expect(menuKey(atGoBack, ROWS, 'return')?.state).toEqual({ open: true, selected: 1, sub: 0 })
    expect(menuKey(atGoBack, ROWS, 'right')?.state).toEqual({ open: true, selected: 1, sub: 0 })
    const inSub: MenuState = { open: true, selected: 1, sub: 0 }
    expect(menuKey(inSub, ROWS, 'down')?.state.sub).toBe(1)
    expect(menuKey({ ...inSub, sub: 1 }, ROWS, 'return')).toEqual({ state: { open: false, selected: 1 }, picked: 'go-back:provision' })
  })

  test('left leaves the sub-list', () => {
    expect(menuKey({ open: true, selected: 1, sub: 2 }, ROWS, 'left')?.state).toEqual({ open: true, selected: 1 })
  })

  // A Client never receives Escape (the engine takes it to return the focus), so left and Backspace are the keyboard's way out.
  test('left at the top level and Backspace close it', () => {
    expect(menuKey({ open: true, selected: 1 }, ROWS, 'left')?.state).toEqual({ open: false, selected: 1 })
    expect(menuKey({ open: true, selected: 0 }, ROWS, 'backspace')?.state.open).toBe(false)
    expect(menuKey({ open: true, selected: 1, sub: 2 }, ROWS, 'backspace')?.state.open).toBe(false)
  })

  test('Escape closes it, from either level, where the host delivers it', () => {
    expect(menuKey({ open: true, selected: 1, sub: 2 }, ROWS, 'escape')?.state.open).toBe(false)
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
    expect(menuHit({ open: true, selected: 1, sub: 0 }, ROWS, { type: 'toggle' })).toEqual({ state: { open: false, selected: 1 } })
  })

  test('a click on a row with rows opens its sub-list; on a leaf or sub-row it picks', () => {
    const open: MenuState = { open: true, selected: 0 }
    expect(menuHit(open, ROWS, { type: 'row', path: [1] })).toEqual({ state: { open: true, selected: 1, sub: 0 } })
    expect(menuHit(open, ROWS, { type: 'row', path: [0] })).toEqual({ state: { open: false, selected: 0 }, picked: 'pause' })
    expect(menuHit({ open: true, selected: 1, sub: 0 }, ROWS, { type: 'row', path: [1, 2] })).toEqual({ state: { open: false, selected: 1 }, picked: 'go-back:implement' })
  })
})
