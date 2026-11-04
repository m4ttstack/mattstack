import { Fragment, useState } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  Menu,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RoomSummary } from '@mattstack/rt-client';

import { agentState, isRoomForRepo, stateLine } from './agent-state';
import { AgentHoverCard, AgentName } from './AgentName';
import { dayKey, dayLabel, localTime } from './day-label';
import { displayName, dmPairLabel, sameNameOrdinals } from './display-name';
import { DmNames, DmStack } from './DmPairTitle';
import { doing } from './doing';
import classes from './fleet-tree.module.css';
import { MUTED_XS } from './presence-bits';
import type { RosterBuddy } from './roster-types';
import { StateDot } from './StateDot';

/** Clears the room row's hash, so a handle lines up under the room's name. */
const WORKSTREAM_INDENT = 37;

/** From a workstream row's right edge to the sidebar's outer edge: the
    sidebar's inline padding plus its hairline, so a docked card meets the
    border instead of floating off it. */
const SIDEBAR_DOCK_OFFSET = 7;

/** A workstream handle, nested under its room. */
const ROW_NAME_SIZE = 'var(--mantine-font-size-xs)';
/** Room and DM rows, one step up, so the tree has a visible hierarchy. */
const CHROME_SIZE = 'var(--mantine-font-size-lg)';

/** DM rows shown before the `N more` line, so the rooms stay in reach. */
const DM_VISIBLE = 8;

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
  /** Channel rooms, in listing order: each heads the group of agents working
      in the repo it is named for. */
  rooms: FleetRoom[];
  /** DM rooms, in listing order, rendered under `Direct`. */
  dms: FleetRoom[];
  /** The whole fleet, not one room's members. An agent is listed under the
      room named for its repo; one whose repo has no room is left out. */
  buddies: RosterBuddy[];
  /** A prop, not `Date.now()` internally, so ages are testable without fake
      timers. */
  now: number;
  activeRoom?: string;
  /** Withholds every presence claim when false. @default true */
  daemonReachable?: boolean;
  onOpenRoom?: (room: string) => void;
  onOpenDm?: (room: string) => void;
  /** Desktop: brings a workstream's herdr pane to the front. A row whose
      buddy has no pane, or that is rendered without this (and without
      `onSelectBuddy`), is not clickable. */
  onFocusPane?: (paneId: string) => void;
  /** Phone: opens a DM with the workstream's buddy instead of focusing a
      pane. Takes priority over `onFocusPane` -- callers wire one or the
      other, never both. */
  onSelectBuddy?: (handle: string) => void;
  /** The row's hover × and its right-click menu. Neither renders without it. */
  onClose?: (room: string) => void;
}

