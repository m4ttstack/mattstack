import type { ClientKeyEvent, ClientSurface, JsonValue } from 'claude-code'

import { attachPointer, lookOf, type PointerState } from '../interact/pointer'
import { drawKit } from './core'

// How long a key's activation shows its control pressed before it acts, as a click's press and release would.
const KEY_PRESS_MS = 150

export type KitUi<S> = {
  width: number
  focused: boolean
  // The state as it is now, pointer changes included, so a handler that runs after a press reads it unpressed.
  readonly state: S
  setState: (next: S) => void
  post: (message: JsonValue) => void
  // Asks the hooks module to put the pane away ({ type: 'hide' }, which paneMessage handles).
  hide: () => void
  // A handler that returns true handled the key, which puts the surface in keyboard mode until the pointer moves.
  onKey: (fn: (event: ClientKeyEvent) => boolean | void) => void
  // Keyboard mode: the last thing the person did here was a key the module handled, so it shows where the keys are.
  readonly keyboard: boolean
  // A key's activation is showing its press; keys are ignored until it has acted.
  readonly keyPressing: boolean
  // Shows the press for a moment, then runs `run`: what a key that activates a control calls.
  pressFor: (run: () => void, ms?: number) => void
  // Runs when one of the `revealKeys` enters keyboard mode, so the module can bring its selection into view.
  onReveal: (fn: () => void) => void
}

export type KitOptions<P, S> = {
  initial?: (props: P) => S
  // Defaults to the `focused` prop, true when absent.
  focused?: (props: P) => boolean
  // False while the surface takes no clicks (a form already sent).
  isActive?: (state: S) => boolean
  // Posted on every press and key, so the hooks module can tell the pointer or keyboard is here.
  engaged?: (props: P) => JsonValue
  // Keys that, outside keyboard mode, only enter it: the first press shows where the keys are and the next one acts,
  // so no key moves or presses a selection the person cannot see yet.
  revealKeys?: readonly string[]
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
    let reveal: (() => void) | undefined
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
          if (latest.keyPress) return
          if (focused && !latest.keyboard && options.revealKeys?.includes(event.key)) {
            setState({ ...latest, keyboard: true })
            reveal?.()
            return
          }
          if (fn(event) === true && !latest.keyboard) setState({ ...latest, keyboard: true })
        }),
      get keyboard() {
        return latest.keyboard === true
      },
      get keyPressing() {
        return latest.keyPress === true
      },
      onReveal: fn => {
        reveal = fn
      },
      pressFor: (run, ms = KEY_PRESS_MS) => {
        if (latest.keyPress) return
        setState({ ...latest, keyPress: true })
        // The timer outlives this frame, so it reads the surface's state as it is when it fires.
        const stop = surface.every(ms, () => {
          stop()
          surface.setState({ ...(surface.state as S), keyPress: undefined })
          run()
        })
      },
    }
    const { tree, lines, handlers } = drawKit({ elements: surface.elements, look: lookOf(latest, focused), width: ui.width, focused }, () => body(props, ui))
    const local = {
      get state() {
        return latest
      },
      setState,
      // Any pointer event leaves keyboard mode, after the pointer's own state change.
      onPointer: (fn: Parameters<ClientSurface<S>['onPointer']>[0]) =>
        surface.onPointer(event => {
          fn(event)
          if (latest.keyboard) setState({ ...latest, keyboard: undefined })
        }),
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
