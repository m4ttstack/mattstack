import type { ClientSurface } from 'claude-code'

import { cellWidth } from '../draw/cells'
import { hitAt, hoverKeyAt, type Line } from '../draw/text'
import { SYMBOL } from '../draw/theme'
import type { Look } from '../draw/render'

// `armed` and `label` name the held control (its action as JSON, and its label), so a release still finds it after a redraw
// moved its row; `pressAt` is the cell the press went down on.
// `keyboard` and `keyPress` are kitClient's: the surface is in keyboard mode, and a key's activation is showing its press.
export type PointerState = { hover?: string; pressed?: string; armed?: string; label?: string; pressAt?: string; keyboard?: boolean; keyPress?: boolean }

type Options<A> = {
  focused: boolean
  onAction: (action: A) => void
  // Told on every press, so the module can tell its hooks the pointer is here.
  onEngage?: () => void
  // False while the surface takes no clicks (a form already sent).
  isActive?: () => boolean
}

// A control held down draws pressed only while the pointer is still over it.
export function lookOf(state: PointerState | undefined, focused: boolean): Look {
  const hover = state?.hover
  const held = state?.pressed
  return { focused, hover, pressed: held === hover ? held : undefined }
}

// A control is the run of spans on its line that carry one action, or a whole line's own action. Its label is their text
// without the keyboard's edge mark, which comes and goes with keyboard mode. A component's action is a key that names its
// place in the tree, so after a redraw the action alone can name another control: the label tells them apart.
type Control = { armed: string; label: string }

const labelOf = (text: string) => text.split(SYMBOL.selectEdge).join('').trim()

function runOf<A>(line: Line<A>, n: number): Control {
  const armed = JSON.stringify(line[n]!.action)
  const carries = (m: number) => line[m]?.action !== undefined && JSON.stringify(line[m]!.action) === armed
  let first = n
  let last = n
  while (carries(first - 1)) first--
  while (carries(last + 1)) last++
  return { armed, label: labelOf(line.slice(first, last + 1).map(s => s.t).join('')) }
}

function controlAt<A>(line: Line<A> | undefined, x: number): Control | undefined {
  if (!line) return undefined
  let from = 0
  for (let n = 0; n < line.length; n++) {
    const to = from + cellWidth(line[n]!.t)
    if (line[n]!.action !== undefined && x >= from && x < to) return runOf(line, n)
    from = to
  }
  return line.action === undefined ? undefined : { armed: JSON.stringify(line.action), label: labelOf(line.map(s => s.t).join('')) }
}

// The held control's action while the lines still draw that control. A disabled control drops its action from the line,
// so a control no span or line carries is no longer pressable.
function drawnAction<A>(lines: Line<A>[], held: Control): A | undefined {
  for (const line of lines) {
    if (line.action !== undefined && JSON.stringify(line.action) === held.armed && labelOf(line.map(s => s.t).join('')) === held.label) return line.action
    for (let n = 0; n < line.length; n++) {
      const run = line[n]!.action === undefined ? undefined : runOf(line, n)
      if (run && run.armed === held.armed && run.label === held.label) return line[n]!.action
    }
  }
  return undefined
}

// A press acts on release, over the control it started on, as a native button does; releasing elsewhere cancels it.
// The click that brings an unfocused surface back only engages it, as a window's first click does.
// The state must be seeded before the first call: until `surface.state` exists no listener is set, so a module cannot lose its own state to a press.
export function attachPointer<S extends PointerState, A>(surface: ClientSurface<S>, lines: Line<A>[], opts: Options<A>): { look: Look } {
  const s = surface.state
  const look = lookOf(s, opts.focused)
  if (s === undefined) return { look }

  const isActive = opts.isActive ?? (() => true)
  surface.onPointer(ev => {
    const key = hoverKeyAt(lines, ev.y, ev.x)
    if (ev.type === 'down') {
      opts.onEngage?.()
      if (!opts.focused || ev.button !== 'left' || !key || !isActive()) return
      const held = controlAt(lines[ev.y], ev.x)
      return surface.setState({ ...s, pressed: key, hover: key, armed: held?.armed, label: held?.label, pressAt: `${ev.x},${ev.y}` })
    }
    if (ev.type === 'up') {
      if (s.pressed === undefined) return
      const { armed, label, pressAt } = s
      surface.setState({ ...s, pressed: undefined, armed: undefined, label: undefined, pressAt: undefined })
      if (armed === undefined || label === undefined) return
      // Output can redraw the lines under a held press: a release over the same control acts where it now is, and a
      // release on the press's own cell with no move since acts on that control while the lines still draw it.
      // A release anywhere else cancels, as a drag off does, though a terminal may report no move between.
      const here = controlAt(lines[ev.y], ev.x)
      const isSame = here !== undefined && here.armed === armed && here.label === label
      const isStill = s.hover === s.pressed && pressAt === `${ev.x},${ev.y}`
      const action = isSame ? hitAt(lines[ev.y], ev.x) : isStill ? drawnAction(lines, { armed, label }) : undefined
      if (action !== undefined) opts.onAction(action)
      return
    }
    const next = ev.type === 'leave' ? undefined : key
    if (next !== s.hover && isActive()) surface.setState({ ...s, hover: next })
  })
  return { look }
}
