import { CURSOR_ROW, Lines, Panel, kitClient, sp } from '@mattstack/mod-kit'

import { composeActionsLines } from './kit-layout'
import { composeButtons } from './model'
import type { PaneMessage } from './model'

type Props = { id: string; width: number }

// The docked message card's last rows: its buttons, then the card's closing tinted row. The field above them is the
// engine's Input, drawn by the hooks module, since an Input inside a Client takes no keys.
export function composeActionRows(id: string, width: number) {
  return [...composeActionsLines(composeButtons(id), width), [sp<PaneMessage>(' '.repeat(width), { bg: CURSOR_ROW })]]
}

export default kitClient<Props>((props, ui) => (
  <Panel width={props.width}>
    <Lines lines={composeActionRows(props.id, props.width)} onAction={message => ui.post(message)} />
  </Panel>
))
