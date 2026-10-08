import type { Register } from 'claude-code'
import { registerDelivery, trimReplyUnderSection } from '../src/blocks/delivery.ts'
import { registerPresence } from '../src/blocks/presence.ts'
import { REPLY_RULE_ID, REPLY_RULE_SECTION } from '../src/blocks/sections.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'

export const register: Register = on => {
  const hub = createHub()
  // Subscribed before any block, so command envelopes are consumed before a
  // block's receiver sees the delivery.
  const link = createLink(hub)
  link.start()
  hub.section(REPLY_RULE_ID, () => REPLY_RULE_SECTION)
  registerDelivery(hub, link, { edits: [trimReplyUnderSection] })
  registerPresence(hub, link)
  attachHub(on, hub)
}
