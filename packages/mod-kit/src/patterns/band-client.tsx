import { kitClient } from '../components/client'
import { Panel } from '../components/panel'
import { ReopenBand } from '../components/reopen-band'

// `bareText`: the hooks module draws the engine's Show button beside the band, so the band draws none.
type BandProps = { formId: string; title: string; label: string; bareText?: boolean }

// The band above the prompt while a pane is closed with something still waiting: drawn here, not with the engine's Button,
// so its Open button is the kit's filled one. It keeps no state of its own beyond the pointer's.
export const bandClient = kitClient<BandProps>(
  (props, ui) => (
    <Panel>
      <ReopenBand label={props.label} title={props.title} {...(!props.bareText && { onOpen: () => ui.post({ type: 'reopen', formId: props.formId }) })} />
    </Panel>
  ),
  { focused: () => true },
)