export interface FleetGroup {
  repo: string;
  room: FleetRoom;
  online: RosterBuddy[];
  offline: RosterBuddy[];
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

/**
 * One group per room, in listing order, holding the agents working in the
 * repo it is named for (the room sign-in derives from that repo's cwd).
 *
 * Members keep sign-in order inside a group and are never re-sorted by status,
 * so a working<->idle flip cannot move a row out from under the pointer.
 */
export function groupByRepo(
  rooms: FleetRoom[],
  buddies: RosterBuddy[]
): FleetGroup[] {
  const byRoom = new Map<string, RosterBuddy[]>();
  for (const buddy of [...buddies].sort(
    (a, b) => a.signedInAt - b.signedInAt
  )) {
    const room = roomForRepo(rooms, buddy);
    if (!room) continue;
    const members = byRoom.get(room.room);
    if (members) members.push(buddy);
    else byRoom.set(room.room, [buddy]);
  }

  const split = (members: RosterBuddy[]) => ({
    online: members.filter(b => b.status !== 'offline'),
    offline: members.filter(b => b.status === 'offline'),
  });

  return rooms.map(room => ({
    repo: room.room,
    room,
    ...split(byRoom.get(room.room) ?? []),
  }));
}

/** The agents the tree lists: those whose repo maps to a room. The fleet
    count reads the same set, so it always matches the rows. */
export function listedBuddies(
  rooms: FleetRoom[],
  buddies: RosterBuddy[]
): RosterBuddy[] {
  return buddies.filter(b => roomForRepo(rooms, b) !== undefined);
}

/**
 * The first `cap` conversations, with the open one always among them: an
 * overflowed DM is otherwise unreachable, since the human is a silent third
 * party in an agent-to-agent pair and nothing else in the UI opens one. An
 * active DM past the cap displaces the last visible row rather than adding a
 * fifth, so the drawn count holds.
 */
export function visibleDms(
  dms: FleetRoom[],
  activeRoom: string | undefined,
  cap: number = DM_VISIBLE
): FleetRoom[] {
  if (dms.length <= cap) return dms;
  const head = dms.slice(0, cap);
  if (head.some(d => d.room === activeRoom)) return head;
  const active = dms.find(d => d.room === activeRoom);
  return active ? [...head.slice(0, cap - 1), active] : head;
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
        fw={700}
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

function roomLabel(room: FleetRoom): string {
  return room.kind === 'dm' && room.participants
    ? dmPairLabel(room.participants)
    : `#${room.room}`;
}

/** The 22px × plus the row's right-click menu, the pair of close
    affordances every room and DM row carries. The × always holds its slot
    and only fades in (`.close` in the CSS module), so revealing it never
    moves the badges under the pointer. */
function CloseControl({
  room,
  testId,
  onClose,
}: {
  room: FleetRoom;
  testId: string;
  onClose: (room: string) => void;
}) {
  return (
    <Tooltip label="Close" position="top" withinPortal>
      <ActionIcon
        variant="subtle"
        size="sm"
        radius="sm"
        color="gray"
        className={classes.close}
        aria-label={`Close ${roomLabel(room)}`}
        data-testid={testId}
        onClick={e => {
          e.stopPropagation();
          onClose(room.room);
        }}
        style={{
          // Icon-tint default (--tk-text-3): `CloseControl` mounts from
          // both `RoomRow` (chrome step) and `DmRow` (meta step), so one
          // shared tint cannot follow either row's text colour; it reads the
          // plan's own unknown-size fallback instead.
          color: 'var(--tk-text-3)',
        }}
      >
        <Icon name="close" size={14} />
      </ActionIcon>
    </Tooltip>
  );
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
  return (
    <Menu onChange={onChange} radius="md" shadow="md" withinPortal>
      <Menu.ContextMenu>{children}</Menu.ContextMenu>
      <Menu.Dropdown data-testid={testId}>
        <Menu.Label>{roomLabel(room)}</Menu.Label>
        <Menu.Item
          data-testid="room-context-close"
          leftSection={<Icon name="close" size={14} />}
          onClick={() => onClose(room.room)}
        >
          Close
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
        fw={active ? 600 : 500}
        truncate
        /* A room heads the rows nested under it, so it takes the chrome step
           while they take meta. Stated rather than inherited: a sizeless
           Mantine `Text` resolves to `md`, not to the body size. */
        style={{ flex: 1, minWidth: 0, fontSize: CHROME_SIZE }}
      >
        {room.room}
      </Text>
      {closable && (
        <CloseControl
          room={room}
          testId={`room-close-${room.room}`}
          onClose={onClose}
        />
      )}
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

/** One signed-in session inside its repo: dot, handle, and the task line
    filling the rest of the row. Clicking brings its pane to the front. */
function WorkstreamRow({
  buddy,
  ordinal,
  now,
  reachable,
  onFocusPane,
  onSelectBuddy,
}: {
  buddy: RosterBuddy;
  /** Set when another rendered row shares this name: `remy (1 of 2)`. The
      row then shows its id-seeded avatar and labels itself by this. */
  ordinal?: string;
  now: number;
  reachable: boolean;
  /** Desktop: brings the buddy's herdr pane to the front. Ignored when
      `onSelectBuddy` is given -- the two are mutually exclusive per caller,
      never both wired to the same tree. */
  onFocusPane?: (paneId: string) => void;
  /** Phone: opens a DM with the buddy instead. Focusing a pane is
      meaningless on a phone -- the whole premise of the phone surface is
      that Matt is away from the machine -- so this takes priority over
      `onFocusPane` whenever both are somehow present. */
  onSelectBuddy?: (handle: string) => void;
}) {
  const { handle, pane } = buddy;
  const shown = ordinal ?? displayName(buddy);
  const task = reachable ? doing(buddy, now) : null;
  const onClick = onSelectBuddy
    ? () => onSelectBuddy(handle)
    : pane !== undefined && onFocusPane
      ? () => onFocusPane(pane)
      : undefined;
  const clickable = onClick !== undefined;
  const state = reachable ? agentState(buddy) : 'offline';
  const row = (
    <UnstyledButton
      className={classes.wsRow}
      component={clickable ? 'button' : 'div'}
      data-testid={`ws-${handle}`}
      aria-label={
        onSelectBuddy
          ? `Message ${shown}`
          : clickable
            ? `Focus ${shown}'s pane`
            : undefined
      }
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        height: 26,
        gap: 7,
        padding: `0 16px 0 ${WORKSTREAM_INDENT}px`,
        cursor: clickable ? 'pointer' : 'default',
        textAlign: 'left',
      }}
    >
      <Tooltip
        label={
          reachable
            ? stateLine(buddy, now)
            : 'presence withheld while the daemon is down'
        }
        position="left"
        openDelay={300}
        withArrow
      >
        <Box component="span" className={classes.dotSlot}>
          <StateDot state={state} testId={`dot-${handle}`} />
        </Box>
      </Tooltip>
      <Text
        component="span"
        fw={500}
        data-testid={`ws-handle-${handle}`}
        style={{ fontSize: ROW_NAME_SIZE, flex: 'none' }}
      >
        <AgentName
          handle={handle}
          variant="name"
          withAvatar={ordinal !== undefined}
          withCard={false}
          buddy={buddy}
          reachable={reachable}
          now={now}
        />
      </Text>
      <Text
        component="span"
        truncate
        data-testid={`ws-doing-${handle}`}
        style={{
          ...MUTED_XS,
          flex: 1,
          minWidth: 0,
        }}
      >
        {reachable ? (task?.text ?? '') : 'presence withheld'}
      </Text>
    </UnstyledButton>
  );
  // The phone path opens a DM on tap and has no hover, so only the desktop
  // tree docks the card, flush to the sidebar's right edge, level with the
  // row. The row stays marked while its card is open (`aria-expanded`), so
  // moving onto the card never loses which agent it describes.
  if (onSelectBuddy) return row;
  return (
    <AgentHoverCard
      buddy={buddy}
      position="right-start"
      offset={SIDEBAR_DOCK_OFFSET}
      reachable={reachable}
      now={now}
      task={task}
    >
      {row}
    </AgentHoverCard>
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
            fw={600}
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
      {closable && (
        <CloseControl
          room={room}
          testId={`dm-close-${room.room}`}
          onClose={onClose}
        />
      )}
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
 * The `N more` control. It shares the offline roll-up's look (26px, muted,
 * truncating) but not its `cursor: default`: this one is the only way to
 * reach a conversation the cap hides, so it has to answer a click.
 */
function DmOverflowRow({
  hidden,
  expanded,
  onToggle,
}: {
  hidden: FleetRoom[];
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <UnstyledButton
      className={classes.moreRow}
      data-testid="dm-more"
      aria-expanded={expanded}
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        height: 26,
        gap: 'var(--mantine-spacing-sm)',
        padding: '0 16px',
        cursor: 'pointer',
        textAlign: 'left',
        ...MUTED_XS,
      }}
    >
      <Text component="span" inherit truncate style={{ minWidth: 0 }}>
        {expanded ? 'show fewer' : `${hidden.length} more`}
      </Text>
    </UnstyledButton>
  );
}

/**
 * The sidebar's one tree. The open room lists the signed-in sessions of the
 * repo it is named for; the other rooms stay one line each. Direct
 * conversations follow, named by their pair.
 */
export function FleetTree({
  rooms,
  dms,
  buddies,
  now,
  activeRoom,
  daemonReachable = true,
  onOpenRoom,
  onOpenDm,
  onFocusPane,
  onSelectBuddy,
  onClose,
}: FleetTreeProps) {
  const [dmsExpanded, setDmsExpanded] = useState(false);
  const groups = groupByRepo(rooms, buddies);
  // A DM is named by its pair, so a participant-less one would crash DmRow and
  // overflowLabel. RoomRail filters them upstream, but the exported FleetTree
  // guards its own input too. `namedDms` is then already `visibleRooms`-filtered,
  // so the cap counts only conversations that are actually listed.
  const namedDms = dms.filter(d => d.participants);
  const shownDms = dmsExpanded ? namedDms : visibleDms(namedDms, activeRoom);
  const hiddenDms = namedDms.filter(d => !shownDms.includes(d));
  const ordinals = sameNameOrdinals(
    groups.flatMap(g => g.online),
    displayName
  );

  return (
    <Fragment>
      {groups.map(group => (
        <Fragment key={group.repo}>
          <RoomRow
            room={group.room}
            active={group.room.room === activeRoom}
            onSelect={() => onOpenRoom?.(group.repo)}
            onClose={onClose}
          />
          {group.room.room === activeRoom &&
            group.online.map(buddy => (
              <WorkstreamRow
                key={buddy.handle}
                buddy={buddy}
                ordinal={ordinals.get(buddy)}
                now={now}
                reachable={daemonReachable}
                onFocusPane={onFocusPane}
                onSelectBuddy={onSelectBuddy}
              />
            ))}
        </Fragment>
      ))}

      {namedDms.length > 0 && (
        <>
          <Box style={{ height: 10 }} />
          <SectionLabel label="Direct" detail={String(namedDms.length)} />
          {shownDms.map(room => (
            <DmRow
              key={room.room}
              room={room}
              active={room.room === activeRoom}
              onSelect={() => onOpenDm?.(room.room)}
              onClose={onClose}
            />
          ))}
          {(hiddenDms.length > 0 || dmsExpanded) && (
            <DmOverflowRow
              hidden={hiddenDms}
              expanded={dmsExpanded}
              onToggle={() => setDmsExpanded(!dmsExpanded)}
            />
          )}
        </>
      )}
    </Fragment>
  );
}
