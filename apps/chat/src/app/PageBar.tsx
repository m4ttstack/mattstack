import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Text,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RoomSummary } from '@mattstack/rt-client';

import { dmPairLabel } from './display-name';
import { DmPairTitle } from './DmPairTitle';
import { postMarkRead } from './mark-read';
import { RoomMembers, type MemberBuddy } from './RoomMembers';
import { useExpandAll } from './use-expand-all';

/** Rendered inside `PageShell.Header`, which owns the 64px surface, its
    padding and its border; this is the row's content. */
const PAGE_BAR_ROW = {
  height: '100%',
  width: '100%',
  minWidth: 0,
} as const;

/** The artboard's two 30px controls sit on `bg1` with the hairline border,
    which is Mantine's `default` variant on the tokyo surface tokens. */
const CONTROL_SURFACE = {
  background: 'var(--tk-bg)',
  borderColor: 'var(--tk-border)',
  fontSize: 'var(--mantine-font-size-sm)',
} as const;

const UNREAD_BADGE = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 18,
  padding: '0 var(--mantine-spacing-sm)',
  borderRadius: 'var(--mantine-radius-xl)',
  fontSize: 'var(--mantine-font-size-xs)',
  fontWeight: 500,
  lineHeight: 1,
  border: '1px solid var(--tk-border)',
  color: 'var(--tk-text-4)',
  whiteSpace: 'nowrap',
} as const;

export type PageBarBuddy = MemberBuddy;

export interface PageBarProps {
  room: RoomSummary;
  buddies: PageBarBuddy[];
  /** The room's members with their presence: the bar counts who is in THIS
      room, the roster counts the fleet. */
  reachable?: boolean;
  /** Called after the mark-read POST has already landed: a reaction to the
      mark, not a request to make it (compare `RoomRail`'s `onMarkRead`,
      which does post it). */
  onMarkedRead?: (room: string) => void;
  /** Opens the pane picker to invite agents to this room. The button renders
      only when this is wired, and is disabled while the daemon is down. */
  onAddAgents?: () => void;
  /** A prop, not `Date.now()` internally, so a DM's task chips are testable
      without fake timers. @default Date.now() */
  now?: number;
  /** Set when another listed DM reads the same pair (`repeatedPairLabels`):
      the title then carries each end's id-seeded avatar. */
  withAvatars?: boolean;
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

function markReadLabel(room: RoomSummary): string {
  return room.kind === 'dm'
    ? 'Mark conversation read'
    : `Mark #${room.room} read`;
}

function closeLabel(room: RoomSummary): string {
  return room.kind === 'dm' ? 'Close this conversation' : `Close #${room.room}`;
}

/** The ⋯ control and its one item. One component for the desk's page bar
    and the phone header; at the phone's 44px the item grows to match. */
export function RoomMenu({
  room,
  onClose,
  size = 30,
}: {
  room: RoomSummary;
  onClose?: (room: string) => void;
  size?: number;
}) {
  return (
    <Menu
      position="bottom-end"
      transitionProps={{ transition: 'pop-top-right' }}
      withinPortal
      radius="md"
      shadow="md"
      styles={{
        item: {
          minHeight: size >= 44 ? 44 : 24,
          color: 'var(--tk-text-1)',
          // The 44px touch variant grows its type and padding to the tap
          // scale; the desk keeps Mantine's default item size.
          ...(size >= 44
            ? {
                fontSize: 'var(--mantine-font-size-sm)',
                padding: '3.2px 9.6px',
              }
            : {}),
        },
        dropdown: {
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--tk-panel)',
        },
      }}
    >
      <Menu.Target>
        <ActionIcon
          variant="default"
          size={size}
          radius="md"
          aria-label="Room actions"
          data-testid="room-menu"
          styles={{ root: CONTROL_SURFACE }}
        >
          <Icon name="moreHorizontal" size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="room-menu-dropdown">
        <Menu.Item
          data-testid="room-menu-close"
          leftSection={<Icon name="close" size={14} />}
          onClick={() => onClose?.(room.room)}
        >
          {closeLabel(room)}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

export function PageBar({
  room,
  buddies,
  reachable = true,
  onMarkedRead,
  onAddAgents,
  now = Date.now(),
  withAvatars = false,
}: PageBarProps) {
  const [expandAll, setExpandAll] = useExpandAll();
  const handleMarkRead = () => {
    void postMarkRead(room.room)
      .then(() => onMarkedRead?.(room.room))
      .catch(() => {});
  };

  const title = (
    <>
      {room.kind !== 'dm' && (
        <Box
          component="span"
          style={{
            display: 'inline-flex',
            flex: 'none',
            color: 'var(--tk-text-2)',
          }}
          data-testid="page-bar-hash"
        >
          <Icon name="hash" size={18} />
        </Box>
      )}
      <Text
        fw={700}
        size="xl"
        lh={1.35}
        truncate
        data-testid="page-bar-title"
        style={{ flex: 'none', maxWidth: '38%', minWidth: 0 }}
      >
        {room.kind === 'dm' && room.participants ? (
          <DmPairTitle pair={room.participants} withAvatars={withAvatars} />
        ) : (
          roomTitle(room)
        )}
      </Text>
      <Box style={{ width: 4.8, flex: 'none' }} />
    </>
  );

  const controls = (
    <>
      {onAddAgents && (
        <Button
          variant="default"
          size="sm"
          radius="md"
          mr="sm"
          data-testid="add-agents-button"
          aria-label={`Add agents to #${room.room}`}
          onClick={onAddAgents}
          disabled={!reachable}
          leftSection={<Icon name="userPlus" size={14} />}
        >
          add agents
        </Button>
      )}
      {room.unread > 0 && (
        <Button
          variant="default"
          size="sm"
          radius="md"
          data-testid="mark-read-button"
          aria-label={markReadLabel(room)}
          onClick={handleMarkRead}
          leftSection={<Icon name="check" size={14} />}
          rightSection={
            <Box component="span" style={UNREAD_BADGE}>
              {room.unread}
            </Box>
          }
        >
          mark read
        </Button>
      )}
      <Tooltip
        label={expandAll ? 'Clip long messages' : 'Show every message in full'}
        position="bottom"
        withinPortal
      >
        <ActionIcon
          variant={expandAll ? 'filled' : 'default'}
          color={expandAll ? 'accent' : undefined}
          size="input-sm"
          radius="md"
          ml="sm"
          aria-label="Expand all messages"
          aria-pressed={expandAll}
          data-testid="expand-all-toggle"
          onClick={() => setExpandAll(!expandAll)}
        >
          <Icon
            name={expandAll ? 'foldVertical' : 'unfoldVertical'}
            size={16}
          />
        </ActionIcon>
      </Tooltip>
    </>
  );

  const wakeMode = room.kind === 'dm' ? 'all' : (room.defaultWake ?? 'mention');

  return (
    <Group
      align="center"
      wrap="nowrap"
      gap="sm"
      style={PAGE_BAR_ROW}
      data-testid="page-bar"
    >
      {title}
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
      <Group gap={0} ml="auto" wrap="nowrap">
        {controls}
      </Group>
    </Group>
  );
}
