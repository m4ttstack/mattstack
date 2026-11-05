import type { RoomSummary } from '@mattstack/rt-client';

/**
 * The rail lists open rooms only, plus the active room when it is closed:
 * a closed room reached by an `rt chat post` link is listed while it is
 * open and gone once the viewer navigates away. This is the one place the
 * client reads `archivedAt` for listing.
 */
export function visibleRooms<T extends RoomSummary>(
  rooms: T[],
  activeRoom: string | undefined
): T[] {
  return rooms.filter(r => r.archivedAt === undefined || r.room === activeRoom);
}

/** Where `/` lands: the open conversation with the newest post. A DM with no
    participants has no name to show, so it never lands. */
export function latestActiveRoom(rooms: RoomSummary[]): string | undefined {
  let latest: RoomSummary | undefined;
  for (const room of rooms) {
    if (room.archivedAt !== undefined) continue;
    if (room.kind === 'dm' && !room.participants) continue;
    if ((room.lastPostedAt ?? 0) > (latest?.lastPostedAt ?? -1)) latest = room;
  }
  return latest?.room;
}
