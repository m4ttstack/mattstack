import {
  Box,
  Button,
  Group,
  HoverCard,
  Stack,
  Text,
} from '@mattstack/app-kit/core';
import { Invadr } from 'invadrs/react';

import cardClasses from './agent-card.module.css';
import classes from './agent-name.module.css';
import {
  AGENT_STATE_WORD,
  agentState,
  paneLocation,
  stateSince,
} from './agent-state';
import { useBuddies } from './buddies-context';
import { displayName } from './display-name';
import { doing, type DoingLine } from './doing';
import { MUTED_XS } from './presence-bits';
import type { RosterBuddy } from './roster-types';
import { HANDLE_PALETTE, type SpeakerHue } from './speaker-hue';
import { StateDot } from './StateDot';

export type AgentNameVariant = 'row' | 'inline' | 'name';

/** One avatar size per variant, each lifted from an existing spec value
    (tag height, badge height, chip height) rather than a new number. */
const AVATAR_SIZE: Record<AgentNameVariant, number> = {
  row: 18,
  inline: 22,
  name: 14,
};

/**
 * The `inline` variant at a caller-chosen scale. The two numbers travel
 * together because a sprite sized against a different type step throws the
 * chip's optical balance out; the artboards pair 13.6px with a 22px sprite in
 * a message header and 12.16px with a 10px one on an inbox card.
 */
export interface AgentNameSize {
  /** Any CSS length, normally a `--tk-fs-*` token. */
  font: string;
  avatar: number;
  /** Overrides the meta line (repo token + task) size; defaults to
      `MUTED_XS`. Set where the name is large enough that the default meta
      reads as a speck beside it (the message header). */
  meta?: string;
}

/** The message header's scale, shared by the reader and the transcript so a
    speaker reads the same in both: the name at the body size with a meta a
    step up from the roster's, one tier above the inbox card's `CARD_HANDLE`.
    Wired here because reader/transcript passing no size fell to the `lg`
    default (18px), which towered over the 16px body once the UI went sans. */
export const MESSAGE_HANDLE: AgentNameSize = {
  font: 'var(--mantine-font-size-lg)',
  avatar: 20,
  meta: 'var(--mantine-font-size-xs)',
};

/** Every handle gets one, deterministically, from the same theme-token
    palette the name chip's hue rotation draws from -- see `HANDLE_PALETTE`. */
function HandleAvatar({
  handle,
  variant,
  size,
}: {
  handle: string;
  variant: AgentNameVariant;
  size?: number;
}) {
  return (
    <Invadr
      id={handle}
      palette={HANDLE_PALETTE}
      size={size ?? AVATAR_SIZE[variant]}
      className={classes.avatar}
    />
  );
}

/** Carries the per-speaker hue into `.hueChip`'s CSS as two custom
    properties (text and fill are different role tokens now, so one
    variable can no longer serve both `color` and the background wash),
    since the colors themselves are only known at render time. */
type HueStyle = React.CSSProperties & {
  '--speaker-hue': string;
  '--speaker-hue-fill': string;
};

export interface AgentNameProps {
  handle: string;
  /** Display name; unset falls back to the roster row, the context directory, then the id. */
  name?: string;
  /** `row`: a roster row (sm name, status word, away line). `inline`: a
      message sender (lg name, repo token). `name`: the bare name at the
      surrounding size, for chips and DM pairs. */
  variant?: AgentNameVariant;
  /** `false` drops the hover card and, with it, the hover styling -- both
      hang off the card's `.target` wrapper, so neither survives without it.
      For touch surfaces (the phone drawer) and dense lists that should not
      react to hover (the sidebar DM rows). */
  withCard?: boolean;
  /** `false` drops the invadrs sprite that otherwise leads every handle.
      For dense rows (the sidebar's DM list) where a fifth icon per row
      is more noise than signal. @default true */
  withAvatar?: boolean;
  /** `inline` only: renders the handle as a chip in this hue (color and
      wash background). Unset keeps today's plain-name rendering. */
  hue?: SpeakerHue;
  /** `inline` only: the handle's type size and its sprite's, for a caller
      whose row is not the message header's. Unset keeps the header's own. */
  size?: AgentNameSize;
  /** The roster already holds the buddy and its room membership; these
      override the context lookup so the roster renders outside a provider
      (and in its own tests) the same way. */
  buddy?: RosterBuddy;
  reachable?: boolean;
  now?: number;
  inRoom?: boolean;
  /** `doing()`'s result for this handle, the caller's own since it already
      holds the buddy row and the clock (`now`) this renders under. `row`
      and `inline` render it after the repo token; the hover card renders
      it as its own second line. An away message (`kind: 'away'`) is
      skipped here -- the existing italic curly-quote line covers it. */
  task?: DoingLine | null;
}

/** `• repo` after a name: a real bullet (a middle dot reads as a speck at
    10px), 3px either side, the repo truncating before the name ever does. */
