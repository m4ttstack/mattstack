import type { HerdRosterRow, RoomSummary } from '@mattstack/rt-client';

/** What a room carries when it belongs to a herd: enough to draw the herd's
    one sidebar row from any of its rooms. */
export interface HerdTag {
  id: string;
  name: string;
  shepherdHandle: string;
  shepherdName: string;
  workers: HerdRosterRow['workers'];
}

/** The herd's own room, or a DM between its shepherd and one of its
    workers. A DM from before a resume or respawn names the old handle and
    stays a plain DM. */
export function inHerd(room: RoomSummary, herd: HerdRosterRow): boolean {
  if (room.room === herd.room) return true;
  const pair = room.kind === 'dm' ? room.participants : undefined;
  if (!pair) return false;
  const other =
    pair.a === herd.shepherdHandle
      ? pair.b
      : pair.b === herd.shepherdHandle
        ? pair.a
        : undefined;
  return other !== undefined && herd.workers.some(w => w.handle === other);
}

export function herdTag(herd: HerdRosterRow): HerdTag {
  return {
    id: herd.id,
    name: herd.name,
    shepherdHandle: herd.shepherdHandle,
    shepherdName: herd.shepherdName,
    workers: herd.workers,
  };
}

export function withHerds<T extends RoomSummary>(
  rooms: T[],
  herds: readonly HerdRosterRow[]
): (T & { herd?: HerdTag })[] {
  if (herds.length === 0) return rooms;
  return rooms.map(room => {
    const herd = herds.find(h => inHerd(room, h));
    return herd ? { ...room, herd: herdTag(herd) } : room;
  });
}
