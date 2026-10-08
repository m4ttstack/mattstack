import type { Register } from 'claude-code'
import { registerDelivery } from '../src/blocks/delivery.ts'
import { attachHub, createHub } from '../src/core/hub.ts'
import { createLink } from '../src/core/link.ts'

export const register: Register = on => {
  const hub = createHub()
  // Subscribed before any block, so command envelopes are consumed before a
  // block's receiver sees the delivery.
  const link = createLink(hub)
  link.start()
  registerDelivery(hub, link)
  attachHub(on, hub)
}
