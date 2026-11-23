import { CURSOR_ROW, FILL, Lines, Panel, cellWidth, ellipsize, kitClient, sp } from '@mattstack/mod-kit'
import type { Line } from '@mattstack/mod-kit'

import { composeActionsLines } from './kit-layout'
import { LABELS, composeButtons } from './model'
import type { PaneMessage } from './model'

// `head`: the card's top rows, over the field; `actions`: its buttons and closing row, under it.
type Props = { id: string; width: number; part: 'head' | 'actions'; title?: string }

const tinted = (line: Line<PaneMessage>, width: number): Line<PaneMessage> => {
  const used = line.reduce((n, span) => n + cellWidth(span.t), 0)
  return [...line.map(span => ({ ...span, bg: CURSOR_ROW })), sp(' '.repeat(Math.max(0, width - used)), { bg: CURSOR_ROW })]
}

// The card's header: a band a shade lighter than the card, naming the item the reply is about, then a blank tinted
// row before the field. Not the brand pink: that is the pane's own title bar.
export function composeHeadRows(title: string, width: number): Line<PaneMessage>[] {
  const lead = `  ${LABELS.message}  `
  const name = ellipsize(title, Math.max(1, width - cellWidth(lead) - 1))
  const used = cellWidth(lead) + cellWidth(name)
  const band = [sp<PaneMessage>(lead, FILL.chip), sp<PaneMessage>(name, { ...FILL.chip, bold: true }), sp<PaneMessage>(' '.repeat(Math.max(0, width - used)), { bg: FILL.chip.bg })]
  return [band, tinted([], width)]
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
