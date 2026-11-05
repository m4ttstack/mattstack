import { Stack } from '@mattstack/app-kit/core';

import {
  FleetTree,
  listedBuddies,
  SectionLabel,
  type FleetRoom,
} from './FleetTree';
import type { RosterBuddy } from './roster-types';

export interface RoomRailProps {
  rooms: FleetRoom[];
  /** The whole fleet: the tree groups these by repo under each room. */
  buddies?: RosterBuddy[];
  /** The room open in the transcript, so its row carries the accent wash. */
  activeRoom?: string;
  onSelectRoom?: (room: string) => void;
  /** rt daemon reachability: every presence claim in the tree is withheld
      while it is down. @default true */
  daemonReachable?: boolean;
  /** Closes a room (leaves it off the listing until a post revives it): the
      row's hover × and its right-click menu. Neither renders when this is
      absent. */
  onCloseRoom?: (room: string) => void;
  /** Inside `PageShell.Sidebar`: the sidebar is the surface, so no card. */
  sidebar?: boolean;
}

/**
 * The sidebar: a `Rooms` header carrying how many agents are working, then
 * the tree itself. The rail owns the frame and the header; `FleetTree`
 * owns every row inside it.
 */
export function RoomRail({
  rooms,
  buddies = [],
  activeRoom,
  onSelectRoom,
  daemonReachable = true,
  onCloseRoom,
  sidebar = false,
}: RoomRailProps) {
  // A `dm` room with no participants has no pair to be named by, and
  // falling into channelRooms would render its hashed room id (`roomLabel`
  // in FleetTree.tsx falls back to `#${room.room}` there).
  const directRooms = rooms
    .filter(r => r.kind === 'dm' && r.participants)
    .sort((a, b) => (b.lastPostedAt ?? 0) - (a.lastPostedAt ?? 0));
  const channelRooms = rooms.filter(r => r.kind !== 'dm');
  const working = listedBuddies(channelRooms, buddies).filter(
    b => b.status === 'live'
  ).length;

  return (
    <Stack
      gap={0}
      style={{
        width: sidebar ? '100%' : 232 + 12,
        flex: sidebar ? 1 : 'none',
        minWidth: 0,
        background: sidebar ? undefined : 'var(--tk-panel)',
        border: sidebar ? undefined : '1px solid var(--tk-border)',
        borderRadius: sidebar ? undefined : 'var(--mantine-radius-md)',
        padding: '6px 0 14px',
        alignSelf: 'stretch',
        overflowY: sidebar ? undefined : 'auto',
      }}
      data-testid="room-rail"
    >
      <SectionLabel
        label="Rooms"
        detail={daemonReachable ? `${working} working` : 'last known'}
      />

      <FleetTree
        rooms={channelRooms}
        dms={directRooms}
        activeRoom={activeRoom}
        onOpenRoom={onSelectRoom}
        onOpenDm={onSelectRoom}
        onClose={onCloseRoom}
      />
    </Stack>
  );
}
