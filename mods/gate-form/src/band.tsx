import type { ClientSurface } from 'claude-code'
import { BRAND, buttonSpan, hitAt, hoverKeyAt, renderLines, sp, type Line } from '@mattstack/mod-kit'

type Props = { formId: string; title: string }
type State = { hover?: string; pressed?: string }
type Action = 'open'

// The band above the prompt while an unanswered form's pane is closed: drawn here, not with the engine's Button,
// so its Open button is the kit's filled one.
export default function GateBand(props: Props, surface: ClientSurface<State>) {
  const s = surface.state ?? {}
  const line: Line<Action> = [
    sp(`${BRAND.glyph} mattstack gate waiting  `, { color: BRAND.pink, bold: true }),
    sp(props.title),
    sp('  '),
    buttonSpan<Action>({ label: 'Open', action: 'open', tone: 'brand' }),
  ]
  const lines = [line]

  // Like the form's buttons: pressed on the way down, acted on when released over the same control.
  surface.onPointer(ev => {
    const key = hoverKeyAt(lines, ev.y, ev.x)
    if (ev.type === 'down') return ev.button === 'left' && key ? surface.setState({ hover: key, pressed: key }) : undefined
    if (ev.type === 'up') {
      if (s.pressed !== undefined && key === s.pressed && hitAt(lines[ev.y], ev.x) === 'open') surface.post({ type: 'reopen', formId: props.formId })
      return surface.setState({ hover: key })
    }
    const hover = ev.type === 'leave' ? undefined : key
    if (hover !== s.hover) surface.setState({ ...s, hover })
  })

  return renderLines(lines, surface.elements, { focused: true, hover: s.hover, pressed: s.pressed === s.hover ? s.pressed : undefined })
}
