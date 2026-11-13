import type { ClientSurface } from 'claude-code'
import { attachPointer, renderLines } from '@mattstack/mod-kit'

import type { Form } from '../types'
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

  const { look } = attachPointer(surface, lines, {
    focused,
    isActive: () => s.phase === 'active',
    onEngage: engage,
    onAction: action => apply(perform(action, form, { ...s, pressed: undefined })),
  })

  return renderLines(lines, surface.elements, look)
}
