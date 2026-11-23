import { CURSOR_ROW, FILL, Lines, Panel, cellWidth, ellipsize, kitClient, sp } from '@mattstack/mod-kit'
import type { Line } from '@mattstack/mod-kit'

import { LABELS } from './model'

type Props = { width: number; title: string }

// The message card's header: a band in the thread tone the chat button wears, naming the item, then a blank tinted row
// before the field. Not the brand pink: that is the pane's own title bar.
export function composeHeadRows(title: string, width: number): Line<never>[] {
  const lead = `  ${LABELS.message}  `
  const name = ellipsize(title, Math.max(1, width - cellWidth(lead) - 1))
  const used = cellWidth(lead) + cellWidth(name)
  const band = [sp(lead, FILL.thread), sp(name, { ...FILL.thread, bold: true }), sp(' '.repeat(Math.max(0, width - used)), { bg: FILL.thread.bg })]
  return [band, [sp(' '.repeat(width), { bg: CURSOR_ROW })]]
}

export default kitClient<Props>(props => (
  <Panel width={props.width}>
    <Lines lines={composeHeadRows(props.title, props.width)} />
  </Panel>
))
