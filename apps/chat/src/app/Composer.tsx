import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import {
  ActionIcon,
  Box,
  Center,
  Group,
  Paper,
  Popover,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { notifications } from '@mattstack/app-kit/notifications';
import type { AgentStatus, BuddyStatus } from '@mattstack/rt-client';

import { agentState, type AgentState } from './agent-state';
import { AgentName } from './AgentName';
import { useBuddies } from './buddies-context';
import classes from './composer.module.css';
import { doing, type DoingLine } from './doing';
import { useSlackChat } from './slack-chats-context';
import { StateDot, StateWord } from './StateDot';
import { useAutoGrowTextarea } from './use-auto-grow-textarea';

/** `BuddyOption`/`HereOption` render inside `Popover.Dropdown`
    (`withinPortal` below): Mantine portals mount to `document.body`,
    portalled, and the ladder is merged at the root provider rather than
    scoped to a subtree, so a step means the same size inside the dropdown
    as outside it. These labels sit on the meta step. */
const MUTED_SMALL = 'var(--tk-text-4)';
/** The composer input itself: the prose step, since it types the prose. */
const MUTED_BODY = 'var(--tk-text-2)';
const INPUT_LINE_HEIGHT = 1.45;
const BORDER = 'var(--tk-border)';
const BORDER_SOFT = 'var(--tk-border-soft)';
/** The "not in #room" subtext, meta step like the rest of the dropdown. */
const PURPLE = 'var(--tk-text-purple-small)';
const ACCENT_TEXT = 'var(--mantine-color-accent-text)';

const SIGNED_IN_ORDER: readonly AgentState[] = ['blocked', 'working', 'done'];
const BAD_TEXT = 'var(--mantine-color-bad-text)';

export interface ComposerBuddy {
  handle: string;
  name?: string;
  status: BuddyStatus;
  agentStatus?: AgentStatus;
  branch?: string;
  cwd?: string;
  paneTitle?: string;
  statusText?: string;
}

export interface ComposerProps {
  /** The open room's slug -- the post route and the popover's "not in #room"
      copy key off it. */
  room: string;
  /** Handles already in the open room -- a DM's two participants, or a
      channel's current membership. What separates "insert @handle" from
      "not in #room -- DM instead" in the popover. */
  roomMembers: string[];
  /** The fleet, not the room -- same source `FleetTree` reads, so the
      popover can offer a DM to a buddy who has never joined this room. */
  buddies: ComposerBuddy[];
  /** The viewer's own handle, from `/api/chat/me`. */
  humanHandle?: string;
  /** True inside a DM room: narrows the popover to the other participant
      and drops `@here` (there is nobody else to wake). @default false */
  isDm?: boolean;
  /** @default true. False disables the input and shows the daemon-down
      copy; the draft is never cleared. */
  daemonReachable?: boolean;
  /** Phone chrome: 16px input (below it, iOS zooms on focus), 44px tap
      targets, Enter is a newline -- only the button sends. @default false */
  phone?: boolean;
  /** The narrow embed: a shorter box and the meta type step. @default false */
  compact?: boolean;
  /** A buddy outside the room was picked in the `@` popover: the caller
      opens the DM room and moves there; the draft stays in this instance. */
  onOpenDm?: (handle: string) => void;
  /**
   * Seeds the draft, and the mentions posted with it, so a reply can open
   * with its recipient already tagged. Read ONCE, at mount: a caller that
   * needs a different seed remounts this composer with a `key`, which is
   * also what discards the previous draft on purpose.
   */
  prefill?: { body: string; mentions?: string[] };
  /** Called after a post has landed and the draft has cleared. */
  onPosted?: () => void;
}

/** The imperative surface the roster and the app drive: insert a mention at
    the caret, or take focus after a room change. */
export interface ComposerHandle {
  insertMention(handle: string): void;
  focus(): void;
}

interface MentionToken {
  /** Index of the triggering `@` inside `value`. */
  start: number;
  /** Caret position when the token was last recomputed. */
  end: number;
  query: string;
}

/** An `@` token is only "active" when it starts at the beginning of the
    text or right after whitespace, and nothing typed since it opened has
    broken it with a space -- the same rule chat clients use everywhere. */
function detectMentionToken(text: string, caret: number): MentionToken | null {
  const uptoCaret = text.slice(0, caret);
  const atIndex = uptoCaret.lastIndexOf('@');
  if (atIndex === -1) return null;
  const before = atIndex > 0 ? uptoCaret[atIndex - 1] : undefined;
  if (before !== undefined && !/\s/.test(before)) return null;
  const query = uptoCaret.slice(atIndex + 1);
  if (/\s/.test(query)) return null;
  return { start: atIndex, end: caret, query };
}

/**
 * One `.opt` row. Clicking routes on room membership alone: a mention still
 * lands in an idle buddy's unread, it just doesn't wake them yet.
 */
function BuddyOption({
  handle,
  name,
  withAvatar,
  state,
  inRoom,
  room,
  task,
  onSelect,
}: {
  handle: string;
  name: string;
  /** Set when another option reads the same name: the id-seeded avatar tells them apart. */
  withAvatar: boolean;
  state: AgentState;
  inRoom: boolean;
  room: string;
  task: DoingLine | null;
  onSelect: (handle: string, inRoom: boolean) => void;
}) {
  // `path`-kind tasks and any other kind used to read two different
  // shades (`--tk-muted`/`--tk-muted-text`); both band-resolve to the same
  // role token now, so there is no longer a kind-based distinction to draw.
  const subtext = !inRoom
    ? { text: `not in #${room}, DM instead`, color: PURPLE }
    : task
      ? { text: task.text, color: MUTED_SMALL }
      : undefined;

  return (
    <UnstyledButton
      data-testid={`composer-option-${handle}`}
      onClick={() => onSelect(handle, inRoom)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--mantine-spacing-sm)',
        height: 44,
        width: '100%',
        minWidth: 0,
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-sm)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <StateDot state={state} />
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        {withAvatar ? (
          <Text component="span" size="sm" fw={600} truncate>
            <AgentName
              handle={handle}
              name={name}
              withCard={false}
              withAvatar
            />
          </Text>
        ) : (
          <Text component="span" size="sm" fw={600} truncate>
            {name}
          </Text>
        )}
        {subtext && (
          <Text
            component="span"
            size="xs"
            truncate
            style={{ color: subtext.color }}
          >
            {subtext.text}
          </Text>
        )}
      </Stack>
      <StateWord state={state} />
    </UnstyledButton>
  );
}

