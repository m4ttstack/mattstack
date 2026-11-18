import { Lines, Panel, kitClient } from '@mattstack/mod-kit'

import type { Form } from '../types'
import { keyEffect, perform, pressesButton, type Effect } from './form/input'
import { afterAttempt, initial, type State } from './form/state'
import { fittedLines } from './form/view'

// `wheel`: the pane's running wheel total (kit `wheelTotal`), which scrolls a page too tall for the pane.
type Props = { form: Form; rows: number; cols: number; focused: boolean; wheel?: number }

export default kitClient<Props, State>(
  (props, ui) => {
    const { form } = props
    const retried = afterAttempt(form, ui.state)
    if (retried !== ui.state) ui.setState(retried)
    const width = Math.max(30, props.cols || ui.width)
    const apply = (effect: Effect | undefined) => {
      if (!effect) return false
      if (effect.post !== undefined) ui.post(effect.post)
      ui.setState(effect.state)
      return true
    }
    ui.onKey(ev => {
      if (!pressesButton(ev, form, ui.state)) return apply(keyEffect(ev, form, ui.state))
      ui.pressFor(() => apply(keyEffect(ev, form, ui.state)))
      return true
    })
    const fitted = fittedLines(form, ui.state, { width, focused: ui.focused, pressing: ui.keyPressing }, props.rows, props.wheel)
    const s = ui.state
    if (fitted.top !== (s.pageTop ?? 0) || fitted.followed !== s.followed || fitted.wheelAt !== s.wheelAt || fitted.ctxTop !== s.ctxTop) ui.setState({ ...s, pageTop: fitted.top, followed: fitted.followed, wheelAt: fitted.wheelAt, ctxTop: fitted.ctxTop })
    return (
      <Panel width={width}>
        <Lines lines={fitted.lines} onAction={action => apply(perform(action, form, ui.state))} />
      </Panel>
    )
  },
  {
    initial: props => initial(props.form),
    isActive: s => s.phase === 'active',
    // The engine gives no focus signal for a Client, so each key and click tells the hooks module the keyboard is here.
    engaged: props => ({ type: 'engaged', formId: props.form.id }),
  },
)
