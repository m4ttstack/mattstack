import { BrandBar, Lines, Panel, gridMove, gridResolve, gridSelection, isButtonInView, kitClient, revealButtonOffset, revealOffset, sp } from '@mattstack/mod-kit'
import type { GridSelection, PointerState } from '@mattstack/mod-kit'

import { TITLE } from '../items'
import { stopMessage, viewLines } from './kit-layout'
import type { KitView } from './kit-layout'
import type { PaneButton, PaneMessage } from './model'

type Props = { view: KitView; focused: boolean; width: number }
// Once its button has gone (Run became Confirm, Confirm became Stop), the selection falls to the item's filled button.
type State = PointerState & { sel?: GridSelection<PaneButton['id']> }

export default kitClient<Props, State>(
  (props, ui) => {
    const { view } = props
    const { stops } = view
    const resolved = gridResolve(stops, ui.state.sel)
    // Finishing the last item lands on the item above it, not on Clear finished below.
    const above = resolved.at - 1
    const here = resolved.hasFallen && stops[resolved.at]?.isItem === false && stops[above]?.isItem ? { at: above, col: stops[above]!.main, hasFallen: true } : resolved
    const current = stops[here.at] && stopMessage(stops[here.at]!, here.col)

    const mark = (at: number, col: number) => {
      const sel = gridSelection(stops, { at, col })
      if (!sel) return false
      ui.setState({ ...ui.state, sel })
      return true
    }
    const reveal = (at: number) => {
      const offset = revealOffset(view, at)
      if (offset !== view.top) ui.post({ type: 'scrollTo', offset })
    }
    // The selected button's own line: an item taller than the window never shows whole, but its button can.
    const revealButton = (at: number, col: number) => {
      const offset = revealButtonOffset(view, at, col)
      if (offset !== view.top) ui.post({ type: 'scrollTo', offset })
    }
    const select = (at: number, col: number) => {
      if (mark(at, col)) reveal(at)
    }

    // The scroll follows the selection: when its item went, it moved to another one, which may sit outside the window.
    if (here.hasFallen && ui.focused && ui.keyboard && mark(here.at, here.col) && !isButtonInView(view, here.at, here.col)) revealButton(here.at, here.col)

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
      const move = gridMove(stops, here, ev, { tabSteps: true })
      if (move.handled) {
        if (move.to) select(move.to.at, move.to.col)
        return true
      }
      if ((ev.key === 'return' || ev.key === 'enter') && current) {
        // A wheel scroll or a fallen selection can leave the selected button off screen: Enter then only brings it back, never presses what is not seen.
        if (!isButtonInView(view, here.at, here.col)) {
          revealButton(here.at, here.col)
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
