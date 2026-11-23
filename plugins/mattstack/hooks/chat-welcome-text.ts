// rt's daemon opens both frames with this line (FRAME_MARKER in
// lib/daemon/handlers/chat.ts); a change there changes this with it.
const MARKER = '[rt chat] This frame is for THIS session, from the rt daemon (not another agent).'
const SIGNED_IN = /^You're signed in to rt chat as (.+)\.$/m
const SIGNED_OUT = /^You were signed out of rt chat\.$/m
const ROOMS = /^Rooms: (.+)$/m
const CATCH_UP = /^#\S+ catch-up:$/m

export type ChatFrame = { kind: 'signed-in'; name: string; rooms: string[] } | { kind: 'signed-out' }

/** A daemon frame the mod takes in place of a turn, or null for anything else, a welcome with catch-up included. */
export function parseChatFrame(text: string): ChatFrame | null {
  if (!text.includes(MARKER)) return null
  if (SIGNED_OUT.test(text)) return { kind: 'signed-out' }
  // Catch-up lines are unread messages the agent has to act on, so that welcome keeps its turn.
  if (CATCH_UP.test(text)) return null
  const name = SIGNED_IN.exec(text)?.[1]
  if (!name) return null
  const rooms = ROOMS.exec(text)?.[1] ?? ''
  return { kind: 'signed-in', name, rooms: [...rooms.matchAll(/#([^,\s]+)/g)].map(m => m[1]!) }
}

const roomList = (rooms: string[]) => rooms.map(r => `#${r}`).join(', ')

/** The transcript line a person reads. */
export function frameLog(frame: ChatFrame): string {
  if (frame.kind === 'signed-out') return 'Signed out of rt chat'
  return frame.rooms.length ? `Signed in to rt chat as ${frame.name} in ${roomList(frame.rooms)}` : `Signed in to rt chat as ${frame.name}`
}

/** The row the model reads in place of the frame. */
export function frameRow(frame: ChatFrame): string {
  if (frame.kind === 'signed-out') {
    return 'rt chat: you were signed out; chat messages no longer arrive, and rt chat post and dm fail until you sign in again.'
  }
  const where = frame.rooms.length ? ` (${roomList(frame.rooms)})` : ''
  return `rt chat: you are signed in as ${frame.name}${where}; chat messages arrive in your context automatically. Reply with rt chat post <room> "..." or rt chat dm <id> "...", never SendMessage.`
}
