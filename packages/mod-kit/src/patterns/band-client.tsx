import type { ClientSurface } from 'claude-code'

import { renderLines } from '../draw/render'
import { sp, type Line } from '../draw/text'
import { BRAND } from '../draw/theme'
import { attachPointer, type PointerState } from '../interact/pointer'
import { buttonSpan } from '../widgets/buttons'

type BandProps = { formId: string; title: string; label: string }

export const DEFAULT_BAND_LABEL = 'mattstack waiting'

// The band above the prompt while a pane is closed with something still waiting: drawn here, not with the engine's Button,
// so its Open button is the kit's filled one. It keeps no state of its own beyond the pointer's.
export function bandClient(props: BandProps, surface: ClientSurface<PointerState>) {
  if (surface.state === undefined) surface.setState({})
  const lines: Line<'open'>[] = [
    [
      sp(`${BRAND.glyph} ${props.label}  `, { color: BRAND.pink, bold: true }),
      sp(props.title),
      sp('  '),
      buttonSpan<'open'>({ label: 'Open', action: 'open', tone: 'brand' }),
    ],
  ]
  const { look } = attachPointer(surface, lines, { focused: true, onAction: () => surface.post({ type: 'reopen', formId: props.formId }) })
  return renderLines(lines, surface.elements, look)
}
