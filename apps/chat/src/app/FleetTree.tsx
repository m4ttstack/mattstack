import { Fragment, useState } from 'react';
import { Box, Group, Menu, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';
import type { RoomSummary } from '@mattstack/rt-client';

import { isRoomForRepo } from './agent-state';
import { useBuddies } from './buddies-context';
import { dayKey, dayLabel, localTime } from './day-label';
import { DmNames, DmStack } from './DmPairTitle';
import classes from './fleet-tree.module.css';
import { MUTED_XS } from './presence-bits';
import type { RosterBuddy } from './roster-types';

/** Room and DM rows, one step up, so the tree has a visible hierarchy. */
const CHROME_SIZE = 'var(--mantine-font-size-lg)';

export interface DmLastMessage {
  handle: string;
  name?: string;
  body: string;
}

/** `/api/chat/rooms`' own shape: the daemon's `RoomSummary` plus the newest
    message per DM room, joined in by `src/server/chat.ts` so a DM entry whose
    two ends have no task line still has an honest second line. */
export type FleetRoom = RoomSummary & { lastMessage?: DmLastMessage };

export interface FleetTreeProps {
  /** Channel rooms, in listing order. */
  rooms: FleetRoom[];
  /** DM rooms, in listing order, rendered under `Direct`. */
  dms: FleetRoom[];
  activeRoom?: string;
  onOpenRoom?: (room: string) => void;
  onOpenDm?: (room: string) => void;
  /** The row's right-click menu. It does not render without this. */
  onClose?: (room: string) => void;
}

/** The room an agent's repo maps to. A presence row's `repo` is a display
    label (a local repo's basename, a remote's own casing), while rt names
    rooms by slug and, for a local repo, two path segments. An exact name
    wins; otherwise the slug rule picks among the rooms the agent joined
    (sign-in joins its repo's room), and only a single slug match is trusted
    without that, since two local repos sharing a basename both match. */
function roomForRepo(
  rooms: FleetRoom[],
  buddy: Pick<RosterBuddy, 'repo' | 'rooms'>
): FleetRoom | undefined {
  const { repo } = buddy;
  if (!repo) return undefined;
  const exact = rooms.find(r => r.room === repo);
  if (exact) return exact;
  const matches = rooms.filter(r => isRoomForRepo(r.room, repo));
  return (
    matches.find(r => buddy.rooms.includes(r.room)) ??
    (matches.length === 1 ? matches[0] : undefined)
  );
}

/** The agents the tree lists: those whose repo maps to a room. The fleet
    count reads the same set, so it always matches the rows. */
export function listedBuddies(
  rooms: FleetRoom[],
  buddies: RosterBuddy[]
): RosterBuddy[] {
  return buddies.filter(b => roomForRepo(rooms, b) !== undefined);
}

/** A sidebar section's head: its name, and one quiet fact on the right. */
export function SectionLabel({
  label,
  detail,
}: {
  label: string;
  detail?: string;
}) {
  return (
    <Group
      justify="space-between"
      wrap="nowrap"
      style={{ padding: '10px 16px 6px' }}
    >
      <Text
        component="h3"
        fw={600}
        style={{
          margin: 0,
          fontSize: 'var(--mantine-font-size-lg)',
          color: 'var(--chat-ink)',
        }}
      >
        {label}
      </Text>
      {detail && (
        <Text
          component="span"
          data-testid="section-detail"
          style={{ ...MUTED_XS, color: 'var(--chat-ink-soft)' }}
        >
          {detail}
        </Text>
      )}
    </Group>
  );
}

/** The clock today, the day otherwise, as Slack's list reads. */
function whenLabel(postedAt: number): string {
  return dayKey(postedAt) === dayKey(Date.now())
    ? localTime(postedAt)
    : dayLabel(postedAt);
}

/** A DM's newest message on one plain line, markdown marks removed. */
function previewLine(room: FleetRoom): string | undefined {
  const last = room.lastMessage;
  if (!last) return undefined;
  const text = last.body
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${last.name ?? last.handle}: ${text}`;
}

function RowMenu({
  room,
  testId,
  onChange,
  onClose,
  children,
}: {
  room: FleetRoom;
  testId: string;
  onChange: (opened: boolean) => void;
  onClose: (room: string) => void;
  children: React.ReactElement;
}) {
  const ctx = useBuddies();
  const pair = room.kind === 'dm' ? room.participants : undefined;
  const panes = (pair ? [pair.a, pair.b] : []).flatMap(handle => {
    const paneId = ctx?.byHandle.get(handle)?.pane;
    return paneId ? [{ paneId, name: ctx?.nameOf(handle) ?? handle }] : [];
  });
  const copyLink = () => {
    const link = `${window.location.origin}/r/${encodeURIComponent(room.room)}`;
    void navigator.clipboard
      .writeText(link)
      .then(() => notifications.success('Link copied'));
  };
  return (
    <Menu
      onChange={onChange}
      position="bottom-start"
      offset={2}
      width={240}
      radius="md"
      shadow="md"
      withinPortal
      transitionProps={{ duration: 0 }}
      classNames={{
        dropdown: classes.menuDropdown,
        item: classes.menuItem,
        label: classes.menuLabel,
        divider: classes.menuDivider,
      }}
    >
      <Menu.ContextMenu>{children}</Menu.ContextMenu>
      <Menu.Dropdown data-testid={testId}>
        {panes.length > 0 && (
          <>
            <Menu.Label>
              <Icon name="terminal" size={14} />
              Focus pane
            </Menu.Label>
            {panes.map(pane => (
              <Menu.Item
                key={pane.paneId}
                data-testid={`room-context-focus-${pane.paneId}`}
                onClick={() => ctx?.actions?.focusPane?.(pane.paneId)}
              >
                {pane.name}
              </Menu.Item>
            ))}
            <Menu.Divider />
          </>
        )}
        <Menu.Item
          data-testid="room-context-copy"
          leftSection={<Icon name="link" size={16} />}
          onClick={copyLink}
        >
          Copy link
        </Menu.Item>
        <Menu.Item
          data-testid="room-context-close"
          leftSection={<Icon name="close" size={16} />}
          onClick={() => onClose(room.room)}
        >
          {room.kind === 'dm' ? 'Close conversation' : 'Close room'}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * A tree row is a `div[role=button]`, not a `<button>`: the close control
 * inside it is a real button, and a button may not nest a button. Enter and
 * Space select, like the button they replace. The × shows on hover, on
 * focus within, and while the row's menu is open (all in the CSS module);
 * the menu is Mantine's `Menu.ContextMenu` (right-click, and a long press on
 * touch), positioned at the cursor, one instance per row.
 */
function RoomRow({
  room,
  active,
  onSelect,
  onClose,
}: {
  room: FleetRoom;
  active: boolean;
  onSelect?: () => void;
  onClose?: (room: string) => void;
}) {
  const [menuOpened, setMenuOpened] = useState(false);
  const closable = onClose !== undefined;

  const row = (
    <Box
      role="button"
      tabIndex={0}
      className={classes.listRow}
      data-testid={`room-row-${room.room}`}
      data-active={active ? 'true' : undefined}
      data-menu-open={menuOpened || undefined}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        width: '100%',
        height: 32,
        gap: 8,
        padding: '0 16px',
        cursor: 'pointer',
      }}
    >
      <Icon
        name="hash"
        size={13}
        color="var(--chat-ink-soft)"
        style={{ flex: 'none' }}
      />
      <Text
        fw={active ? 500 : 450}
        truncate
        /* A room heads the rows nested under it, so it takes the chrome step
           while they take meta. Stated rather than inherited: a sizeless
           Mantine `Text` resolves to `md`, not to the body size. */
        style={{ flex: 1, minWidth: 0, fontSize: CHROME_SIZE }}
      >
        {room.room}
      </Text>
    </Box>
  );

  if (!closable) return row;
  return (
    <RowMenu
      room={room}
      testId={`room-context-${room.room}`}
      onChange={setMenuOpened}
      onClose={onClose}
    >
      {row}
    </RowMenu>
  );
}

/**
 * A direct conversation, named by its pair, one line like a channel row. The
 * hashed room name is structurally never rendered -- the pair IS the name.
 * A fixed height keeps the row from growing when the hover × appears.
 */
function DmRow({
  room,
  active,
  onSelect,
  onClose,
}: {
  room: FleetRoom;
  active: boolean;
  onSelect?: () => void;
  onClose?: (room: string) => void;
}) {
  const [menuOpened, setMenuOpened] = useState(false);
  const closable = onClose !== undefined;
  const pair = room.participants!;
  const preview = previewLine(room);

  const row = (
    <Box
      role="button"
      tabIndex={0}
      data-testid={`dm-row-${room.room}`}
      data-active={active ? 'true' : undefined}
      data-menu-open={menuOpened || undefined}
      onClick={onSelect}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={`${classes.listRow} ${classes.dmRow}`}
    >
      <DmStack pair={pair} size={40} />
      <div className={classes.dmText}>
        <Group gap="sm" justify="space-between" wrap="nowrap">
          <Text
            component="div"
            fw={500}
            style={{ fontSize: CHROME_SIZE, minWidth: 0 }}
          >
            <DmNames pair={pair} />
          </Text>
          {room.lastPostedAt !== undefined && (
            <span className={classes.when}>{whenLabel(room.lastPostedAt)}</span>
          )}
        </Group>
        {preview && <div className={classes.preview}>{preview}</div>}
      </div>
    </Box>
  );

  if (!closable) return row;
  return (
    <RowMenu
      room={room}
      testId={`dm-context-${room.room}`}
      onChange={setMenuOpened}
      onClose={onClose}
    >
      {row}
    </RowMenu>
  );
}

/**
 * The sidebar's list: rooms, then direct conversations named by their pair.
 */
export function FleetTree({
  rooms,
  dms,
  activeRoom,
  onOpenRoom,
  onOpenDm,
  onClose,
}: FleetTreeProps) {
  // A DM is named by its pair, so one with no participants has no row.
  const namedDms = dms.filter(d => d.participants);

  return (
    <Fragment>
      {rooms.map(room => (
        <RoomRow
          key={room.room}
          room={room}
          active={room.room === activeRoom}
          onSelect={() => onOpenRoom?.(room.room)}
          onClose={onClose}
        />
      ))}

      {namedDms.length > 0 && (
        <>
          <Box style={{ height: 10 }} />
          <SectionLabel label="Direct" detail={String(namedDms.length)} />
          {namedDms.map(room => (
            <DmRow
              key={room.room}
              room={room}
              active={room.room === activeRoom}
              onSelect={() => onOpenDm?.(room.room)}
              onClose={onClose}
            />
          ))}
        </>
      )}
    </Fragment>
  );
}
