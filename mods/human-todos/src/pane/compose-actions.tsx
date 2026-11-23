import { BRAND, CURSOR_ROW, Lines, Panel, cellWidth, ellipsize, kitClient, sp } from '@mattstack/mod-kit'
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

// The card's header: a band in the brand colour naming the item the reply is about, then a blank tinted row before
// the field.
export function composeHeadRows(title: string, width: number): Line<PaneMessage>[] {
  const lead = '  ↳  '
  const band = { bg: BRAND.pink, color: BRAND.plum, bold: true }
  const text = `${lead}${ellipsize(title, Math.max(1, width - cellWidth(lead) - 1))}`
  return [[sp(text, band), sp(' '.repeat(Math.max(0, width - cellWidth(text))), band)], tinted([], width)]
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
