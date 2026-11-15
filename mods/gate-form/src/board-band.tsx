import { BRAND, DIM, Panel, buttonSpan, cellWidth, cutCells, kitClient, kitComponent, sp } from '@mattstack/mod-kit'

import { NO_ADDRESS } from './gate/board'

type BoardBandProps = { text: string; gateId: string; hasAddress: boolean }

const GAP = '  '
const LEAD = `${BRAND.glyph} mattstack`

// One row: the mark, what waits on the board, then the button, or in its place the note that the board can't be found.
// The button or note stays whole however narrow the band. Short of room the mark goes first, then the words give way from the end.
const BoardBand = kitComponent('BoardBand', (props: { text: string; hasAddress: boolean; onOpen: () => void }, ctx) => {
  const end = props.hasAddress ? buttonSpan({ label: 'Open on board', tone: 'brand', action: ctx.bind('open', props.onOpen) }) : sp(NO_ADDRESS, DIM)
  const room = Math.max(0, ctx.width - cellWidth(end.t) - GAP.length)
  const lead = cellWidth(`${LEAD}${GAP}${props.text}`) <= room ? `${LEAD}${GAP}` : ''
  const words = `${lead}${props.text}`
  const shown = cellWidth(words) <= room ? words : room > 0 ? `${cutCells(words, room - 1)}…` : ''
  const cut = Math.min(lead.length, shown.length)
  return [[sp(shown.slice(0, cut), { color: BRAND.pink, bold: true }), sp(shown.slice(cut)), sp(GAP), end]]
})

export default kitClient<BoardBandProps>(
  (props, ui) => (
    <Panel>
      <BoardBand text={props.text} hasAddress={props.hasAddress} onOpen={() => ui.post({ type: 'open-board', gateId: props.gateId })} />
    </Panel>
  ),
  { focused: () => true },
)
