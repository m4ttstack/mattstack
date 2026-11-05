import type { ChatMessage, RoomSummary } from '@mattstack/rt-client';

/** The route of Messages to you, the human's one timeline of DMs. */
export const DIRECT_PATH = '/messages';

/** A DM the human is one of the two ends of. Being a silent third party in
    every agent DM does not count: those stay in Direct. */
export function isMine(room: RoomSummary, me: string): boolean {
  if (room.kind !== 'dm' || !room.participants) return false;
  return room.participants.a === me || room.participants.b === me;
}

/** The other end of one of the human's DMs. */
export function otherEnd(
  room: RoomSummary,
  me: string
): { handle: string; name: string } | undefined {
  const pair = room.participants;
  if (!pair) return undefined;
  return pair.a === me
    ? { handle: pair.b, name: pair.bName }
    : { handle: pair.a, name: pair.aName };
}

/** The DM a reply goes to: the newest agent to write, or with only the
    human's own messages, the DM of the newest of those. */
export function newestSenderRoom(
  messages: readonly ChatMessage[],
  me: string
): string | undefined {
  const fromOthers = messages.findLast(m => m.handle !== me);
  return (fromOthers ?? messages.at(-1))?.room;
}

/** Messages from agents the human has not opened Messages to you for. */
export function waitingCount(
  rooms: readonly RoomSummary[],
  me: string
): number {
  return rooms.reduce((n, r) => n + (isMine(r, me) ? r.unread : 0), 0);
}

/** One block per conversation, the most recently active last, each in time
    order, so a reply to an old conversation brings all of it down instead of
    splitting it. Takes the list in time order. */
export function blocksByLatest(
  messages: readonly ChatMessage[]
): ChatMessage[][] {
  const blocks = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    const block = blocks.get(message.room);
    if (block) block.push(message);
    else blocks.set(message.room, [message]);
  }
  return [...blocks.values()].sort((a, b) => a.at(-1)!.id - b.at(-1)!.id);
}