function RepoToken({
  repo,
  metaFontSize,
}: {
  repo: string;
  metaFontSize?: string;
}) {
  return (
    <Text
      component="span"
      truncate
      style={{
        ...MUTED_XS,
        ...(metaFontSize ? { fontSize: metaFontSize } : {}),
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: metaFontSize ?? 'var(--mantine-font-size-sm)',
          margin: '0 3px',
        }}
      >
        •
      </span>
      {repo}
    </Text>
  );
}

/** The repo label a buddy works in: the one token that tells you what a
    first name is doing, short enough to sit inline. */
function repoToken(buddy: RosterBuddy | undefined): string | undefined {
  return buddy?.repo || undefined;
}

/** `.doing`, after the repo token: what this handle is doing right now.
    `kind: 'away'` is never passed here -- see `AgentNameProps.task`. */
function TaskLine({
  handle,
  task,
  metaFontSize,
}: {
  handle: string;
  task: DoingLine;
  metaFontSize?: string;
}) {
  return (
    <Text
      component="span"
      truncate
      data-testid={`doing-${handle}`}
      style={{
        ...MUTED_XS,
        ...(metaFontSize ? { fontSize: metaFontSize } : {}),
        marginLeft: 'var(--mantine-spacing-sm)',
        minWidth: 0,
      }}
    >
      {task.text}
    </Text>
  );
}

/** What the roster used to spell out on every row, once, on demand. */
export function AgentCard({
  buddy,
  reachable: reachableProp,
  now: nowProp,
  inRoom: inRoomProp,
  task,
}: {
  buddy: RosterBuddy;
  reachable?: boolean;
  now?: number;
  inRoom?: boolean;
  task?: DoingLine | null;
}) {
  const ctx = useBuddies();
  const reachable = reachableProp ?? ctx?.reachable ?? true;
  const now = nowProp ?? ctx?.now ?? Date.now();
  const inRoom = inRoomProp ?? ctx?.roomMembers.includes(buddy.handle) ?? false;
  const state = agentState(buddy);
  // A caller that holds the buddy row usually passes `task`; when it does not
  // (undefined, not an explicit `null`), derive it here so the card still
  // shows the title/branch instead of nothing.
  const displayTask =
    task === undefined && reachable ? doing(buddy, now) : task;
  const taskText =
    reachable &&
    displayTask &&
    displayTask.kind !== 'path' &&
    displayTask.kind !== 'signed-out'
      ? displayTask.text
      : undefined;
  const where =
    paneLocation(buddy) ??
    ([buddy.repo, buddy.branch].filter(Boolean).join(' · ') || undefined);
  const canFocus = buddy.pane !== undefined && ctx?.actions?.focusPane;
  return (
    <div className={cardClasses.card} data-testid={`detail-${buddy.handle}`}>
      <div className={cardClasses.head}>
        <HandleAvatar handle={buddy.handle} variant="inline" size={32} />
        <div className={cardClasses.identity}>
          <span className={cardClasses.name}>{displayName(buddy)}</span>
          <span
            className={cardClasses.status}
            data-state={reachable ? state : undefined}
            data-testid={`status-${buddy.handle}`}
          >
            <StateDot state={reachable ? state : 'offline'} size="sm" />
            {reachable
              ? `${AGENT_STATE_WORD[state]} · ${stateSince(buddy, now)}`
              : 'presence unknown while the daemon is down'}
          </span>
        </div>
      </div>
      {(taskText || where) && (
        <div className={cardClasses.body}>
          {taskText && <span className={cardClasses.task}>{taskText}</span>}
          {where && (
            <span
              className={cardClasses.where}
              data-testid={`where-${buddy.handle}`}
            >
              {where}
            </span>
          )}
        </div>
      )}
      {ctx?.actions && (
        <div className={cardClasses.actions}>
          {canFocus && (
            <Button
              size="sm"
              onClick={() => ctx.actions?.focusPane?.(buddy.pane!)}
              data-testid={`card-focus-${buddy.handle}`}
            >
              Focus pane
            </Button>
          )}
          {canFocus && <span className={cardClasses.spacer} />}
          <Button
            size="sm"
            variant="subtle"
            color="gray"
            classNames={{ root: cardClasses.quiet }}
            disabled={!inRoom}
            onClick={() => ctx.actions?.mention(buddy.handle)}
            data-testid={`card-mention-${buddy.handle}`}
          >
            Mention
          </Button>
          <Button
            size="sm"
            variant="subtle"
            color="gray"
            classNames={{ root: cardClasses.quiet }}
            onClick={() => ctx.actions?.dm(buddy.handle)}
            data-testid={`card-dm-${buddy.handle}`}
          >
            Message
          </Button>
        </div>
      )}
    </div>
  );
}

/** Opens the agent card beside whatever it wraps. `right-start` docks it to
    the right of a list (the sidebar, the room dropdown), level with the row,
    so the list itself never moves or hides under the pointer. */
