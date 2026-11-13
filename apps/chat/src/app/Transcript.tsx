import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { Box, Button, Stack, Text } from '@mattstack/app-kit/core';
import type { ChatMessage } from '@mattstack/rt-client';
import ScrollToBottom, {
  useAnimating,
  useScrollTo,
} from 'react-scroll-to-bottom';

import { AgentName, FaceGroup, HandleAvatar } from './AgentName';
import { MessageSkeleton } from './ChatSkeleton';
import { dayKey, dayLabel, gutterTime, localTime } from './day-label';
import { blocksByLatest } from './direct';
import { MessageMarkdown } from './MessageMarkdown';
import { NewPill } from './NewPill';
import { useRelayFrames, useRelayOpen } from './relay-socket';
import prose from './transcript-prose.module.css';
import scrollClasses from './transcript-scroll.module.css';

/** The panel's horizontal inset, inside the scroll view so the scrollbar hugs
    the panel's edge. */
const INSET = '20px';
const COMPACT_INSET = '12px';
/** Messages per page: the newest page on open, and one page per older
    load. Agent posts run long, so this is one to two screens. */
export const PAGE_SIZE = 30;
/** How many older pages a `#m-<id>` link may pull in looking for its
    message before the viewer is left where the room opened. */
const ANCHOR_PAGES_MAX = 10;
/** How long the reader's row is held at its viewport offset after a prepend
    or an anchor scroll while the content above it settles: a fold applies
    a render after mount, and a fenced block's highlighter lands later
    still. Any gesture from the viewer ends the hold early. */
const HOLD_MS = 1500;
const HOLD_BREAKERS = [
  'wheel',
  'touchstart',
  'pointerdown',
  'keydown',
] as const;

/** The first row on screen, and where it sits. In a feed the oldest message
    can be anywhere, so this is the row to keep still; `moving` names rooms
    about to move, whose rows cannot be the anchor. */
function topVisibleRow(
  view: HTMLElement,
  moving?: ReadonlySet<string>
): { id: number; offset: number } | null {
  const top = view.getBoundingClientRect().top;
  for (const row of view.querySelectorAll<HTMLElement>('[id^="m-"]')) {
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= top || moving?.has(row.dataset.room ?? '')) continue;
    return { id: Number(row.id.slice('m-'.length)), offset: rect.top - top };
  }
  return null;
}

/** Where message `id` sits in `view`, as an offset from the view's top. */
function rowOffset(view: HTMLElement, id: number): number | null {
  const el = document.getElementById(`m-${id}`);
  if (!el) return null;
  return el.getBoundingClientRect().top - view.getBoundingClientRect().top;
}

/** Puts message `id` back at viewport offset `offset` now, and again on
    every resize of `column` for HOLD_MS, until the viewer scrolls or
    clicks; `holds` keeps the one active hold so a new one ends the last.
    Returns the correction so a deferred park can apply it. */
function holdRow(
  view: HTMLElement,
  column: HTMLElement | null,
  id: number,
  offset: number,
  holds: RefObject<(() => void) | null>
): () => void {
  holds.current?.();
  const correct = () => {
    const now = rowOffset(view, id);
    if (now !== null && Math.abs(now - offset) > 1) {
      view.scrollTop += now - offset;
    }
  };
  correct();
  if (!column) return correct;
  const observer = new ResizeObserver(correct);
  observer.observe(column);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    for (const name of HOLD_BREAKERS) view.removeEventListener(name, stop);
    if (holds.current === stop) holds.current = null;
  };
  const timer = setTimeout(stop, HOLD_MS);
  for (const name of HOLD_BREAKERS) {
    view.addEventListener(name, stop, { passive: true });
  }
  holds.current = stop;
  return correct;
}

type ScrollToFn = (
  top: number | '100%',
  options?: { behavior: 'auto' | 'smooth' }
) => void;

interface ScrollControl {
  /** Parks the viewer at the top `at` reports and stops the list following
      the bottom. */
  park: (at: () => number) => void;
  /** Jumps to the bottom and follows it again. */
  follow: () => void;
}

/** Lends the scroll library's own `scrollTo` to the transcript. Only that
    call reaches the library's follow-the-bottom state, which a bare
    `scrollIntoView` never clears, so the next content change while the
    list still counts as following snaps it back to the bottom. The state
    only clears while nothing is animating to the end, and every mount
    starts with such an animation, so a request made mid-animation waits
    for it to finish; `at` is read then, not when the request was made. */
