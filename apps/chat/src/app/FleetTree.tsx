import { Fragment, useState, type ReactNode } from 'react';
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
import {
  displayName,
  dmPairLabel,
  repeatedPairLabels,
  sameNameOrdinals,
} from './display-name';
import { doing } from './doing';
import classes from './fleet-tree.module.css';
import { MUTED_XS } from './presence-bits';
import type { RosterBuddy } from './roster-types';
import { StateDot } from './StateDot';
import { statusDetail } from './statusDetail';

/**
 * `.accent-deep` has no direct `--tk-*` token: the artboard's own palette
 * only defines it as a DERIVATION (`.app --accent-deep: #206cd2`, a specific
 * shade one step past plain accent; `.app.dark --accent-deep: var(--accent)`,
 * i.e. no separate shade at all in dark). `--mantine-color-accent-7` is
 * exactly the light shade the ramp was resampled to land on; the dark half
 * collapses back to the plain accent text color. `light-dark()` is the same
 * idiom `useSchemeColors.ts` already uses for a per-scheme formula that
 * ISN'T just "the same var, different scheme block".
 */
const ACCENT_DEEP =
  'light-dark(var(--mantine-color-accent-7), var(--mantine-color-accent-text))';
const ACCENT_ON = 'light-dark(var(--mantine-color-white), var(--tk-bg))';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';
const ACCENT_WASH = `color-mix(in srgb, ${ACCENT_TEXT} var(--tk-wash), transparent)`;
const BORDER = 'var(--tk-border)';

/** `.ws`'s own `padding-left`. No spacing token lands on it: it is the room
    row's 9.6px plus the tree's one indent step. */
const WORKSTREAM_INDENT = 26.4;

/** From a workstream row's right edge to the sidebar's outer edge: the
    sidebar's inline padding plus its hairline, so a docked card meets the
    border instead of floating off it. */
const SIDEBAR_DOCK_OFFSET = 7;

/** Everything nested inside a room -- workstream handles, DM names -- reads
    at meta. */
const ROW_NAME_SIZE = 'var(--mantine-font-size-xs)';
/** The room row itself, one step up, so the tree has a visible hierarchy. */
const CHROME_SIZE = 'var(--mantine-font-size-sm)';

/** The artboards draw four `.dm2` rows, then the `N more` line. */
const DM_VISIBLE = 4;

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
  /** DM rooms, in listing order, rendered under `DIRECT`. */
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
  /** The right-click menu's Mark read, offered only on a row with unread. */
  onMarkRead?: (room: string) => void;
}

export interface FleetGroup {
  repo: string;
  room: FleetRoom;
  online: RosterBuddy[];
  offline: RosterBuddy[];
}

/** The room an agent's repo maps to. A presence row's `repo` is a display
    label (a local repo's basename, a remote's own casing), while rt names
    rooms by slug and, for a local repo, two path segments, so an exact name
    is tried first and the slug rule only when none matches. */
