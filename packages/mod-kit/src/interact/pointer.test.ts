import { expect, test } from 'bun:test'
import type { ClientPointerEvent, ClientSurface } from 'claude-code'

import { buttonSpan } from '../widgets/buttons'
import { sp, type Line } from '../draw/text'
import { attachPointer, type PointerState } from './pointer'

type Action = 'one' | 'two'

const LINES: Line<Action>[] = [[buttonSpan<Action>({ label: 'One', action: 'one' }), sp(' '), buttonSpan<Action>({ label: 'Two', action: 'two' })]]
const ONE = 2
const TWO = 12

// The engine calls the module again after each setState, which sets a fresh listener over the new state.
function mount(opts: { focused?: boolean; initial?: PointerState | null; isActive?: () => boolean } = {}) {
  let state: PointerState | undefined = opts.initial === null ? undefined : (opts.initial ?? {})
  let handler: ((event: ClientPointerEvent) => void) | undefined
  const actions: Action[] = []
  let engaged = 0
  const surface = {
    get state() {
      return state
    },
    setState: (next: PointerState) => {
      state = next
    },
    onPointer: (fn: (event: ClientPointerEvent) => void) => {
      handler = fn
      return () => {}
    },
  } as unknown as ClientSurface<PointerState>
  const render = () =>
    attachPointer(surface, LINES, {
      focused: opts.focused ?? true,
      onAction: a => actions.push(a),
      onEngage: () => (engaged += 1),
      ...(opts.isActive && { isActive: opts.isActive }),
    })
  let look = render().look
  const send = (type: ClientPointerEvent['type'], x: number, button?: 'left' | 'right') => {
    handler?.({ type, x, y: 0, ...(button && { button }) })
    look = render().look
  }
  return { send, actions, state: () => state, look: () => look, engaged: () => engaged }
}

test('hover follows the pointer, and leave clears it', () => {
  const m = mount()
  m.send('move', ONE)
  expect(m.state()?.hover).toBeDefined()
  m.send('leave', 0)
  expect(m.state()?.hover).toBeUndefined()
})

test('a press shows on the way down and acts on release over the same control', () => {
  const m = mount()
  m.send('down', ONE, 'left')
  expect(m.state()?.pressed).toBeDefined()
  expect(m.actions).toEqual([])
  m.send('up', ONE, 'left')
  expect(m.actions).toEqual(['one'])
  expect(m.state()?.pressed).toBeUndefined()
})

test('dragging off a pressed button and releasing does nothing', () => {
  const m = mount()
  m.send('down', ONE, 'left')
  m.send('move', TWO, 'left')
  m.send('up', TWO, 'left')
  expect(m.actions).toEqual([])
  expect(m.state()?.pressed).toBeUndefined()
})

test('the first click on an unfocused surface only engages it', () => {
  const m = mount({ focused: false })
  m.send('down', ONE, 'left')
  m.send('up', ONE, 'left')
  expect(m.engaged()).toBe(1)
  expect(m.actions).toEqual([])
  expect(m.state()?.pressed).toBeUndefined()
})

test('a right click or a click off every control never presses', () => {
  const m = mount()
  m.send('down', ONE, 'right')
  m.send('down', 7, 'left')
  expect(m.state()?.pressed).toBeUndefined()
  expect(m.engaged()).toBe(2)
})

test('an inactive surface takes no press and no hover', () => {
  const m = mount({ isActive: () => false })
  m.send('move', ONE)
  m.send('down', ONE, 'left')
  expect(m.state()).toEqual({})
})

test('with no state yet it listens to nothing, for the module to seed it first', () => {
  const m = mount({ initial: null })
  m.send('down', ONE, 'left')
  expect(m.state()).toBeUndefined()
})

test('look lights only the control still under a held press', () => {
  const m = mount()
  m.send('move', ONE)
  m.send('down', ONE, 'left')
  expect(m.look().pressed).toBe(m.look().hover)
  expect(m.look().pressed).toBeDefined()
  m.send('move', TWO, 'left')
  expect(m.look().pressed).toBeUndefined()
  expect(m.look().hover).toBeDefined()
})
