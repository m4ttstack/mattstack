import { cellWidth, cutCells } from '../draw/cells'
import { sp } from '../draw/text'
import { BRAND } from '../draw/theme'
import { buttonSpan } from '../widgets/buttons'
import { kitComponent } from './core'

export type ReopenBandProps = { label: string; title: string; onOpen: () => void }

const GAP = '  '

// The one row of the band above the prompt while a pane is put away: the mattstack mark and label, what waits, and the brand Show button.
// The button stays whole however narrow the band; the words before it give way from the end, so the title goes first.
export const ReopenBand = kitComponent('ReopenBand', (props: ReopenBandProps, ctx) => {
  const button = buttonSpan({ label: 'Show', tone: 'brand', action: ctx.bind('press', props.onOpen) })
  const head = `${BRAND.glyph} ${props.label}`
  const words = `${head}${GAP}${props.title}`
  const room = Math.max(0, ctx.width - cellWidth(button.t) - GAP.length)
  const shown = cellWidth(words) <= room ? words : room > 0 ? `${cutCells(words, room - 1)}…` : ''
  const cut = Math.min(head.length + GAP.length, shown.length)
  return [[sp(shown.slice(0, cut), { color: BRAND.pink, bold: true }), sp(shown.slice(cut)), sp(GAP), button]]
})
