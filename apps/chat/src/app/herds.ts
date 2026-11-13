import type { HerdTag } from '../server/herds';
import type { DmLastMessage, FleetRoom } from './FleetTree';

export const HERD_PREFIX = '/h/';

export function herdPath(id: string): string {
  return `${HERD_PREFIX}${encodeURIComponent(id)}`;
}

/** One herd's rooms, drawn as a single sidebar row. */
export interface HerdGroup {
  tag: HerdTag;
  rooms: FleetRoom[];
  lastPostedAt?: number;
  /** The newest DM line: the herd's own room carries none. */
  lastMessage?: DmLastMessage;
}

/** The herds the listing tags, in first-seen order. */
export function groupHerds(rooms: readonly FleetRoom[]): HerdGroup[] {
  const groups = new Map<string, HerdGroup>();
  // The preview tracks the newest room that has a line, apart from the
  // newest post: the herd's own room can be newest and carries none.
  const previewAt = new Map<string, number>();
  for (const room of rooms) {
    if (!room.herd) continue;
    const id = room.herd.id;
    let group = groups.get(id);
    if (!group) {
      group = { tag: room.herd, rooms: [] };
      groups.set(id, group);
    }
    group.rooms.push(room);
    const at = room.lastPostedAt;
    if (at === undefined) continue;
    if ((group.lastPostedAt ?? -1) < at) group.lastPostedAt = at;
    if (room.lastMessage && (previewAt.get(id) ?? -1) < at) {
      previewAt.set(id, at);
      group.lastMessage = room.lastMessage;
    }
  }
  return [...groups.values()];
}

/** The worker a herd room belongs to: the far end of the shepherd's DM.
    The herd's own room has none. */
export function workerOf(
  room: FleetRoom | undefined,
  tag: HerdTag
): HerdTag['workers'][number] | undefined {
  const pair = room?.kind === 'dm' ? room.participants : undefined;
  if (!pair) return undefined;
  const other = pair.a === tag.shepherdHandle ? pair.b : pair.a;
  return tag.workers.find(w => w.handle === other);
}

export type DirectEntry<T> =
  { kind: 'dm'; room: T } | { kind: 'herd'; group: HerdGroup };

/** DMs as they come, each herd placed ahead of the first DM it is newer
    than. */
export function mergeByNewest<T>(
  dms: readonly T[],
  herds: readonly HerdGroup[],
  newest: (room: T) => number
): DirectEntry<T>[] {
  const pending = [...herds].sort(
    (a, b) => (b.lastPostedAt ?? 0) - (a.lastPostedAt ?? 0)
  );
  const out: DirectEntry<T>[] = [];
  for (const room of dms) {
    while (
      pending.length > 0 &&
      (pending[0]!.lastPostedAt ?? 0) > newest(room)
    ) {
      out.push({ kind: 'herd', group: pending.shift()! });
    }
    out.push({ kind: 'dm', room });
  }
  return [...out, ...pending.map(group => ({ kind: 'herd' as const, group }))];
}
