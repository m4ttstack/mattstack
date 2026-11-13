import { BrandBar, Lines, Panel, kitClient, sp } from '@mattstack/mod-kit'
import type { PointerState } from '@mattstack/mod-kit'

import { TITLE } from '../items'
import { isInView, revealOffset, stopMessage, viewLines } from './kit-layout'
import type { KitView, ViewStop } from './kit-layout'
import type { PaneButton, PaneMessage } from './model'

type Props = { view: KitView; focused: boolean; width: number }
// The selection is keyed by stop and button id, so it follows its item through redraws;
// `at` is where it was, for when that item is gone.
type Selection = { key: string; button: PaneButton['id']; at: number }
type State = PointerState & { sel?: Selection }

// The stop and button the selection lands on now: its own. Once its button has gone (Run became Confirm, Confirm became Stop),
// the item's filled button; once its item has gone, the nearest item left, on its filled button.
function resolve(stops: ViewStop[], sel: Selection | undefined): { at: number; col: number; hasFallen: boolean } {
  if (!sel) return { at: 0, col: stops[0]?.main ?? 0, hasFallen: false }
  const found = stops.findIndex(s => s.key === sel.key)
  if (found < 0) {
    const at = Math.min(sel.at, stops.length - 1)
    return { at, col: stops[at]?.main ?? 0, hasFallen: true }
  }
  const col = stops[found]!.ids.indexOf(sel.button)
  return { at: found, col: col >= 0 ? col : stops[found]!.main, hasFallen: false }
}

export default kitClient<Props, State>(
  (props, ui) => {
    const { view } = props
    const { stops } = view
    const here = resolve(stops, ui.state.sel)
    const current = stops[here.at] && stopMessage(stops[here.at]!, here.col)

    const mark = (at: number, col: number) => {
      const stop = stops[at]
      const button = stop?.ids[col]
      if (!stop || !button) return false
      ui.setState({ ...ui.state, sel: { key: stop.key, button, at } })
      return true
    }
    const reveal = (at: number) => {
      const offset = revealOffset(view, at)
      if (offset !== view.top) ui.post({ type: 'scrollTo', offset })
    }
    const select = (at: number, col: number) => {
      if (mark(at, col)) reveal(at)
    }

    // The scroll follows the selection: when its item went, it moved to another one, which may sit outside the window.
    if (here.hasFallen && ui.focused && ui.keyboard && mark(here.at, here.col) && !isInView(view, here.at)) reveal(here.at)

    // A click moves the selection too, so the next key carries on from the button clicked.
    const clicked = (message: PaneMessage) => {
      const wanted = JSON.stringify(message)
      stops.forEach((stop, at) => stop.ids.forEach((_id, col) => JSON.stringify(stopMessage(stop, col)) === wanted && mark(at, col)))
      ui.post(message)
    }

    // The first key out of keyboard mode only shows the selection, so it is brought into view then.
    ui.onReveal(() => reveal(here.at))

    // True for a key handled here, which turns on keyboard mode and its marks.
    ui.onKey(ev => {
      if (!ui.focused || stops.length === 0) return false
      // Tab and Shift+Tab step between items as ↓ and ↑ do, stopping at the ends as gate-form's pages do.
      const step = ev.key === 'up' || (ev.key === 'tab' && ev.shift) ? -1 : ev.key === 'down' || ev.key === 'tab' ? 1 : 0
      if (step !== 0) {
        const at = Math.min(Math.max(0, here.at + step), stops.length - 1)
        if (at !== here.at) select(at, stops[at]!.main)
        return true
      }
      if (ev.key === 'left' || ev.key === 'right') {
        const col = here.col + (ev.key === 'left' ? -1 : 1)
        if (col >= 0 && col < (stops[here.at]?.ids.length ?? 0)) select(here.at, col)
        return true
      }
      if ((ev.key === 'return' || ev.key === 'enter') && current) {
        // A wheel scroll or a fallen selection can leave it out of view: Enter then only brings it back, never presses what is not on screen.
        if (!isInView(view, here.at)) {
          reveal(here.at)
          return true
        }
        // Enter shows the press for a moment, as a click would, then sends what a click sends.
        ui.pressFor(() => ui.post(current))
        return true
      }
      return false
    })

    const stop = stops[here.at]
    // Only an item carries the rail: Clear finished is one row with nothing to group, and its button's edge marks it.
    const range = stop?.isItem ? { first: stop.first, last: stop.last } : undefined
    return (
      <Panel width={props.width}>
        <BrandBar title={TITLE} onHide={ui.hide} />
        <Lines lines={[[sp(' ')]]} />
        <Lines
          lines={viewLines(view, props.width, ui.focused && current ? { selected: current, range, marked: ui.keyboard, pressing: ui.keyPressing } : {})}
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
