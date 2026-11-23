import type { Register } from 'claude-code'

import { frameLog, frameRow, parseChatFrame } from './chat-welcome-text.ts'

/** rt chat's sign-in and sign-out frames arrive as peer messages, and each would start a turn
    the agent can only spend acknowledging. The mod takes them, leaving a row for the model
    and a line for the person. */
export const register: Register = on => {
  on('session.receive', { origin: { kind: 'peer' } }, async ($, e, next) => {
    const frame = parseChatFrame(e.text)
    if (!frame) return next(e)
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: frameRow(frame) }] } })
    $.ui.log(frameLog(frame))
    return { consumed: `rt chat ${frame.kind} frame` }
  })
}