function ScrollHandle({ handle }: { handle: RefObject<ScrollControl | null> }) {
  const scrollTo = useScrollTo() as ScrollToFn;
  const [animating] = useAnimating();
  const animatingRef = useRef(animating);
  animatingRef.current = animating;
  const pending = useRef<(() => number | '100%') | null>(null);
  const flush = useCallback(() => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    scrollTo(next(), { behavior: 'auto' });
  }, [scrollTo]);
  useEffect(() => {
    if (!animating) flush();
  }, [animating, flush]);
  useEffect(() => {
    const request = (next: () => number | '100%') => {
      pending.current = next;
      if (!animatingRef.current) flush();
    };
    handle.current = {
      park: at => request(at),
      follow: () => request(() => '100%'),
    };
    return () => {
      handle.current = null;
    };
  }, [handle, flush]);
  return null;
}

/** Several conversations read as one list, in place of a room's own. */
export interface TranscriptFeed {
  /** Pages like `/api/chat/messages/:room`: `limit`, and `before` an id. */
  url: string;
  /** Whether a relay topic is a post into this list. */
  hears: (topic: string) => boolean;
  /** Everyone the list can draw. Taken from the conversations, not the rows,
      so a new post or an older page never recolours a face. */
  faces: readonly string[];
  /** The conversation a reply goes to now, which draws raised. */
  target: (messages: ChatMessage[]) => string | undefined;
  /** A message picks its conversation; the space around them clears it. */
  onPick: (room: string | undefined) => void;
  /** One timeline by day instead of a card per conversation. `to` names
      who a message went to, beside its sender. */
  timeline?: { to: (message: ChatMessage) => string | undefined };
}

export interface TranscriptProps {
  /** With a `feed`, only the key its state resets on. */
  room: string;
  feed?: TranscriptFeed;
  messages: ChatMessage[];
  /** The human's own handle -- a mention of it gets the `.at.me` wash. */
  humanHandle?: string;
  /** Element id of the message a `#m-<id>` link points at; scrolled into
      view once per room+anchor, the first time it is in the list. */
  anchor?: string;
  /** The `Composer`, below the messages in the same column. A function gets
      the list as it stands now, live posts and older pages included. */
  footer?: ReactNode | ((messages: ChatMessage[]) => ReactNode);
  /** Shown once a loaded list has nothing in it. */
  empty?: ReactNode;
  /** Flush on the host's own background, with no inset: the phone shell draws
      its own chrome. @default false */
  bare?: boolean;
  /** The room's first page is still on its way: stand-in rows take its place. */
  loading?: boolean;
  /** The narrow embed: sprite beside the name, no task line, tighter type. */
  compact?: boolean;
}

/** The longest gap at which a speaker's next post still continues their
    last one. */
const GROUP_GAP_MS = 60 * 60_000;

/** True when `message` reads as a continuation of `previous`: same speaker,
    same day, close together. It then drops its own sprite and name. */
export function continuesGroup(
  previous: ChatMessage | undefined,
  message: ChatMessage
): boolean {
  return (
    previous !== undefined &&
    previous.room === message.room &&
    previous.handle === message.handle &&
    message.postedAt - previous.postedAt <= GROUP_GAP_MS &&
    dayKey(previous.postedAt) === dayKey(message.postedAt)
  );
}

/** A quiet centred line: the day, or where the chat begins. */
function Marker({ label, testId }: { label: string; testId: string }) {
  return (
    <>
      <div className={prose.dayLine} />
      <div className={prose.dayPill} data-testid={testId}>
        {label}
      </div>
    </>
  );
}

/** Messages with their list positions, a run per day. A day is the scope its
    sticky label stays inside, so the next day pushes it off. */
function byDay(messages: ChatMessage[]) {
  const days: { message: ChatMessage; i: number }[][] = [];
  messages.forEach((message, i) => {
    const day = days.at(-1);
    if (day && dayKey(day[0]!.message.postedAt) === dayKey(message.postedAt)) {
      day.push({ message, i });
    } else {
      days.push([{ message, i }]);
    }
  });
  return days;
}

