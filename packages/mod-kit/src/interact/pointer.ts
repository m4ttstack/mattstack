import type { ClientSurface } from 'claude-code'

import { hitAt, hoverKeyAt, type Line } from '../draw/text'
import type { Look } from '../draw/render'

// `armed` is the held control's action as JSON, so a release still finds it after a redraw moved its row.
export type PointerState = { hover?: string; pressed?: string; armed?: string }

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

// A disabled control drops its action from the line, so an action no span or line carries is no longer pressable.
function drawnAction<A>(lines: Line<A>[], armed: string): A | undefined {
  for (const line of lines) {
    if (line.action !== undefined && JSON.stringify(line.action) === armed) return line.action
    const span = line.find(piece => piece.action !== undefined && JSON.stringify(piece.action) === armed)
    if (span) return span.action
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
      return surface.setState({ ...s, pressed: key, hover: key, armed: JSON.stringify(hitAt(lines[ev.y], ev.x)) })
    }
    if (ev.type === 'up') {
      if (s.pressed === undefined) return
      const { armed } = s
      surface.setState({ ...s, pressed: undefined, armed: undefined })
      // Output can redraw the lines under a held press: a release over the same action acts where its control now is,
      // and a release with no move since the press acts on what was pressed, while a control still carries it.
      const here = hitAt(lines[ev.y], ev.x)
      const isStill = s.hover === s.pressed && armed !== undefined
      const action = here !== undefined && JSON.stringify(here) === armed ? here : isStill ? drawnAction(lines, armed) : undefined
      if (action !== undefined) opts.onAction(action)
      return
    }
    const next = ev.type === 'leave' ? undefined : key
    if (next !== s.hover && isActive()) surface.setState({ ...s, hover: next })
  })
  return { look }
}
