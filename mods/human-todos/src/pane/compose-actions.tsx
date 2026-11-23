import { CURSOR_ROW, DIM, Lines, Panel, cellWidth, ellipsize, kitClient, sp } from '@mattstack/mod-kit'
import type { Line } from '@mattstack/mod-kit'

import { composeActionsLines } from './kit-layout'
import { composeButtons } from './model'
import type { PaneMessage } from './model'

// `head`: the card's top rows, over the field; `actions`: its buttons and closing row, under it.
type Props = { id: string; width: number; part: 'head' | 'actions'; title?: string }

const tinted = (line: Line<PaneMessage>, width: number): Line<PaneMessage> => {
  const used = line.reduce((n, span) => n + cellWidth(span.t), 0)
  return [...line.map(span => ({ ...span, bg: CURSOR_ROW })), sp(' '.repeat(Math.max(0, width - used)), { bg: CURSOR_ROW })]
}

// The card's header: a blank tinted row, what the message is about, and a blank row before the field. Its text starts
// at the card's left edge, where the field's text starts: the field cannot be padded (see pane.tsx).
export function composeHeadRows(title: string, width: number): Line<PaneMessage>[] {
  const lead = 'Message about '
  const about = tinted([sp(lead, DIM), sp(ellipsize(title, Math.max(1, width - cellWidth(lead))), { bold: true })], width)
  return [tinted([], width), about, tinted([], width)]
}

// The docked message card's last rows: its buttons, then the card's closing tinted row. The field above them is the
// engine's Input, drawn by the hooks module, since an Input inside a Client takes no keys.
export function composeActionRows(id: string, width: number): Line<PaneMessage>[] {
  return [...composeActionsLines(composeButtons(id), width), tinted([], width)]
}

export default kitClient<Props>((props, ui) => (
  <Panel width={props.width}>
    <Lines lines={props.part === 'head' ? composeHeadRows(props.title ?? '', props.width) : composeActionRows(props.id, props.width)} onAction={message => ui.post(message)} />
  </Panel>
))