function MessageRow({
  message,
  humanHandle,
  compact,
  grouped,
  dated,
  to,
}: {
  message: ChatMessage;
  humanHandle: string | undefined;
  compact: boolean;
  grouped: boolean;
  /** No day lines around it, so the row names its own day. */
  dated: boolean;
  /** Who the message went to, in a list that mixes conversations. */
  to?: string;
}) {
  const time = (
    <Text
      component="span"
      className={prose.meta}
      title={new Date(message.postedAt).toLocaleString()}
      style={{ flex: 'none' }}
    >
      {dated && dayKey(message.postedAt) !== dayKey(Date.now())
        ? `${dayLabel(message.postedAt)} ${localTime(message.postedAt)}`
        : localTime(message.postedAt)}
    </Text>
  );
  const name = (
    <>
      <span className={prose.who}>
        <AgentName
          handle={message.handle}
          name={message.name}
          variant="name"
          withAvatar={false}
        />
      </span>
      {to && (
        <Text
          component="span"
          className={prose.meta}
          data-testid="message-to"
          style={{ flex: 'none' }}
        >
          to {to}
        </Text>
      )}
    </>
  );
  const body = (
    <div data-testid="message-body" className={prose.prose}>
      <MessageMarkdown
        body={message.body}
        mentions={message.mentions}
        mentionNames={message.mentionNames}
        humanHandle={humanHandle}
      />
    </div>
  );
  return (
    <div
      id={`m-${message.id}`}
      data-testid={`message-${message.id}`}
      data-room={message.room}
      className={prose.msg}
      data-grouped={grouped || undefined}
    >
      {compact ? (
        <div className={prose.content}>
          {!grouped && (
            <div className={prose.hdr}>
              <HandleAvatar
                handle={message.handle}
                variant="inline"
                size={13}
              />
              {name}
              {time}
            </div>
          )}
          {body}
        </div>
      ) : (
        <>
          <div className={prose.gutter}>
            {grouped ? (
              <span className={prose.hoverTime}>
                <Text
                  component="span"
                  className={prose.meta}
                  title={new Date(message.postedAt).toLocaleString()}
                >
                  {gutterTime(message.postedAt)}
                </Text>
              </span>
            ) : (
              <HandleAvatar
                handle={message.handle}
                variant="inline"
                size={32}
              />
            )}
          </div>
          <div className={prose.content}>
            {!grouped && (
              <div className={prose.hdr}>
                {name}
                {time}
              </div>
            )}
            {body}
          </div>
        </>
      )}
    </div>
  );
}

/** The top edge of the list: the only way to load older. Deliberately not a
    scroll trigger: the scroll library re-sticks to the bottom on a content
    change that lands within its 200ms scroll debounce, which a fast jump to
    the top plus an instant page did every time. */
function OlderEdge({
  loading,
  onLoad,
}: {
  loading: boolean;
  onLoad: () => void;
}) {
  return (
    <Box
      style={{
        padding: 'var(--mantine-spacing-sm) 0 var(--mantine-spacing-xs)',
        textAlign: 'center',
      }}
    >
      <Button
        variant="subtle"
        size="xs"
        loading={loading}
        onClick={onLoad}
        data-testid="transcript-edge"
      >
        Load older messages
      </Button>
    </Box>
  );
}

/** Dedupes incoming messages by id and keeps the list ordered -- a WS frame
    is a pointer, so the tail refetch it triggers may re-deliver rows the
    caller already has. */
function mergeMessages(
  prev: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  const known = new Set(prev.map(m => m.id));
  const additions = incoming.filter(m => !known.has(m.id));
  if (additions.length === 0) return prev;
  return [...prev, ...additions].sort(
    (a, b) => a.postedAt - b.postedAt || a.id - b.id
  );
}

/**
 * The live transcript: message rows, and a tail refetch on a doorbell frame
 * for THIS room from the page's relay socket (not a socket of its own).
 *
 * A relay frame carries only `{ id }` -- a pointer, never prose (chat owns
 * the message store; the journal is just the doorbell) -- so the handler
 * here never renders straight off the frame payload. It refetches the
 * room's tail (`GET /api/chat/messages/:room`) and merges by id; a frame for
 * another room's topic is dropped before any network call happens.
 */
