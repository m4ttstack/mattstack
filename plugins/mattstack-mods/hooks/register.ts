import type { Register } from 'claude-code'
import { registerDelivery, trimReplyUnderSection } from '../src/blocks/delivery.ts'
import { registerGateForm } from '../src/blocks/gate-form.ts'
import { registerGatePanel } from '../src/blocks/gate-panel.ts'
import { registerGateWait } from '../src/blocks/gate-wait.ts'
import { registerObserve } from '../src/blocks/observe.ts'
import { registerPolicy } from '../src/blocks/policy.ts'
import { registerPresence } from '../src/blocks/presence.ts'
import { registerRelocation } from '../src/blocks/relocation.ts'
import { REPLY_RULE_ID, REPLY_RULE_SECTION, SPILL_READ_ID, SPILL_READ_SECTION } from '../src/blocks/sections.ts'
import { registerStopGate } from '../src/blocks/stop-gate.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'

export const register: Register = on => {
  const hub = createHub()
  // Subscribed before any block, so command envelopes are consumed before a
  // block's receiver sees the delivery.
  const link = createLink(hub)
  link.start()
  hub.section(REPLY_RULE_ID, () => REPLY_RULE_SECTION)
  hub.section(SPILL_READ_ID, () => SPILL_READ_SECTION)
  registerDelivery(hub, link, { edits: [trimReplyUnderSection] })
  registerPresence(hub, link)
  // Before the stop gate: a Stop the gate holds goes to no block after it.
  registerObserve(hub, link)
  const dialogs = registerGateForm(hub, link)
  registerGateWait(hub, link)
  registerGatePanel(hub, link, dialogs)
  registerPolicy(hub, link)
  registerRelocation(hub, link)
  registerStopGate(hub, link)
  attachHub(on, hub)
}
