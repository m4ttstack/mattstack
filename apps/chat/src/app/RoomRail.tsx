import { Badge, Stack, UnstyledButton } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './fleet-tree.module.css';
import {
  FleetTree,
  listedBuddies,
  SectionLabel,
  type FleetRoom,
} from './FleetTree';
import type { RosterBuddy } from './roster-types';
import { useLiveSlackRoom } from './slack-chats-context';

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
  /** Starts a support chat with a teammate: adds a row at the top of `Direct`. */
  onNewSlackChat?: () => void;
  /** Inside `PageShell.Sidebar`: the sidebar is the surface, so no card. */
  sidebar?: boolean;
  /** Messages to you, pinned above the rooms. Its DMs leave `Direct`. */
  direct?: {
    active: boolean;
    waiting: number;
    onOpen: () => void;
    isMine: (room: FleetRoom) => boolean;
  };
}

/** The one place the human's own DMs are read. */
function DirectRow({
  active,
  waiting,
  onOpen,
}: NonNullable<RoomRailProps['direct']>) {
  return (
    <UnstyledButton
      className={`${classes.listRow} ${classes.pinnedRow}`}
      data-testid="direct-row"
      data-active={active || undefined}
      data-waiting={waiting > 0 || undefined}
      onClick={onOpen}
    >
      <Icon name="atSign" size={18} />
      <span className={classes.pinnedLabel}>Messages to you</span>
      {waiting > 0 && (
        <Badge size="sm" circle color="bad" variant="filled">
          {waiting}
        </Badge>
      )}
    </UnstyledButton>
  );
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
  onNewSlackChat,
  sidebar = false,
  direct,
}: RoomRailProps) {
  const isLive = useLiveSlackRoom();
  // A `dm` room with no participants has no pair to be named by, and
  // falling into channelRooms would render its hashed room id (`roomLabel`
  // in FleetTree.tsx falls back to `#${room.room}` there).
  // A Slack chat still opening has no post yet and is the newest thing here,
  // so it leads the list until it has one.
  const newest = (r: FleetRoom) =>
    r.lastPostedAt ?? (isLive(r.room) ? Infinity : 0);
  const directRooms = rooms
    .filter(r => r.kind === 'dm' && r.participants && !direct?.isMine(r))
    .sort((a, b) => {
      const [x, y] = [newest(a), newest(b)];
      return x === y ? 0 : y > x ? 1 : -1;
    });
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
      {direct && <DirectRow {...direct} />}
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
        onNewSlackChat={onNewSlackChat}
        onClose={onCloseRoom}
      />
    </Stack>
  );
}
