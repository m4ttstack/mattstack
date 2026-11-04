import { Badge, Box, Group, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RoomSummary } from '@mattstack/rt-client';

import { dmPairLabel } from './display-name';
import { DmPairTitle } from './DmPairTitle';
import { RoomMembers, type MemberBuddy } from './RoomMembers';
import { useSlackChat } from './slack-chats-context';

/** Rendered inside `PageShell.Header`, which owns the surface, its padding and
    its border; this is the row's content. */
const PAGE_BAR_ROW = {
  height: '100%',
  width: '100%',
  minWidth: 0,
} as const;

export type PageBarBuddy = MemberBuddy;

export interface PageBarProps {
  room: RoomSummary;
  buddies: PageBarBuddy[];
  /** The room's members with their presence: the bar counts who is in THIS
      room, the roster counts the fleet. */
  reachable?: boolean;
  /** A prop, not `Date.now()` internally, so a DM's task chips are testable
      without fake timers. @default Date.now() */
  now?: number;
}

/** The hash is an icon beside the title, as the artboard draws it, not a
    character in it; a DM is named by its pair. */
function roomTitle(room: RoomSummary): string {
  // A DM is named by its pair, never by its hashed room id (Law 5). A DM
  // that arrives without participants (a direct link to a malformed room)
  // gets a neutral label rather than leaking the hash.
  if (room.kind === 'dm') {
    return room.participants
      ? dmPairLabel(room.participants)
      : 'Direct message';
  }
  return room.room;
}

export function PageBar({
  room,
  buddies,
  reachable = true,
  now = Date.now(),
}: PageBarProps) {
  const slack = useSlackChat(room.room);
  const wakeMode = room.kind === 'dm' ? 'all' : (room.defaultWake ?? 'mention');

  return (
    <Group
      align="center"
      wrap="nowrap"
      gap="sm"
      style={PAGE_BAR_ROW}
      data-testid="page-bar"
    >
      {room.kind !== 'dm' && (
        <Box
          component="span"
          style={{
            display: 'inline-flex',
            flex: 'none',
            color: 'var(--tk-text-4)',
          }}
          data-testid="page-bar-hash"
        >
          <Icon name="hash" size={14} />
        </Box>
      )}
      <Text
        fw={600}
        size="md"
        truncate
        data-testid="page-bar-title"
        style={{ flex: 'none', maxWidth: '45%', minWidth: 0 }}
      >
        {room.kind === 'dm' && room.participants ? (
          <DmPairTitle pair={room.participants} />
        ) : (
          roomTitle(room)
        )}
      </Text>
      {slack && (
        <Badge
          variant="light"
          color="gray"
          radius="sm"
          data-testid="page-bar-slack"
        >
          Slack
        </Badge>
      )}
      <Group
        gap="sm"
        wrap="nowrap"
        style={{ flex: '1 1 0%', minWidth: 0, overflowX: 'auto' }}
      >
        <RoomMembers
          room={room}
          buddies={buddies}
          reachable={reachable}
          now={now}
          wakeMode={wakeMode}
        />
      </Group>
    </Group>
  );
}
