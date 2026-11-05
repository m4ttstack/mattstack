import {
  cloneElement,
  createContext,
  useContext,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { Box, Button, Group, Popover, Text } from '@mattstack/app-kit/core';
import { generatedFace } from '@mattstack/rt-client/face-avatar';
import { faceSeed, faceTiles, ownTile } from '@mattstack/rt-client/face-tiles';
import { faceZoom } from '@mattstack/rt-client/face-zoom';

import cardClasses from './agent-card.module.css';
import classes from './agent-name.module.css';
import { agentState, paneLocation, stateLine } from './agent-state';
import { useBuddies } from './buddies-context';
import { displayName } from './display-name';
import { doing, type DoingLine } from './doing';
import { MUTED_XS } from './presence-bits';
import type { RosterBuddy } from './roster-types';
import { useSlackAvatar } from './slack-chats-context';
import { StateDot } from './StateDot';

export type AgentNameVariant = 'inline' | 'name';

/** One avatar size per variant, each lifted from an existing spec value
    (badge height, chip height) rather than a new number. */
const AVATAR_SIZE: Record<AgentNameVariant, number> = {
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

const FaceTiles = createContext<ReadonlyMap<string, number> | null>(null);

/** The people drawn together, whose tiles must differ: one DM or one room. */
export function FaceGroup({
  handles,
  children,
}: {
  handles: readonly string[];
  children: ReactNode;
}) {
  const key = [...new Set(handles)].sort().join('\n');
  const tiles = useMemo(() => faceTiles(key ? key.split('\n') : []), [key]);
  return <FaceTiles.Provider value={tiles}>{children}</FaceTiles.Provider>;
}

const faces = new Map<string, string>();

function faceUri(seed: string, tile: number): string {
  const key = `${seed}/${tile}`;
  const known = faces.get(key);
  if (known) return known;
  const uri = generatedFace(seed, tile).toDataUri();
  faces.set(key, uri);
  return uri;
}

function HandleSprite({ handle, size }: { handle: string; size: number }) {
  const seed = faceSeed(handle);
  const tile = useContext(FaceTiles)?.get(handle) ?? ownTile(seed);
  const avatar = useSlackAvatar(handle);
  const [failed, setFailed] = useState<string>();
  const [zoom, setZoom] = useState(1);
  const face = avatar && avatar !== failed ? avatar : undefined;
  if (face) {
    return (
      <span
        className={classes.avatar}
        style={{
          width: size,
          height: size,
          borderRadius: '28%',
          overflow: 'hidden',
        }}
      >
        <img
          src={face}
          alt=""
          width={size}
          height={size}
          className={classes.photo}
          style={zoom === 1 ? undefined : { transform: `scale(${zoom})` }}
          onLoad={event => setZoom(faceZoom(event.currentTarget))}
          onError={() => setFailed(face)}
        />
      </span>
    );
  }
  return (
    <img
      src={faceUri(seed, tile)}
      alt=""
      width={size}
      height={size}
      className={classes.avatar}
      style={{ borderRadius: '28%' }}
    />
  );
}

export function HandleAvatar({
  handle,
  variant,
  size,
}: {
  handle: string;
  variant: AgentNameVariant;
  size?: number;
}) {
  return <HandleSprite handle={handle} size={size ?? AVATAR_SIZE[variant]} />;
}

export const CARD_WIDTH = 340;

const FACE_SIZE = { sm: 26, md: 38, xl: 64 } as const;

/** A handle's face at a list or card size. */
export function SpriteAvatar({
  handle,
  size,
}: {
  handle: string;
  size: keyof typeof FACE_SIZE;
}) {
  return <HandleSprite handle={handle} size={FACE_SIZE[size]} />;
}

export interface AgentNameProps {
  handle: string;
  /** Display name; unset falls back to the roster row, the context directory, then the id. */
  name?: string;
  /** `inline`: a message sender (lg name, repo token). `name`: the bare
      name at the surrounding size, for chips and DM pairs. */
  variant?: AgentNameVariant;
  /** `false` drops the hover card and, with it, the hover styling -- both
      hang off the card's `.target` wrapper, so neither survives without it.
      For touch surfaces (the phone drawer) and dense lists that should not
      react to hover (the sidebar DM rows). */
  withCard?: boolean;
  /** `false` drops the face that otherwise leads every handle.
      For dense rows (the sidebar's DM list) where a fifth icon per row
      is more noise than signal. @default true */
  withAvatar?: boolean;
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
      holds the buddy row and the clock (`now`) this renders under.
      `inline` renders it after the repo token, skipping an away message
      (`kind: 'away'`); the card renders it as its own line, an away
      message in quotes. */
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
  onAction,
}: {
  buddy: RosterBuddy;
  reachable?: boolean;
  now?: number;
  inRoom?: boolean;
  task?: DoingLine | null;
  /** Called after any action, for a host that closes around the card. */
  onAction?: () => void;
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
  const taskLine =
    reachable &&
    displayTask &&
    displayTask.kind !== 'path' &&
    displayTask.kind !== 'signed-out'
      ? displayTask
      : undefined;
  const where =
    paneLocation(buddy) ??
    ([buddy.repo, buddy.branch].filter(Boolean).join(' · ') || undefined);
  const actions = ctx?.actions;
  const canFocus = buddy.pane !== undefined && actions?.focusPane;
  const summary = (
    <>
      <div className={cardClasses.head}>
        <SpriteAvatar handle={buddy.handle} size="xl" />
        <div className={cardClasses.identity}>
          <span className={cardClasses.name}>{displayName(buddy)}</span>
          <span
            className={cardClasses.status}
            data-state={reachable ? state : undefined}
            data-testid={`status-${buddy.handle}`}
          >
            <StateDot state={reachable ? state : 'offline'} size="sm" />
            {reachable
              ? stateLine(buddy, now)
              : 'presence unknown while the daemon is down'}
          </span>
        </div>
      </div>
      {(taskLine || where) && (
        <div className={cardClasses.body}>
          {taskLine &&
            (taskLine.kind === 'away' ? (
              <span
                className={cardClasses.away}
                data-testid={`away-${buddy.handle}`}
              >
                “{taskLine.text}”
              </span>
            ) : (
              <span className={cardClasses.task}>{taskLine.text}</span>
            ))}
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
    </>
  );
  const act = (run: () => void) => () => {
    run();
    onAction?.();
  };
  return (
    <div className={cardClasses.card} data-testid={`detail-${buddy.handle}`}>
      {summary}
      {actions && (
        <div className={cardClasses.actions}>
          <Button
            size="sm"
            px={8}
            variant="default"
            onClick={act(() => actions.dm(buddy.handle))}
            data-testid={`card-dm-${buddy.handle}`}
          >
            Message
          </Button>
          <Button
            size="sm"
            px={8}
            variant="default"
            disabled={!inRoom}
            onClick={act(() => actions.mention(buddy.handle))}
            data-testid={`card-mention-${buddy.handle}`}
          >
            Mention
          </Button>
          {canFocus && (
            <Button
              size="sm"
              px={8}
              variant="default"
              onClick={act(() => actions.focusPane?.(buddy.pane!))}
              data-testid={`card-focus-${buddy.handle}`}
            >
              Focus pane
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Opens the agent card from a click on whatever it wraps. An action in the
    card closes it. */
export function AgentCardPopover({
  buddy,
  reachable,
  now,
  inRoom,
  task,
  children,
}: {
  buddy: RosterBuddy;
  reachable?: boolean;
  now?: number;
  inRoom?: boolean;
  task?: DoingLine | null;
  children: React.ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  const [opened, setOpened] = useState(false);
  const toggle = () => setOpened(o => !o);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width={CARD_WIDTH}
      withinPortal
      shadow="md"
      classNames={{ dropdown: cardClasses.dropdown }}
    >
      <Popover.Target>
        {cloneElement(children, {
          role: 'button',
          tabIndex: 0,
          'aria-expanded': opened,
          onClick: toggle,
          onKeyDown: event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggle();
          },
        })}
      </Popover.Target>
      <Popover.Dropdown
        onClick={event => {
          if ((event.target as HTMLElement).closest('button')) setOpened(false);
        }}
      >
        <AgentCard
          buddy={buddy}
          reachable={reachable}
          now={now}
          inRoom={inRoom}
          task={task}
        />
      </Popover.Dropdown>
    </Popover>
  );
}

/** A handle, wherever one is rendered. The name never truncates; the repo
    token beside it does. A click opens the buddy's card when presence knows
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
  size,
  task,
}: AgentNameProps) {
  const ctx = useBuddies();
  const buddy = buddyProp ?? ctx?.byHandle.get(handle);
  const shown =
    ctx?.selfName(handle) ??
    name ??
    buddy?.name ??
    ctx?.nameOf(handle) ??
    handle;
  const repo = repoToken(buddy);
  const showTask = task && task.kind !== 'away';

  let label: React.ReactNode;
  if (variant === 'inline') {
    label = (
      <Group
        gap={0}
        wrap="nowrap"
        align="center"
        component="span"
        className={classes.name}
        style={{ minWidth: 0 }}
      >
        <Group
          gap="xs"
          wrap="nowrap"
          align="center"
          component="span"
          style={{ flex: 'none' }}
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
    <AgentCardPopover
      buddy={buddy}
      reachable={reachableProp}
      now={now}
      inRoom={inRoom}
      task={task}
    >
      {variant === 'name' ? (
        <span className={classes.target}>{label}</span>
      ) : (
        // A sender sizes to its text, or the wash would run to the margin.
        <Box className={`${classes.target} ${classes.targetFit}`}>{label}</Box>
      )}
    </AgentCardPopover>
  );
}