export function AgentHoverCard({
  buddy,
  position = 'bottom-start',
  offset,
  reachable,
  now,
  inRoom,
  task,
  children,
}: {
  buddy: RosterBuddy;
  position?: 'bottom-start' | 'right-start' | 'left-start';
  offset?: number;
  reachable?: boolean;
  now?: number;
  inRoom?: boolean;
  task?: DoingLine | null;
  children: React.ReactElement;
}) {
  return (
    <HoverCard
      position={position}
      offset={offset}
      width={320}
      openDelay={500}
      closeDelay={120}
      withinPortal
      shadow="md"
      radius="lg"
      classNames={{ dropdown: cardClasses.dropdown }}
    >
      <HoverCard.Target>{children}</HoverCard.Target>
      <HoverCard.Dropdown>
        <AgentCard
          buddy={buddy}
          reachable={reachable}
          now={now}
          inRoom={inRoom}
          task={task}
        />
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

/** A handle, wherever one is rendered. The name never truncates; the repo
    token beside it does. Hover opens the buddy's card when presence knows
    the handle; a handle presence does not know (a human, an offline row) is
    plain text. */
export function AgentName({
  handle,
  name,
  variant = 'name',
  withCard = true,
  withAvatar = true,
  buddy: buddyProp,
  reachable: reachableProp,
  now,
  inRoom,
  hue,
  size,
  task,
}: AgentNameProps) {
  const ctx = useBuddies();
  const buddy = buddyProp ?? ctx?.byHandle.get(handle);
  const reachable = reachableProp ?? ctx?.reachable ?? true;
  const shown = name ?? buddy?.name ?? ctx?.nameOf(handle) ?? handle;
  const repo = repoToken(buddy);
  const showTask = task && task.kind !== 'away';

  let label: React.ReactNode;
  if (variant === 'row') {
    label = (
      <Group gap="xs" wrap="nowrap" align="center" style={{ minWidth: 0 }}>
        {withAvatar && <HandleAvatar handle={handle} variant={variant} />}
        <Stack gap={1} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={0} wrap="nowrap" align="baseline" style={{ minWidth: 0 }}>
            <Group
              gap={0}
              wrap="nowrap"
              align="baseline"
              className={classes.name}
              style={{ minWidth: 0 }}
            >
              <Text
                size="sm"
                fw={600}

                style={{ flex: 'none' }}
              >
                {shown}
              </Text>
              {repo && <RepoToken repo={repo} />}
              {showTask && <TaskLine handle={handle} task={task!} />}
            </Group>
          </Group>
          {reachable && buddy?.statusText && (
            <Text
              component="span"
              data-testid={`away-${handle}`}
              style={{ ...MUTED_XS, fontStyle: 'italic' }}
            >
              “{buddy.statusText}”
            </Text>
          )}
        </Stack>
      </Group>
    );
  } else if (variant === 'inline') {
    label = (
      <Group
        gap={0}
        wrap="nowrap"
        align="center"
        component="span"
        className={hue ? undefined : classes.name}
        style={{ minWidth: 0 }}
      >
        <Group
          gap="xs"
          wrap="nowrap"
          align="center"
          component="span"
          className={hue ? classes.hueChip : undefined}
          data-testid={hue ? 'speaker-chip' : undefined}
          style={
            hue
              ? ({
                  flex: 'none',
                  '--speaker-hue': hue.text,
                  '--speaker-hue-fill': hue.fill,
                } as HueStyle)
              : { flex: 'none' }
          }
        >
          {withAvatar && (
            <HandleAvatar
              handle={handle}
              variant={variant}
              size={size?.avatar}
            />
          )}
          <Text
            component="span"
            size="lg"
            fw={600}
            style={
              size ? { flex: 'none', fontSize: size.font } : { flex: 'none' }
            }
          >
            {shown}
          </Text>
        </Group>
        {repo && <RepoToken repo={repo} metaFontSize={size?.meta} />}
        {showTask && (
          <TaskLine handle={handle} task={task!} metaFontSize={size?.meta} />
        )}
      </Group>
    );
  } else {
    label = (
      <Group
        gap="xs"
        wrap="nowrap"
        align="center"
        component="span"
        display="inline-flex"
      >
        {withAvatar && <HandleAvatar handle={handle} variant={variant} />}
        <Text component="span" fw={600} inherit className={classes.name}>
          {shown}
        </Text>
      </Group>
    );
  }

  if (!withCard || !buddy) return label;

  return (
    <AgentHoverCard
      buddy={buddy}
      position={variant === 'row' ? 'left-start' : 'bottom-start'}
      reachable={reachableProp}
      now={now}
      inRoom={inRoom}
      task={task}
    >
      {variant === 'name' ? (
        <span className={classes.target}>{label}</span>
      ) : (
        // The row fills its line (the status word rides its right edge); a
        // sender sizes to its text, or the wash would run to the margin.
        <Box
          className={`${classes.target} ${
            variant === 'row' ? classes.targetRow : classes.targetFit
          }`}
        >
          {label}
        </Box>
      )}
    </AgentHoverCard>
  );
}
