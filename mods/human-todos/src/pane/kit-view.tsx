import { BrandBar, Lines, Panel, kitClient, sp } from '@mattstack/mod-kit'

import { TITLE } from '../items'
import { kitLayout, kitWindow } from './kit-layout'
import type { PaneMessage } from './kit-layout'
import type { PaneModel } from './model'

type Props = { model: PaneModel; focused: boolean; width: number; offset: number; bodyRows: number }

export default kitClient<Props>(
  (props, ui) => (
    <Panel width={props.width}>
      <BrandBar title={TITLE} onHide={ui.hide} />
      <Lines lines={[[sp(' ')]]} />
      <Lines lines={kitWindow(kitLayout(props.model, props.width, props.bodyRows), props.width, props.offset)} onAction={(message: PaneMessage) => ui.post(message)} />
    </Panel>
  ),
  // The engine gives no focus signal for a Client, so each click tells the hooks module the pointer is here.
  { engaged: () => ({ type: 'engaged' }) },
)