function roomForRepo(
  rooms: FleetRoom[],
  repo: string | undefined
): FleetRoom | undefined {
  if (!repo) return undefined;
  return (
    rooms.find(r => r.room === repo) ??
    rooms.find(r => isRoomForRepo(r.room, repo))
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
    const room = roomForRepo(rooms, buddy.repo);
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
  return buddies.filter(b => roomForRepo(rooms, b.repo) !== undefined);
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

/** `3 more · kai ↔ max [1], max ↔ wren [8]`: every hidden pair with its
    unread as the rows' own badge, since bare trailing digits read as part of
    a name. Truncates when the line runs past the sidebar. */
function overflowLabel(hidden: FleetRoom[]): ReactNode {
  return (
    <>
      {hidden.length} more ·{' '}
      {hidden.map((d, i) => (
        <Fragment key={d.room}>
          {i > 0 && ', '}
          {dmPairLabel(d.participants!)}
          {d.unread > 0 && (
            <>
              {' '}
              <UnreadBadge count={d.unread} />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}

/**
 * `@N`, filled accent. The glyph -- not just the colour -- is what
 * distinguishes this from `UnreadBadge`: a colourblind reader, or a
 * screenshot, still gets the difference.
 */
function MentionBadge({ count }: { count: number }) {
  return (
    <Box
      component="span"
      aria-label={`${count} mention`}
      data-testid="mention-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        lineHeight: 1,
        borderRadius: 'var(--mantine-radius-xl)',
        padding: '0 var(--mantine-spacing-sm)',
        fontSize: 'var(--mantine-font-size-xs)',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flex: 'none',
        background: ACCENT_DEEP,
        color: ACCENT_ON,
      }}
    >
      @{count}
    </Box>
  );
}

/** Plain `N`, outlined -- the difference from `MentionBadge` is the glyph. */
function UnreadBadge({ count }: { count: number }) {
  return (
    <Box
      component="span"
      aria-label={`${count} unread`}
      data-testid="unread-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        lineHeight: 1,
        borderRadius: 'var(--mantine-radius-xl)',
        padding: '0 var(--mantine-spacing-sm)',
        fontSize: 'var(--mantine-font-size-xs)',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        flex: 'none',
        border: `1px solid ${BORDER}`,
        color: 'var(--tk-text-4)',
      }}
    >
      {count}
    </Box>
  );
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
  nudge,
  onClose,
}: {
  room: FleetRoom;
  testId: string;
  /** `.room .close` pulls back into the row's own padding; `.dm2 .close`
      does not. */
  nudge: boolean;
  onClose: (room: string) => void;
}) {
  return (
    <Tooltip label="Close" position="top" withinPortal>
      <ActionIcon
        variant="subtle"
        size="sm"
        radius="md"
        color="gray"
        className={classes.close}
        aria-label={`Close ${roomLabel(room)}`}
        data-testid={testId}
        onClick={e => {
          e.stopPropagation();
          onClose(room.room);
        }}
        style={{
          flex: 'none',
          marginRight: nudge ? -4 : undefined,
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
  onMarkRead,
  children,
}: {
  room: FleetRoom;
  testId: string;
  onChange: (opened: boolean) => void;
  onClose: (room: string) => void;
  onMarkRead?: (room: string) => void;
  children: React.ReactElement;
}) {
  return (
    <Menu onChange={onChange} radius="md" shadow="md" withinPortal>
      <Menu.ContextMenu>{children}</Menu.ContextMenu>
      <Menu.Dropdown data-testid={testId}>
        <Menu.Label>{roomLabel(room)}</Menu.Label>
        {room.unread > 0 && onMarkRead && (
          <Menu.Item
            data-testid="room-context-mark-read"
            leftSection={<Icon name="check" size={14} />}
            rightSection={<UnreadBadge count={room.unread} />}
            onClick={() => onMarkRead(room.room)}
          >
            Mark read
          </Menu.Item>
        )}
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
  onMarkRead,
}: {
  room: FleetRoom;
  active: boolean;
  onSelect?: () => void;
  onClose?: (room: string) => void;
  onMarkRead?: (room: string) => void;
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
        height: 34,
        gap: 'var(--mantine-spacing-sm)',
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'pointer',
        background: active ? ACCENT_WASH : undefined,
        color: active ? ACCENT_TEXT : undefined,
      }}
    >
      <Icon
        name="hash"
        size={14}
        color={active ? ACCENT_TEXT : 'var(--tk-text-2)'}
        style={{ flex: 'none' }}
      />
      <Text
        fw={active ? 600 : undefined}
        truncate
        /* A room heads the rows nested under it, so it takes the chrome step
           while they take meta. Stated rather than inherited: a sizeless
           Mantine `Text` resolves to `md`, not to the body size. */
        style={{ flex: 1, minWidth: 0, fontSize: CHROME_SIZE }}
      >
        {room.room}
      </Text>
      {room.mentions > 0 && <MentionBadge count={room.mentions} />}
      {room.unread > 0 && <UnreadBadge count={room.unread} />}
      {closable && (
        <CloseControl
          room={room}
          testId={`room-close-${room.room}`}
          nudge
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
      onMarkRead={onMarkRead}
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
  const [cardOpen, setCardOpen] = useState(false);
  const row = (
    <UnstyledButton
      className={classes.wsRow}
      component={clickable ? 'button' : 'div'}
      data-testid={`ws-${handle}`}
      data-active={cardOpen || undefined}
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
        height: 30,
        gap: 'var(--mantine-spacing-sm)',
        padding: `0 var(--mantine-spacing-md) 0 ${WORKSTREAM_INDENT}px`,
        borderRadius: 'var(--mantine-radius-md)',
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
        fw={600}
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
  // row. The row stays marked while its card is open, so moving onto the
  // card never loses which agent it describes.
  if (onSelectBuddy) return row;
  return (
    <AgentHoverCard
      buddy={buddy}
      position="right-start"
      offset={SIDEBAR_DOCK_OFFSET}
      reachable={reachable}
      now={now}
      task={task}
      onOpen={() => setCardOpen(true)}
      onClose={() => setCardOpen(false)}
    >
      {row}
    </AgentHoverCard>
  );
}

/** The repo's signed-out members as one muted line. Two or more collapse to
    a count and their names; a single one keeps its name and its age. */
function OfflineRow({
  repo,
  offline,
  now,
}: {
  repo: string;
  offline: RosterBuddy[];
  now: number;
}) {
  const only = offline.length === 1 ? offline[0]! : undefined;
  return (
    <Box
      data-testid={`offline-${repo}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        height: 26,
        gap: 'var(--mantine-spacing-sm)',
        padding: `0 var(--mantine-spacing-md) 0 ${WORKSTREAM_INDENT}px`,
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'default',
        ...MUTED_XS,
      }}
    >
      <StateDot state="offline" testId={`dot-offline-${repo}`} />
      <Text component="span" inherit truncate style={{ minWidth: 0 }}>
        {only
          ? `${displayName(only)} · ${statusDetail(only, now)}`
          : `${offline.length} signed out · ${offline.map(b => displayName(b)).join(' ')}`}
      </Text>
    </Box>
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
  withAvatars,
  onSelect,
  onClose,
  onMarkRead,
}: {
  room: FleetRoom;
  active: boolean;
  /** Set when another listed DM reads the same pair: the id-seeded avatars tell them apart. */
  withAvatars: boolean;
  onSelect?: () => void;
  onClose?: (room: string) => void;
  onMarkRead?: (room: string) => void;
}) {
  const [menuOpened, setMenuOpened] = useState(false);
  const closable = onClose !== undefined;
  const pair = room.participants!;

  const row = (
    <Box
      role="button"
      tabIndex={0}
      className={classes.listRow}
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
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        height: 34,
        overflow: 'hidden',
        gap: 4,
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'pointer',
        background: active ? ACCENT_WASH : undefined,
      }}
    >
      {/* textContent, not three separate runs: the arrow needs its own span
          for the purple, but a screen reader still reads one phrase. */}
      <Text
        fw={600}
        truncate
        style={{ fontSize: ROW_NAME_SIZE, flex: 1, minWidth: 0 }}
      >
        <AgentName
          handle={pair.a}
          name={pair.aName}
          withCard={false}
          withAvatar={withAvatars}
        />{' '}
        <span style={{ color: 'var(--tk-text-purple-small)', flex: 'none' }}>
          ↔
        </span>{' '}
        <AgentName
          handle={pair.b}
          name={pair.bName}
          withCard={false}
          withAvatar={withAvatars}
        />
      </Text>
      {room.unread > 0 && <UnreadBadge count={room.unread} />}
      {closable && (
        <CloseControl
          room={room}
          testId={`dm-close-${room.room}`}
          nudge={false}
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
      onMarkRead={onMarkRead}
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
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-md)',
        cursor: 'pointer',
        textAlign: 'left',
        ...MUTED_XS,
      }}
    >
      <Text component="span" inherit truncate style={{ minWidth: 0 }}>
        {expanded ? 'show fewer' : overflowLabel(hidden)}
      </Text>
    </UnstyledButton>
  );
}

/**
 * The sidebar's one tree. Every repo the fleet works in heads a group -- its
 * room when it has one, a plain label when it does not -- with that repo's
 * signed-in sessions under it and its signed-out members rolled into a line.
 * Direct conversations follow, named by their pair.
 *
 * This replaces both of the surfaces it succeeds (a flat rooms rail and a
 * separate roster panel): a handle read next to the room it works in answers
 * "who is this" without a second column to cross-reference.
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
  onMarkRead,
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
  const repeatedLabels = repeatedPairLabels(namedDms);
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
            onMarkRead={onMarkRead}
          />
          {group.online.map(buddy => (
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
          {group.offline.length > 0 && (
            <OfflineRow repo={group.repo} offline={group.offline} now={now} />
          )}
        </Fragment>
      ))}

      {namedDms.length > 0 && (
        <>
          <Group
            gap="sm"
            wrap="nowrap"
            style={{
              padding:
                'var(--mantine-spacing-md) var(--mantine-spacing-md) var(--mantine-spacing-xs)',
              borderBottom: '1px solid var(--tk-border-soft)',
            }}
          >
            <Text
              component="h3"
              fw={700}
              style={{
                margin: 0,
                fontSize: 'var(--mantine-font-size-xs)',
                color: 'var(--tk-text-4)',
                letterSpacing: '0.06em',
              }}
            >
              DIRECT
            </Text>
          </Group>
          {shownDms.map(room => (
            <DmRow
              key={room.room}
              room={room}
              active={room.room === activeRoom}
              withAvatars={repeatedLabels.has(dmPairLabel(room.participants!))}
              onSelect={() => onOpenDm?.(room.room)}
              onClose={onClose}
              onMarkRead={onMarkRead}
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
