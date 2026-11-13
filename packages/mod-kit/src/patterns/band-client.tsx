import { BRAND } from '../draw/theme'
import { Button } from '../components/buttons'
import { kitClient } from '../components/client'
import { Row, Span } from '../components/lines'
import { Panel } from '../components/panel'

type BandProps = { formId: string; title: string; label: string }

// The band above the prompt while a pane is closed with something still waiting: drawn here, not with the engine's Button,
// so its Open button is the kit's filled one. It keeps no state of its own beyond the pointer's.
export const bandClient = kitClient<BandProps>(
  (props, ui) => (
    <Panel>
      <Row>
        <Span color={BRAND.pink} bold>
          {`${BRAND.glyph} ${props.label}  `}
        </Span>
        <Span>{props.title}</Span>
        <Span>{'  '}</Span>
        <Button tone="brand" onPress={() => ui.post({ type: 'reopen', formId: props.formId })}>
          Open
        </Button>
      </Row>
    </Panel>
  ),
  { focused: () => true },
)
