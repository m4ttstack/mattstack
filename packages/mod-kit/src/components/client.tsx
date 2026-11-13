import type { ClientKeyEvent, ClientSurface, JsonValue } from 'claude-code'

import { attachPointer, lookOf, type PointerState } from '../interact/pointer'
import { drawKit } from './core'

export type KitUi<S> = {
  width: number
  focused: boolean
  // The state as it is now, pointer changes included, so a handler that runs after a press reads it unpressed.
  readonly state: S
  setState: (next: S) => void
  post: (message: JsonValue) => void
  // Asks the hooks module to put the pane away ({ type: 'hide' }, which paneMessage handles).
  hide: () => void
  onKey: (fn: (event: ClientKeyEvent) => void) => void
}

export type KitOptions<P, S> = {
  initial?: (props: P) => S
  // Defaults to the `focused` prop, true when absent.
  focused?: (props: P) => boolean
  // False while the surface takes no clicks (a form already sent).
  isActive?: (state: S) => boolean
  // Posted on every press and key, so the hooks module can tell the pointer or keyboard is here.
  engaged?: (props: P) => JsonValue
}

// A Client module drawn with kit components: seeds the state, then wires the pointer over the lines its Panel laid out.
export function kitClient<P, S extends PointerState = PointerState>(body: (props: P, ui: KitUi<S>) => JSX.Element, options: KitOptions<P, S> = {}) {
  return function KitClient(props: P, surface: ClientSurface<S>): JSX.Element {
    const seed = surface.state ?? options.initial?.(props) ?? ({} as S)
    if (surface.state === undefined) surface.setState(seed)
    // The engine shows the seeded state only from the next frame, so this frame reads its own copy.
    let latest = seed
    const setState = (next: S) => {
      latest = next
      surface.setState(next)
    }
    const focused = options.focused ? options.focused(props) : (props as { focused?: unknown } | null)?.focused !== false
    const engage = options.engaged && (() => surface.post(options.engaged!(props)))
    const ui: KitUi<S> = {
      width: surface.columns || 80,
      focused,
      get state() {
        return latest
      },
      setState,
      post: message => surface.post(message),
      hide: () => surface.post({ type: 'hide' }),
      onKey: fn =>
        void surface.onKey(event => {
          engage?.()
          fn(event)
        }),
    }
    const { tree, lines, handlers } = drawKit({ elements: surface.elements, look: lookOf(latest, focused), width: ui.width, focused }, () => body(props, ui))
    const local = {
      get state() {
        return latest
      },
      setState,
      onPointer: (fn: Parameters<ClientSurface<S>['onPointer']>[0]) => surface.onPointer(fn),
    } as unknown as ClientSurface<S>
    attachPointer(local, lines, {
      focused,
      onAction: key => handlers.get(key)?.(),
      ...(engage && { onEngage: engage }),
      ...(options.isActive && { isActive: () => options.isActive!(latest) }),
    })
    return tree
  }
}
