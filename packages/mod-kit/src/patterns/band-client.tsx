import { kitClient } from '../components/client'
import { Panel } from '../components/panel'
import { ReopenBand } from '../components/reopen-band'

type BandProps = { formId: string; title: string; label: string }

// The band above the prompt while a pane is closed with something still waiting: drawn here, not with the engine's Button,
// so its Open button is the kit's filled one. It keeps no state of its own beyond the pointer's.
export const bandClient = kitClient<BandProps>(
  (props, ui) => (
    <Panel>
      <ReopenBand label={props.label} title={props.title} onOpen={() => ui.post({ type: 'reopen', formId: props.formId })} />
    </Panel>
  ),
  { focused: () => true },
)
