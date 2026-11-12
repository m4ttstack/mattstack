import type { ClientSurface } from 'claude-code'

import type { Form } from '../types'
import { renderLines } from './kit/render'
import { hitAt, hoverKeyAt } from './kit/text'
import { keyEffect, perform, type Effect } from './form/input'
import { initial, type State } from './form/state'
import { visibleLines, withTabInView } from './form/view'

type Props = { form: Form; rows: number; cols: number; focused: boolean }

export default function GateForm(props: Props, surface: ClientSurface<State>) {
  const { form } = props
  const focused = props.focused !== false
  if (surface.state === undefined) surface.setState(initial(form))
  const s = surface.state ?? initial(form)
  const width = Math.max(30, props.cols || surface.columns || 80)
  const lines = visibleLines(form, s, { width, focused }, props.rows)

  const apply = (effect: Effect | undefined) => {
    if (!effect) return
    if (effect.post !== undefined) surface.post(effect.post)
    surface.setState(effect.state.page === s.page ? effect.state : withTabInView(form, effect.state, width))
  }
  // The engine gives no focus signal for a Client, so each key and click tells the hooks module the keyboard is here.
  const engage = () => surface.post({ type: 'engaged', formId: form.id })

  surface.onKey(ev => {
    engage()
    apply(keyEffect(ev, form, s))
  })
  // A press acts on release, over the control it started on, as a native button does; releasing elsewhere cancels it.
  surface.onPointer(ev => {
    const key = hoverKeyAt(lines, ev.y, ev.x)
    if (ev.type === 'down') {
      engage()
      // The click that brings a dimmed form back only focuses it, as a window's first click does.
      if (!focused || ev.button !== 'left' || !key || s.phase !== 'active') return
      return surface.setState({ ...s, pressed: key, hover: key })
    }
    if (ev.type === 'up') {
      if (s.pressed === undefined) return
      const released = { ...s, pressed: undefined }
      const action = key === s.pressed ? hitAt(lines[ev.y], ev.x) : undefined
      return apply((action && perform(action, form, released)) || { state: released })
    }
    const hover = ev.type === 'leave' ? undefined : key
    if (hover !== s.hover && s.phase === 'active') surface.setState({ ...s, hover })
  })

  // A held control shows pressed only while the pointer is still over it.
  return renderLines(lines, surface.elements, { focused, hover: s.hover, pressed: s.pressed === s.hover ? s.pressed : undefined })
}
