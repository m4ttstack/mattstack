import type { On } from 'claude-code'

import { bandSlot } from './kit/band-slot'

const PANE = 'fixture-pane'

export function register(on: On): void {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
    const { Client } = $.ui.resolve(e) as { Client: Parameters<typeof bandSlot>[0] }
    return bandSlot(Client, 'waiting')
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Client } = $.ui.resolve(e) as { Client: Parameters<typeof bandSlot>[0] }
    return <Client key="form" module="./form.tsx" props={{ title: 'form' }} />
  })
}
