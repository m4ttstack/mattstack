import { describe, expect, test } from 'bun:test'
import type { ClientElements } from 'claude-code'

import type { Line } from '../draw/text'
import type { MenuRow, MenuState } from '../widgets/menu'
import { drawKit } from './core'
import { Menu } from './menu'
import { Panel } from './panel'

const ELEMENTS = { Box: 'Box', Text: 'Text' } as unknown as ClientElements
const ROWS: MenuRow[] = [
  { id: 'pause', label: 'Pause run' },
  { id: 'go-back', label: 'Go back to stage', rows: [{ id: 'go-back:plan', label: 'plan' }] },
]
const textOf = (line: Line<unknown>) => line.map(span => span.t).join('')

function drawMenu(state: MenuState, seen: { states: MenuState[]; picked: string[] }) {
  return drawKit({ elements: ELEMENTS, look: { focused: true }, width: 60, focused: true }, () => (
    <Panel width={60}>
      <Menu rows={ROWS} state={state} onChange={s => seen.states.push(s)} onPick={id => seen.picked.push(id)} />
    </Panel>
  ))
}

const press = (drawn: ReturnType<typeof drawMenu>, label: string) => {
  const span = drawn.lines.flat().find(s => s.t.includes(label) && s.action !== undefined)
  expect(span, label).toBeDefined()
  drawn.handlers.get(span!.action!)!()
}

describe('Menu', () => {
  test('draws the More actions ▾ button; a press opens it', () => {
    const seen = { states: [] as MenuState[], picked: [] as string[] }
    const drawn = drawMenu({ open: false, selected: 0 }, seen)
    expect(drawn.lines.map(textOf)).toEqual(['  More actions ▾  '])
    press(drawn, 'More actions')
    expect(seen.states).toEqual([{ open: true, selected: 0 }])
  })

  test('open, a press on a leaf picks its id; on a row with rows it opens the sub-list', () => {
    const seen = { states: [] as MenuState[], picked: [] as string[] }
    const drawn = drawMenu({ open: true, selected: 0 }, seen)
    press(drawn, 'Pause run')
    expect(seen.picked).toEqual(['pause'])
    press(drawn, 'Go back to stage')
    expect(seen.states.at(-1)).toEqual({ open: true, selected: 1, sub: 0 })
  })

  test('a press on a sub-row picks it', () => {
    const seen = { states: [] as MenuState[], picked: [] as string[] }
    press(drawMenu({ open: true, selected: 1, sub: 0 }, seen), 'plan')
    expect(seen.picked).toEqual(['go-back:plan'])
  })
})