export function Transcript({
  room,
  feed,
  messages: initialMessages,
  humanHandle,
  anchor,
  footer,
  empty,
  bare = false,
  loading = false,
  compact = false,
}: TranscriptProps) {
  const inset = compact ? COMPACT_INSET : INSET;
  const url = feed?.url ?? `/api/chat/messages/${room}`;
  const isFeed = feed !== undefined;
  const [messages, setMessages] = useState(initialMessages);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderExhausted, setOlderExhausted] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [newSinceAway, setNewSinceAway] = useState(0);
  const scrollBoxRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  // Set before an older page is prepended; consumed once the DOM has the
  // new rows, so the viewport stays on the message the viewer was reading.
  const pendingHold = useRef<{ id: number; offset: number } | null>(null);
  const hold = useRef<(() => void) | null>(null);
  const roomRef = useRef(room);
  roomRef.current = room;
  const awayRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // The anchor effect keys on the list but must call the loader that sees
  // the current render's flags, so it goes through a ref refreshed each
  // render.
  const loadOlderRef = useRef<() => void>(() => {});
  const scrollHandle = useRef<ScrollControl | null>(null);

  // Re-seeds local state whenever the CALLER's own messages array changes
  // identity -- not just when `room` changes. The caller fetches
  // asynchronously, so its first render for a room almost always passes an
  // empty (or stale) array; syncing only on `room` would freeze this
  // component on that first snapshot forever once the real fetch resolves,
  // since `room` itself wouldn't change again.
  useEffect(() => {
    setMessages(initialMessages);
    // A first page with room to spare is the whole room. An empty array is
    // the caller's placeholder while its fetch is in flight, never a page.
    setOlderExhausted(
      initialMessages.length > 0 && initialMessages.length < PAGE_SIZE
    );
  }, [room, initialMessages]);

  useEffect(() => {
    setLoadingOlder(false);
    setNewSinceAway(0);
    setAwayFromBottom(false);
    awayRef.current = false;
  }, [room]);

  // The `#m-<id>` anchor rt prints after a post and on a wake line. Scrolls
  // once per room+anchor, the first time the message is in the list, so a
  // later live merge or older-page load never yanks a viewer who scrolled
  // away back to it. A link below everything loaded pages older until the
  // message arrives or the page budget runs out; ids are monotonic, so an
  // id inside the loaded range that is not there is pruned or bogus and
  // earns no fetch.
  const anchorDone = useRef<string | null>(null);
  const anchorPaging = useRef({ target: '', pages: 0 });
  useEffect(() => {
    if (!anchor) return;
    const target = `${room}#${anchor}`;
    if (anchorDone.current === target) return;
    if (anchorPaging.current.target !== target) {
      anchorPaging.current = { target, pages: 0 };
    }
    const paging = anchorPaging.current;
    const id = Number(anchor.slice('m-'.length));
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      const view = scrollView();
      const offset = view ? rowOffset(view, id) : null;
      const correct =
        view && offset !== null
          ? holdRow(view, columnRef.current, id, offset, hold)
          : null;
      scrollHandle.current?.park(() => {
        correct?.();
        return view?.scrollTop ?? 0;
      });
      anchorDone.current = target;
      return;
    }
    if (loadingOlder) return;
    const oldest = messages[0];
    const below =
      oldest !== undefined && Number.isInteger(id) && id < oldest.id;
    if (below && !olderExhausted && paging.pages < ANCHOR_PAGES_MAX) {
      paging.pages += 1;
      loadOlderRef.current();
      return;
    }
    // The hunt is over without the message: pages were pulled for it, so
    // hand the viewer the bottom back rather than wherever it left them.
    if (paging.pages > 0) {
      scrollHandle.current?.follow();
      anchorDone.current = target;
    }
  }, [room, anchor, messages, olderExhausted, loadingOlder]);

  const refetchTail = useCallback(() => {
    void fetch(`${url}?limit=${PAGE_SIZE}`)
      .then(res => res.json())
      .then((data: { messages?: ChatMessage[] }) => {
        if (roomRef.current !== room) return;
        const next = mergeMessages(messagesRef.current, data.messages ?? []);
        const added = next.length - messagesRef.current.length;
        if (added > 0 && awayRef.current) {
          setNewSinceAway(n => n + added);
          const view = scrollView();
          // A post moves its card to the bottom, under a scrolled-up reader.
          if (isFeed && view) {
            const known = new Set(messagesRef.current.map(m => m.id));
            const moving = new Set(
              next.filter(m => !known.has(m.id)).map(m => m.room)
            );
            pendingHold.current = topVisibleRow(view, moving);
          }
        }
        setMessages(next);
      })
      .catch(() => {});
  }, [room, url, isFeed]);
  useRelayFrames(frame => {
    const ours = feed
      ? typeof frame.topic === 'string' && feed.hears(frame.topic)
      : frame.topic === `chat/${room}/msg`;
    if (ours) refetchTail();
  });
  useRelayOpen(reconnect => {
    if (reconnect) refetchTail();
  });
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetchTail();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetchTail]);

  useEffect(() => {
    const view = scrollView();
    if (!view) return;
    const onScroll = () => {
      const away = view.scrollHeight - view.scrollTop - view.clientHeight > 4;
      awayRef.current = away;
      setAwayFromBottom(away);
      if (!away) setNewSinceAway(0);
    };
    view.addEventListener('scroll', onScroll, { passive: true });
    return () => view.removeEventListener('scroll', onScroll);
  }, [room]);

  function scrollView(): HTMLElement | null {
    return (
      scrollBoxRef.current?.querySelector<HTMLElement>(
        `.${scrollClasses.view}`
      ) ?? null
    );
  }

  useEffect(() => () => hold.current?.(), [room]);

  // A room opens at its bottom, with no scroll animation: the jump lands in
  // the same paint as the messages, and a block that grows just after (a
  // lazy code highlighter) stays pinned rather than easing the view down.
  const openedRoom = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (anchor || messages.length === 0) return;
    if (!feed && messages[0]?.room !== room) return;
    if (openedRoom.current === room) return;
    openedRoom.current = room;
    const view = scrollView();
    const column = columnRef.current;
    if (!view || !column) return;
    const pin = () => {
      view.scrollTop = view.scrollHeight;
    };
    pin();
    const observer = new ResizeObserver(pin);
    observer.observe(column);
    const stop = () => {
      observer.disconnect();
      clearTimeout(timer);
      for (const name of HOLD_BREAKERS) view.removeEventListener(name, stop);
    };
    const timer = setTimeout(stop, HOLD_MS);
    for (const name of HOLD_BREAKERS) {
      view.addEventListener(name, stop, { passive: true });
    }
    hold.current?.();
    hold.current = stop;
  }, [room, anchor, messages, feed]);

  useLayoutEffect(() => {
    const pending = pendingHold.current;
    const view = scrollView();
    if (!pending || !view) return;
    pendingHold.current = null;
    holdRow(view, columnRef.current, pending.id, pending.offset, hold);
  }, [messages]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest || loadingOlder || olderExhausted) return;
    setLoadingOlder(true);
    // A short room can show the control while the list still follows the
    // bottom; without this the prepend would snap the viewer back down.
    scrollHandle.current?.park(() => scrollView()?.scrollTop ?? 0);
    // The request belongs to the room it was started for: a switch while it
    // is in flight must neither prepend its page to the new room nor leave
    // `loadingOlder` stuck.
    const forRoom = room;
    const current = () => roomRef.current === forRoom;
    try {
      const res = await fetch(`${url}?before=${oldest.id}&limit=${PAGE_SIZE}`);
      if (!current()) return;
      // An error page is not an empty page: the edge stays retryable.
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: ChatMessage[] };
      if (!current()) return;
      const older = data.messages ?? [];
      if (older.length < PAGE_SIZE) setOlderExhausted(true);
      if (older.length > 0) {
        const view = scrollView();
        const offset = view ? rowOffset(view, oldest.id) : null;
        pendingHold.current =
          isFeed && view
            ? topVisibleRow(view)
            : offset === null
              ? null
              : { id: oldest.id, offset };
        setMessages(prev => {
          const known = new Set(prev.map(m => m.id));
          const additions = older.filter(m => !known.has(m.id));
          return [...additions, ...prev].sort(
            (a, b) => a.postedAt - b.postedAt || a.id - b.id
          );
        });
      }
    } catch {
      // The daemon being down is silence, not a crash -- the edge control
      // just stays put for a retry.
    } finally {
      if (current()) setLoadingOlder(false);
    }
  }
  loadOlderRef.current = () => void loadOlder();

  // A click that selected text, or landed on a link, was not a pick.
  const pickBlock = (event: MouseEvent<HTMLDivElement>, blockRoom: string) => {
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return;
    if (window.getSelection()?.toString()) return;
    if (target.closest('a, button')) return;
    feed?.onPick(blockRoom);
  };

  const target = feed?.target(messages);

  const list = (
    <Box
      style={{
        // `minWidth: 0` so a long pasted path wraps inside the panel rather
        // than widening the whole row.
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // A white card only rises off something darker than itself.
        background: bare
          ? undefined
          : feed
            ? 'color-mix(in srgb, var(--tk-bg) 50%, var(--tk-card))'
            : 'var(--tk-card)',
      }}
      data-testid="transcript"
    >
      {/* Sticky-bottom scrolling, as console's chat does it: the
          list follows new messages while the viewer is at the bottom, and a
          follow button appears once they scroll up. The wrapper is the
          positioned box the absolute root fills. */}
      <Box
        ref={scrollBoxRef}
        data-testid="transcript-scroll"
        className={scrollClasses.box}
        onClick={
          feed &&
          (event => {
            const target = event.target as HTMLElement;
            // A portalled card still bubbles its clicks through here.
            if (!event.currentTarget.contains(target)) return;
            if (window.getSelection()?.toString()) return;
            if (!target.closest(`.${prose.block}, a, button`)) {
              feed.onPick(undefined);
            }
          })
        }
        style={{ flex: 1, minHeight: 0 }}
      >
        <ScrollToBottom
          className={scrollClasses.root}
          scrollViewClassName={scrollClasses.view}
          followButtonClassName={scrollClasses.follow}
          initialScrollBehavior="auto"
        >
          <ScrollHandle handle={scrollHandle} />
          <Box
            className={scrollClasses.bottom}
            data-loading={loading || undefined}
            style={bare || !compact ? undefined : { padding: `0 ${inset}` }}
          >
            <div
              ref={columnRef}
              className={prose.col}
              data-compact={compact || undefined}
              data-testid="transcript-column"
            >
              {loading && messages.length === 0 && <MessageSkeleton />}
              {messages.length > 0 && !olderExhausted && (
                <OlderEdge
                  loading={loadingOlder}
                  onLoad={() => void loadOlder()}
                />
              )}

              <Stack gap={0}>
                {feed && !feed.timeline
                  ? blocksByLatest(messages).map(block => {
                      const blockRoom = block[0]!.room;
                      return (
                        <Fragment key={blockRoom}>
                          <div
                            className={prose.block}
                            data-testid={`direct-block-${blockRoom}`}
                            data-picked={target === blockRoom || undefined}
                            onClick={event => pickBlock(event, blockRoom)}
                          >
                            {block.map((message, i) => (
                              <MessageRow
                                key={message.id}
                                message={message}
                                humanHandle={humanHandle}
                                compact={compact}
                                grouped={continuesGroup(block[i - 1], message)}
                                dated
                              />
                            ))}
                          </div>
                        </Fragment>
                      );
                    })
                  : byDay(messages).map((day, d) => (
                      <div key={day[0]!.message.id}>
                        <Marker
                          label={dayLabel(day[0]!.message.postedAt)}
                          testId={
                            d === 0 && olderExhausted
                              ? 'transcript-start'
                              : 'day-divider'
                          }
                        />
                        {day.map(({ message, i }) => {
                          const prev = messages[i - 1];
                          const row = (
                            <MessageRow
                              key={message.id}
                              message={message}
                              humanHandle={humanHandle}
                              compact={compact}
                              grouped={
                                continuesGroup(prev, message) &&
                                (!feed || prev?.room === message.room)
                              }
                              dated={false}
                              to={feed?.timeline?.to(message)}
                            />
                          );
                          if (!feed) return row;
                          return (
                            <div
                              key={message.id}
                              className={prose.timelineRow}
                              data-picked={target === message.room || undefined}
                              onClick={event => pickBlock(event, message.room)}
                            >
                              {row}
                            </div>
                          );
                        })}
                      </div>
                    ))}
              </Stack>
              {!loading && messages.length === 0 && empty}
            </div>
          </Box>
        </ScrollToBottom>
        {awayFromBottom && (
          <NewPill
            count={newSinceAway}
            onClick={() => {
              const view = scrollView();
              if (!view) return;
              if (typeof view.scrollTo === 'function') {
                view.scrollTo({ top: view.scrollHeight, behavior: 'smooth' });
              } else {
                view.scrollTop = view.scrollHeight;
              }
            }}
          />
        )}
      </Box>
      {footer && (
        <Box
          style={
            bare ? undefined : { padding: `0 ${inset} ${compact ? 10 : 20}px` }
          }
        >
          <div className={prose.col}>
            {typeof footer === 'function' ? footer(messages) : footer}
          </div>
        </Box>
      )}
    </Box>
  );
  if (!feed) return list;
  return <FaceGroup handles={feed.faces}>{list}</FaceGroup>;
}
