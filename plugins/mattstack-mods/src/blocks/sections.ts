// Imported by rt-side bun tests that compare this text with rt's own, so this
// file takes no imports and never touches the engine.

export const REPLY_RULE_ID = 'reply-rule'

/** The chat reply rule, word for word as rt's sign-in frame states it (`renderWelcome` in rt). */
export const REPLY_RULE_SECTION =
  'Chat replies go through rt chat only, never SendMessage, even though deliveries arrive framed as coming from another session.'

/** The half of rt's per-delivery reply line (`replySteer` in rt) that only a Claude session needs. */
export const CLAUDE_ONLY_TAIL = '(never SendMessage; this arrived through rt chat)'

const STEER = 'reply via rt chat '
const SENDER_HINT = '  reply to '

/**
 * Drops the Claude-only tail from the reply line rt appends to a delivery
 * body, keeping who sent it and how to reply. The reply line is the last line
 * that is not a per-sender hint; any other text, including a message that
 * quotes the tail, is left as it is.
 */
export function trimClaudeOnlyReply(text: string): string {
  const lines = text.split('\n')
  let at = lines.length - 1
  while (at >= 0 && lines[at]?.startsWith(SENDER_HINT)) at--
  const line = lines[at]
  const tail = ` ${CLAUDE_ONLY_TAIL}`
  if (line === undefined || !line.startsWith(STEER) || !line.endsWith(tail)) return text
  lines[at] = line.slice(0, -tail.length)
  return lines.join('\n')
}
