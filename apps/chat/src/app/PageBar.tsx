import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Skeleton,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RoomSummary } from '@mattstack/rt-client';

import { dmPairLabel } from './display-name';
import { DmPairTitle } from './DmPairTitle';
import { RoomMembers, type MemberBuddy } from './RoomMembers';
import { useLiveSlackRoom, useSlackChat } from './slack-chats-context';

/** Rendered inside `PageShell.Header`, which owns the surface, its padding and
    its border; this is the row's content. */
const PAGE_BAR_ROW = {
  height: '100%',
  width: '100%',
  minWidth: 0,
  paddingInline: 8,
} as const;

export type PageBarBuddy = MemberBuddy;

export interface PageBarProps {
  room: RoomSummary;
  buddies: PageBarBuddy[];
  /** The room's member list is still on its way: the pill holds its place. */
  membersLoading?: boolean;
  /** Closes the room. A live Slack chat has no button: closing one says
      goodbye to a teammate, so it stays a choice made from its row. */
  onArchive?: (room: string) => void;
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
  membersLoading = false,
  onArchive,
  reachable = true,
  now = Date.now(),
}: PageBarProps) {
  const slack = useSlackChat(room.room);
  const isLive = useLiveSlackRoom();
  const label = room.kind === 'dm' ? 'Archive conversation' : 'Archive room';
  const wakeMode = room.kind === 'dm' ? 'all' : (room.defaultWake ?? 'mention');
  const title = (
    <>
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
        component="span"
        fw={500}
        size="lg"
        truncate
        data-testid="page-bar-title"
        style={{ minWidth: 0, color: 'var(--tk-text-1)' }}
      >
        {room.kind === 'dm' && room.participants ? (
          <DmPairTitle pair={room.participants} />
        ) : (
          roomTitle(room)
        )}
      </Text>
    </>
  );

  return (
    <Group
      align="center"
      wrap="nowrap"
      gap="sm"
      style={PAGE_BAR_ROW}
      data-testid="page-bar"
    >
      {membersLoading ? (
        <>
          {title}
          <Skeleton
            height={18}
            width={34}
            radius="sm"
            data-testid="members-skeleton"
          />
        </>
      ) : (
        <RoomMembers
          room={room}
          buddies={buddies}
          reachable={reachable}
          now={now}
          wakeMode={wakeMode}
          title={title}
        />
      )}
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
      {onArchive && !isLive(room.room) && (
        <Tooltip label={label}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={28}
            aria-label={label}
            onClick={() => onArchive(room.room)}
            style={{ marginLeft: 'auto', flex: 'none' }}
          >
            <Icon name="archive" size={16} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}
