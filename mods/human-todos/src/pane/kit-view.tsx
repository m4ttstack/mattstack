import { BrandBar, Lines, Panel, kitClient, sp } from '@mattstack/mod-kit'
import type { PointerState } from '@mattstack/mod-kit'

import { TITLE } from '../items'
import { keyStops, kitLayout, kitWindow, revealOffset, stopLines } from './kit-layout'
import type { KeyStop } from './kit-layout'
import { messageOf } from './model'
import type { PaneMessage, PaneModel } from './model'

type Props = { model: PaneModel; focused: boolean; width: number; offset: number; bodyRows: number }
// The selection is keyed by stop and button, so it follows its item through redraws; `at` and `col` are where it was, for when that item or button is gone.
type Selection = { key: string; button: string; at: number; col: number }
type State = PointerState & { sel?: Selection }

// The stop and button the selection lands on now: its own, else the nearest one left.
function resolve(stops: KeyStop[], sel: Selection | undefined): { at: number; col: number } {
  if (!sel) return { at: 0, col: stops[0] ? mainOf(stops[0]) : 0 }
  const found = stops.findIndex(s => s.key === sel.key)
  const at = found >= 0 ? found : Math.min(sel.at, stops.length - 1)
  const buttons = stops[at]?.buttons ?? []
  const col = found >= 0 ? buttons.findIndex(b => b.id === sel.button) : -1
  return { at, col: col >= 0 ? col : Math.min(sel.col, buttons.length - 1) }
}

// Moving onto an item lands on its filled button: its main action.
const mainOf = (stop: KeyStop) => Math.max(0, stop.buttons.findIndex(b => b.tone !== 'quiet'))

export default kitClient<Props, State>(
  (props, ui) => {
    const layout = kitLayout(props.model, props.width, props.bodyRows)
    const stops = keyStops(props.model)
    const here = resolve(stops, ui.state.sel)
    const current = stops[here.at]?.buttons[here.col]
    // Only an item carries the rail: Clear finished is one row with nothing to group, and its button's edge marks it.
    const rail = current?.todoId === undefined ? undefined : stopLines(layout, stops, here.at)

    const mark = (at: number, col: number) => {
      const stop = stops[at]
      const button = stop?.buttons[col]
      if (!stop || !button) return false
      ui.setState({ ...ui.state, sel: { key: stop.key, button: button.id, at, col } })
      return true
    }
    const select = (at: number, col: number) => {
      if (!mark(at, col)) return
      const offset = revealOffset(layout, stops, at, props.offset)
      if (offset !== props.offset) ui.post({ type: 'scrollTo', offset })
    }

    // A click moves the selection too, so the next key carries on from the button clicked.
    const clicked = (message: PaneMessage) => {
      const wanted = JSON.stringify(message)
      stops.forEach((stop, at) => stop.buttons.forEach((button, col) => JSON.stringify(messageOf(button)) === wanted && mark(at, col)))
      ui.post(message)
    }

    // The first key out of keyboard mode only shows the selection, so it is brought into view then.
    ui.onReveal(() => {
      const offset = revealOffset(layout, stops, here.at, props.offset)
      if (offset !== props.offset) ui.post({ type: 'scrollTo', offset })
    })

    // True for a key handled here, which turns on keyboard mode and its marks.
    ui.onKey(ev => {
      if (!ui.focused || stops.length === 0) return false
      // Tab and Shift+Tab step between items as ↓ and ↑ do, stopping at the ends as gate-form's pages do.
      const step = ev.key === 'up' || (ev.key === 'tab' && ev.shift) ? -1 : ev.key === 'down' || ev.key === 'tab' ? 1 : 0
      if (step !== 0) {
        const at = Math.min(Math.max(0, here.at + step), stops.length - 1)
        if (at !== here.at) select(at, mainOf(stops[at]!))
        return true
      }
      if (ev.key === 'left' || ev.key === 'right') {
        const col = here.col + (ev.key === 'left' ? -1 : 1)
        if (col >= 0 && col < (stops[here.at]?.buttons.length ?? 0)) select(here.at, col)
        return true
      }
      if ((ev.key === 'return' || ev.key === 'enter') && current) {
        // Enter shows the press for a moment, as a click would, then sends what a click sends.
        const message = messageOf(current)
        ui.pressFor(() => ui.post(message))
        return true
      }
      return false
    })

    return (
      <Panel width={props.width}>
        <BrandBar title={TITLE} onHide={ui.hide} />
        <Lines lines={[[sp(' ')]]} />
        <Lines
          lines={kitWindow(
            layout,
            props.width,
            props.offset,
            ui.focused && current ? { selected: messageOf(current), range: rail, marked: ui.keyboard, pressing: ui.keyPressing } : {},
          )}
          onAction={clicked}
        />
      </Panel>
    )
  },
  {
    initial: () => ({}),
    revealKeys: ['up', 'down', 'left', 'right', 'tab', 'return', 'enter'],
    // The engine gives no focus signal for a Client, so each click and key tells the hooks module the pointer or keyboard is here.
    engaged: () => ({ type: 'engaged' }),
  },
)