/** `@here` sits last, with its cost named up front: waking a room is not
    free, and this is the moment to see the bill. */
function HereOption({
  count,
  onSelect,
}: {
  count: number;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton
      data-testid="composer-option-here"
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 44,
        width: '100%',
        minWidth: 0,
        padding: '0 var(--mantine-spacing-md)',
        borderRadius: 'var(--mantine-radius-sm)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <Text
        component="span"
        size="sm"
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          color: MUTED_SMALL,
        }}
      >
        @here
        <Text
          component="span"
          size="xs"
          style={{ color: MUTED_SMALL, marginLeft: 'auto' }}
        >
          wakes {count} {count === 1 ? 'agent' : 'agents'}
        </Text>
      </Text>
    </UnstyledButton>
  );
}

/**
 * The composer: an `@`-popover input and its one write route. Picking a
 * buddy outside the room hands off to `onOpenDm` instead of posting here --
 * opening a DM is the app's job, not this component's.
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(
  function Composer(
    {
      room,
      roomMembers,
      buddies,
      humanHandle = '',
      isDm = false,
      daemonReachable = true,
      phone = false,
      compact = false,
      onOpenDm,
      prefill,
      onPosted,
    },
    ref
  ) {
    // Lazy initialisers, never an effect keyed on `prefill`: an object
    // literal prop changes identity every render, so syncing on it would
    // overwrite whatever had been typed since.
    const [value, setValue] = useState(() => prefill?.body ?? '');
    const [mentions, setMentions] = useState<string[]>(
      () => prefill?.mentions ?? []
    );
    const [sending, setSending] = useState(false);
    const [token, setToken] = useState<MentionToken | null>(null);
    const [focused, setFocused] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    useAutoGrowTextarea(textareaRef, value);
    const ctx = useBuddies();
    const slackChat = useSlackChat(room);
    const slackNoteId = useId();
    const nameOf = (handle: string) =>
      buddies.find(b => b.handle === handle)?.name ??
      ctx?.nameOf(handle) ??
      handle;

    const showPopover = token !== null && daemonReachable;

    const relevant = isDm
      ? buddies.filter(b => roomMembers.includes(b.handle))
      : buddies.filter(b => b.status !== 'offline');
    const query = (token?.query ?? '').toLowerCase();
    const filtered = query
      ? relevant.filter(b => nameOf(b.handle).toLowerCase().startsWith(query))
      : relevant;
    const options = SIGNED_IN_ORDER.flatMap(state =>
      filtered.filter(b => b.status !== 'offline' && agentState(b) === state)
    );
    const optionNameCounts = new Map<string, number>();
    for (const b of options) {
      const shown = nameOf(b.handle);
      optionNameCounts.set(shown, (optionNameCounts.get(shown) ?? 0) + 1);
    }
    const hereCount = roomMembers.filter(h => h !== humanHandle).length;
    const showHere = !isDm && (query === '' || 'here'.startsWith(query));

    function closePopover() {
      setToken(null);
    }

    function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
      const next = e.target.value;
      setValue(next);
      const caret = e.target.selectionStart ?? next.length;
      setToken(detectMentionToken(next, caret));
    }

    function replaceToken(insert: string): number {
      if (!token) return value.length;
      const before = value.slice(0, token.start);
      const after = value.slice(token.end);
      setValue(before + insert + after);
      return before.length + insert.length;
    }

    function focusAt(caret: number) {
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        el?.focus();
        el?.setSelectionRange(caret, caret);
      });
    }

    function insertMention(handle: string) {
      const caret = replaceToken(`@${nameOf(handle)} `);
      setMentions(prev => (prev.includes(handle) ? prev : [...prev, handle]));
      closePopover();
      focusAt(caret);
    }

    function switchToDm(handle: string) {
      replaceToken('');
      closePopover();
      onOpenDm?.(handle);
    }

    function insertHere() {
      const caret = replaceToken('@here ');
      closePopover();
      focusAt(caret);
    }

    function selectBuddy(handle: string, inRoom: boolean) {
      if (inRoom) insertMention(handle);
      else switchToDm(handle);
    }

    async function send() {
      const body = value.trim();
      // `sending` guards a double-submit: ↵ twice, or ↵ while the button's
      // tap is already in flight, posts the same message twice. The draft is
      // only cleared on success, so the second press has a body to send.
      if (!body || !daemonReachable || sending) return;
      setSending(true);
      try {
        const res = await fetch('/api/chat/post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            room,
            body,
            mentions: mentions.length ? mentions : undefined,
          }),
        });
        if (!res.ok) throw new Error('post failed');
        setValue('');
        setMentions([]);
        onPosted?.();
      } catch {
        notifications.error("Couldn't send. The draft is kept.");
      } finally {
        setSending(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (e.key === 'Escape' && token) {
        e.preventDefault();
        closePopover();
        return;
      }
      if (e.key === 'Enter' && token) {
        // No live-narrowed single candidate to commit to -- swallow Enter
        // rather than posting the raw "@" token as message text.
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !phone) {
        e.preventDefault();
        void send();
      }
      // Phone: Enter always inserts a newline; only the button sends.
    }

    /** `FleetTree`'s onPick, not the popover: there is no `@`-token to
      replace, so this inserts at the caret (or the end, unfocused) instead. */
    function insertMentionAtCaret(handle: string) {
      const el = textareaRef.current;
      const caret = el?.selectionStart ?? value.length;
      const shown = nameOf(handle);
      const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const textHas = new RegExp(`(?:^|\\s)@${escaped}(?![A-Za-z0-9._-])`).test(
        value
      );
      if (textHas && mentions.includes(handle)) {
        focusAt(caret);
        return;
      }
      // An `@name` already typed can only be adopted when the name maps to
      // one agent; a shared name may belong to the other one.
      if (
        textHas &&
        buddies.filter(b => nameOf(b.handle) === shown).length === 1
      ) {
        setMentions(prev => (prev.includes(handle) ? prev : [...prev, handle]));
        focusAt(caret);
        return;
      }
      const before = value.slice(0, caret);
      const after = value.slice(caret);
      const needsSpace = before.length > 0 && !/\s$/.test(before);
      const inserted = `${needsSpace ? ' ' : ''}@${shown} `;
      setValue(before + inserted + after);
      setMentions(prev => (prev.includes(handle) ? prev : [...prev, handle]));
      focusAt(before.length + inserted.length);
    }

    useImperativeHandle(ref, () => ({
      insertMention: insertMentionAtCaret,
      focus: () => focusAt(value.length),
    }));

    const placeholder = !daemonReachable
      ? phone
        ? 'rt daemon unreachable'
        : "Can't post: rt daemon unreachable. Your draft is kept."
      : 'Message…';

    const inputBorderColor = !daemonReachable
      ? BORDER
      : focused
        ? ACCENT_TEXT
        : BORDER_SOFT;
    const inputFontSize = phone
      ? 16
      : compact
        ? 'var(--mantine-font-size-sm)'
        : 'var(--mantine-font-size-lg)';
    const canSend = value.trim().length > 0 && daemonReachable && !sending;

    if (slackChat?.closedAt !== undefined) {
      return (
        <Center data-testid="composer-ended" className={classes.ended}>
          This chat has ended
        </Center>
      );
    }

    return (
      <Box
        data-testid="composer"
        style={
          phone
            ? {
                position: 'relative',
                flex: 'none',
                padding:
                  '8px var(--mantine-spacing-lg) var(--mantine-spacing-lg)',
                background: 'var(--tk-panel)',
              }
            : {
                position: 'relative',
                paddingTop: 'var(--mantine-spacing-sm)',
              }
        }
      >
        <Popover
          opened={showPopover}
          onClose={closePopover}
          position="top-start"
          middlewares={{ flip: false, shift: true }}
          offset={6}
          width="target"
          withArrow={false}
          trapFocus={false}
          returnFocus={false}
          radius="md"
          withinPortal
        >
          <Popover.Target>
            <Paper
              data-testid="composer-input"
              miw={0}
              radius="lg"
              bg={!daemonReachable ? 'var(--tk-panel)' : 'var(--tk-card)'}
              c={!daemonReachable ? MUTED_BODY : undefined}
              bd={`1px ${!daemonReachable ? 'dashed' : 'solid'} ${inputBorderColor}`}
              shadow="xs"
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 10,
                padding: compact ? '6px 6px 6px 12px' : '8px 8px 8px 14px',
              }}
            >
              <textarea
                ref={textareaRef}
                rows={1}
                value={value}
                disabled={!daemonReachable}
                readOnly={sending}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={placeholder}
                aria-label="Message"
                aria-describedby={slackChat ? slackNoteId : undefined}
                data-testid="composer-row"
                style={{
                  display: 'block',
                  flex: 1,
                  minWidth: 0,
                  border: 0,
                  outline: 'none',
                  resize: 'none',
                  background: 'transparent',
                  color: sending ? MUTED_SMALL : 'inherit',
                  fontFamily: 'inherit',
                  fontSize: inputFontSize,
                  lineHeight: INPUT_LINE_HEIGHT,
                  // Centres one line on the send button; the button stays at
                  // the bottom as the box grows upward.
                  padding: '4px 0',
                  maxHeight: phone ? '25vh' : '40vh',
                  overflowY: 'auto',
                }}
              />
              <ActionIcon
                aria-label="Send"
                data-testid="composer-send"
                data-ready={canSend || undefined}
                disabled={!canSend && !sending}
                loading={sending}
                onClick={() => void send()}
                variant="filled"
                color="accent"
                radius="xl"
                size={phone ? 32 : compact ? 26 : 30}
                className={classes.send}
              >
                <Icon name="arrowUp" size={phone ? 18 : 15} />
              </ActionIcon>
            </Paper>
          </Popover.Target>
          <Popover.Dropdown
            data-testid="composer-popover"
            style={{
              background: 'var(--tk-panel)',
              border: `1px solid ${BORDER}`,
              borderRadius: 'var(--mantine-radius-md)',
              padding: 'var(--mantine-spacing-xs)',
              boxShadow:
                '0 10px 30px rgba(0,0,0,0.28), 0 2px 8px rgba(0,0,0,0.18)',
            }}
          >
            <Stack gap={1}>
              {options.map(b => (
                <BuddyOption
                  key={b.handle}
                  handle={b.handle}
                  name={nameOf(b.handle)}
                  withAvatar={(optionNameCounts.get(nameOf(b.handle)) ?? 0) > 1}
                  state={agentState(b)}
                  inRoom={roomMembers.includes(b.handle)}
                  room={room}
                  task={doing(b)}
                  onSelect={selectBuddy}
                />
              ))}
              {showHere && (
                <HereOption count={hereCount} onSelect={insertHere} />
              )}
            </Stack>
          </Popover.Dropdown>
        </Popover>

        {slackChat && (
          <Text
            id={slackNoteId}
            data-testid="composer-slack-note"
            size="xs"
            c="dimmed"
            ta="center"
            style={{ paddingTop: 6 }}
          >
            Only {slackChat.agentName ?? 'Claude'} sees this
          </Text>
        )}

        {!daemonReachable && (
          <Group
            gap="xs"
            wrap="nowrap"
            style={{ paddingTop: 'var(--mantine-spacing-xs)' }}
          >
            <Text size="xs" style={{ color: BAD_TEXT }}>
              Can&apos;t post: rt daemon unreachable. Your draft is kept.
            </Text>
          </Group>
        )}
      </Box>
    );
  }
);
