import { Lines, Panel, kitClient } from '@mattstack/mod-kit'

import type { Form } from '../types'
import { keyEffect, perform, type Effect } from './form/input'
import { initial, type State } from './form/state'
import { visibleLines, withTabInView } from './form/view'

type Props = { form: Form; rows: number; cols: number; focused: boolean }

export default kitClient<Props, State>(
  (props, ui) => {
    const { form } = props
    const width = Math.max(30, props.cols || ui.width)
    const apply = (effect: Effect | undefined) => {
      if (!effect) return
      if (effect.post !== undefined) ui.post(effect.post)
      ui.setState(effect.state.page === ui.state.page ? effect.state : withTabInView(form, effect.state, width))
    }
    ui.onKey(ev => apply(keyEffect(ev, form, ui.state)))
    return (
      <Panel width={width}>
        <Lines lines={visibleLines(form, ui.state, { width, focused: ui.focused }, props.rows)} onAction={action => apply(perform(action, form, ui.state))} />
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
