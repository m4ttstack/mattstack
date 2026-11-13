import { BRAND } from '../draw/theme'
import { Button } from './buttons'
import { Row, Span } from './lines'

export type ReopenBandProps = { label: string; title: string; onOpen: () => void }

// The one row of the band above the prompt while a pane is put away: the mattstack mark and label, what waits, and the brand Open button.
export function ReopenBand(props: ReopenBandProps) {
  return (
    <Row>
      <Span color={BRAND.pink} bold>
        {`${BRAND.glyph} ${props.label}  `}
      </Span>
      <Span>{props.title}</Span>
      <Span>{'  '}</Span>
      <Button tone="brand" onPress={props.onOpen}>
        Open
      </Button>
    </Row>
  )
}
