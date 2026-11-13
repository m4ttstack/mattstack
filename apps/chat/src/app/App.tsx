import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  DaemonBanner,
  MattstackShell,
  NotFoundPage,
  ScopeBar,
  useDaemonHealth,
  useViewer,
  ViewerChip,
} from '@mattstack/app-kit/app';
import {
  Box,
  Center,
  Group,
  PageShell,
  Stack,
  Text,
  usePageShellContext,
} from '@mattstack/app-kit/core';
import { useIsMobile } from '@mattstack/app-kit/hooks';
import { notifications } from '@mattstack/app-kit/notifications';
import type {
  ChatMember,
  ChatMessage,
  RoomSummary,
} from '@mattstack/rt-client';
import { useInterval } from 'react-interval-hook';
import { useLocation } from 'wouter';
import { navigate } from 'wouter/use-browser-location';

import { FaceGroup } from './AgentName';
import { BuddiesProvider } from './buddies-context';
import { RailSkeleton, RoomSkeleton, TitleSkeleton } from './ChatSkeleton';
import { Composer, type ComposerHandle } from './Composer';
import { PageShellDemoPage } from './demo/PageShellDemoPage';
import { DIRECT_PATH, isMine, waitingCount } from './direct';
import { DirectView } from './DirectView';
import { confirmArchiveHerd, type FleetRoom } from './FleetTree';
import { groupHerds, herdPath, type HerdGroup } from './herds';
import { HerdBar, HerdView } from './HerdView';
import type { Me } from './human';
import { NewSlackChatDialog } from './NewSlackChatDialog';
import { PageBar } from './PageBar';
import { isMsgTopic, useRelayFrames, useRelayOpen } from './relay-socket';
import { RoomRail, type RoomRailProps } from './RoomRail';
import type { RosterBuddy } from './roster-types';
import { useAppRoute, useHash } from './routes';
import { SettingsButton } from './SettingsEntry';
import {
  isOpening,
  SlackChatsProvider,
  SupportChatOpenContext,
  useRefreshSlackChats,
  useSlackChat,
  useSlackChats,
} from './slack-chats-context';
import { SlackOpeningNote } from './SlackOpeningNote';
import { PAGE_SIZE, Transcript } from './Transcript';
import { latestActiveRoom, visibleRooms } from './visible-rooms';

/**
 * `/api/chat/buddies`' own wire shape -- `FleetTree` reads the full
 * `PresenceRow` (branch/cwd/pane/statusText/signedInAt, ...), not just the
 * `status`/timestamp subset `statusDetail.ts` needs, so this is the full
 * roster row, not that narrower shape.
 */
export type Buddy = RosterBuddy;

const SIDEBAR_BOUNDS = { initial: 340, min: 260, max: 520 };
const PAGE_ROW_HEIGHT = 52;

/**
 * Seeds the app's data instead of a network call -- every UI test in this
 * repo uses this seam rather than mocking `fetch`. `daemonReachable` seeds
 * `useDaemonHealth`'s starting state; `buddies` seeds the roster fetch. The
 * remaining fields are reserved for the tasks that render rooms/members/
 * messages, so the shape is settled once rather than re-litigated per task.
 */
export interface AppInitialState {
  daemonReachable?: boolean;
  buddies?: Buddy[];
  rooms?: FleetRoom[];
  members?: ChatMember[];
  messages?: ChatMessage[];
}

/**
 * Fetches the buddy roster on mount (skipped when `seed` replaces it, the
 * same test seam `useDaemonHealth` reads), every 5s, and again on any
 * `chat/<room>/msg` frame from the page's relay socket. A post is a hint a
 * buddy's presence may have moved (it is the daemon's own signal that a
 * session touched something), not that its status changed -- the daemon
 * still owns status, always -- but it is worth refreshing before the next
 * scheduled poll.
 */
/** A daemon failure is a 502 with an `{ error }` body, which must not read as
    an empty list: callers keep what they already show. */
async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.url}: ${res.status}`);
  return res.json() as Promise<T>;
}

function useBuddies(seed: Buddy[] | undefined): {
  buddies: Buddy[];
  refetchBuddies: () => void;
} {
  const [buddies, setBuddies] = useState<Buddy[]>(seed ?? []);

  const fetchBuddies = useCallback(() => {
    fetch('/api/chat/buddies')
      .then(res => jsonOrThrow<{ buddies?: Buddy[] }>(res))
      .then(data => setBuddies(data.buddies ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (seed !== undefined) return;
    fetchBuddies();
    // Mount-only: `seed` is a one-time starting value, not a prop to re-sync on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInterval(fetchBuddies, 5000);

  useRelayFrames(frame => {
    if (isMsgTopic(frame.topic)) fetchBuddies();
  });

  return { buddies, refetchBuddies: fetchBuddies };
}

/**
 * Fetches the room list on mount (skipped when `seed` replaces it) and
 * exposes `refetchRooms` for after a write that can introduce a room the
 * mount-time fetch never saw -- `openDm` opens or reuses a room this list
 * has no reason to have fetched yet.
 */
function useRooms(seed: FleetRoom[] | undefined) {
  const [rooms, setRooms] = useState<FleetRoom[]>(seed ?? []);
  const [loaded, setLoaded] = useState(seed !== undefined);

  // Resolves to the fetched list for a caller that wants it directly. A
  // failed fetch resolves to [] with `rooms` left untouched, rather than
  // reading as every room vanishing.
  const refetchRooms = useCallback(async (): Promise<FleetRoom[]> => {
    try {
      const res = await fetch('/api/chat/rooms');
      const data = await jsonOrThrow<{ rooms?: FleetRoom[] }>(res);
      const next = data.rooms ?? [];
      setRooms(next);
      setLoaded(true);
      return next;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    if (seed !== undefined) return;
    void refetchRooms();
    // Mount-only, same reasoning as useBuddies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roomsRef = useRef(rooms);
  // Mirror rooms into the ref from an effect, never in render: a discarded
  // concurrent render must not leave the ref holding an uncommitted list. The
  // relay callback below only ever reads it after commit, so an effect is soon
  // enough.
  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);
  // A post into a room this list has never seen is the daemon's only signal
  // that a room exists now; refetch at once instead of waiting for the poll.
  useRelayFrames(frame => {
    if (!isMsgTopic(frame.topic)) return;
    const room = frame.topic.slice('chat/'.length, -'/msg'.length);
    if (!roomsRef.current.some(r => r.room === room)) void refetchRooms();
  });

  return { rooms, loaded, setRooms, refetchRooms };
}

/**
 * Fetches one room's message tail whenever `room` changes. `seed` (from
 * `initialState.messages`) replaces the very first fetch only -- once the
 * viewer switches rooms, or a test unmounts/remounts with a different
 * `room`, the real fetch takes over, same as production always uses.
 */
function useMessages(
  room: string | undefined,
  seed: ChatMessage[] | undefined
): { messages: ChatMessage[]; loaded: boolean } {
  const [messages, setMessages] = useState<ChatMessage[]>(seed ?? []);
  const [loadedRoom, setLoadedRoom] = useState<string>();
  // The seed stays PENDING until the first defined room arrives, then is
  // spent on it. `activeRoom` is undefined on the first render (a later
  // effect lands on the first room), so binding the seed to `room` at mount
  // bound it to `undefined` and every real room refetched -- which is the
  // seed never working at all. Guarding on `seed !== undefined` alone had
  // the opposite failure: it suppressed EVERY fetch for the life of the
  // mount, so a room switch kept the first room's transcript.
  const seedPending = useRef(seed !== undefined);

  useEffect(() => {
    if (!room) {
      // Do NOT clear while the seed is still pending: `activeRoom` is
      // undefined on the first render, so clearing here threw the seed away
      // before any room could consume it.
      if (!seedPending.current) setMessages([]);
      return;
    }
    if (seedPending.current) {
      seedPending.current = false;
      setLoadedRoom(room);
      return;
    }
    // Clears immediately on a room switch rather than leaving the PREVIOUS
    // room's tail visible until the new fetch resolves -- Transcript
    // re-seeds off this array's identity, not off `room` alone.
    setMessages([]);
    let cancelled = false;
    fetch(`/api/chat/messages/${room}?limit=${PAGE_SIZE}`)
      .then(res => jsonOrThrow<{ messages?: ChatMessage[] }>(res))
      .then(data => {
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setLoadedRoom(room);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [room]);

  return { messages, loaded: room !== undefined && loadedRoom === room };
}

/**
 * Fetches one room's member list whenever `room` changes, mirroring
 * `useMessages`'s seed/refetch shape. Callers key by handle (`FleetTree`'s
 * "is this handle in the open room", the composer's mention insert) and show
 * by name (`memberNames`), so both fall out of this one fetch rather than
 * carrying the full `ChatMember` shape further than this hook.
 */
function useRoomMembers(
  room: string | undefined,
  seed: ChatMember[] | undefined
): {
  members: string[];
  memberNames: ReadonlyMap<string, string>;
  loaded: boolean;
  refetchMembers: () => void;
} {
  const [members, setMembers] = useState<ChatMember[]>(seed ?? []);
  const [settledRoom, setSettledRoom] = useState(seed ? room : undefined);
  // Same one-shot rule as useMessages: pending until the first defined room.
  const seedPending = useRef(seed !== undefined);
  const roomRef = useRef(room);
  roomRef.current = room;

  const fetchMembers = useCallback(() => {
    if (!room) return;
    fetch(`/api/chat/who/${room}`)
      .then(res => jsonOrThrow<{ members?: ChatMember[] }>(res))
      .then(data => {
        if (roomRef.current === room) setMembers(data.members ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (roomRef.current === room) setSettledRoom(room);
      });
  }, [room]);

  useEffect(() => {
    if (!room) {
      if (!seedPending.current) setMembers([]);
      return;
    }
    if (seedPending.current) {
      seedPending.current = false;
      return;
    }
    setMembers([]);
    fetchMembers();
  }, [room, fetchMembers]);

  // A post is the one signal an arriving member makes: the join skill's
  // first line. The daemon emits no membership frame, so this is the hook.
  useRelayFrames(frame => {
    if (room && frame.topic === `chat/${room}/msg`) fetchMembers();
  });

  const memberNames = useMemo(
    () => new Map(members.map(m => [m.handle, m.name ?? m.handle])),
    [members]
  );

  return {
    members: members.map(m => m.handle),
    memberNames,
    loaded: room !== undefined && settledRoom === room,
    refetchMembers: fetchMembers,
  };
}

/**
 * No rooms at all: nobody is signed in anywhere and the human has joined
 * nothing. Distinct from "rooms exist but none selected".
 *
 * The copy matters: it must say the fleet is asleep, never that the app is
 * unfinished, which is what a "hasn't landed yet" placeholder would claim.
 */
function RoomsPlaceholder({
  anyBuddies,
  allClosed,
}: {
  anyBuddies: boolean;
  allClosed: boolean;
}) {
  return (
    <Center mih="40dvh">
      <Stack align="center" gap="xs">
        <Text fw={600}>No rooms</Text>
        <Text size="sm" c="dimmed">
          {allClosed
            ? 'Every room is closed. A post from anyone brings its room back.'
            : anyBuddies
              ? 'Agents are signed in but not in a room yet.'
              : 'No agent has signed in. A room appears when one does.'}
        </Text>
      </Stack>
    </Center>
  );
}

/** Inside `PageShell.Sidebar`, which on a phone is a drawer: picking a row
    closes it. */
/** The server's `{ error }` message, for a toast that says what went wrong. */
async function errorOf(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as {
    error?: string;
  } | null;
  return data?.error ?? `HTTP ${res.status}`;
}

const ME_RETRY_MS = 5000;

/** The viewer's handle and shown name, blank until the server answers. It asks
    again until it does: a blank handle owns no mentions, so a brief failure
    at page load must not last the session. */
function useMe(): Me {
  const [me, setMe] = useState<Me>({
    handle: '',
    name: '',
  });
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const ask = () => {
      fetch('/api/chat/me')
        .then(res => jsonOrThrow<Me>(res))
        .then(next => {
          if (!stopped) setMe(next);
        })
        .catch(() => {
          if (!stopped) timer = setTimeout(ask, ME_RETRY_MS);
        });
    };
    ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return me;
}

/** The viewer's Slack picture, found by their full name. */
function useOwnSlackFace(name: string | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    fetch(`/api/chat/slack-face?name=${encodeURIComponent(name)}`)
      .then(res => jsonOrThrow<{ url?: string | null }>(res))
      .then(data => {
        if (!cancelled) setUrl(data.url ?? undefined);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [name]);
  return url;
}

function ChatSidebar({
  rooms,
  buddies,
  activeRoom,
  selectRoom,
  reachable,
  onCloseRoom,
  onNewSlackChat,
  direct,
  activeHerd,
  onOpenHerd,
}: {
  rooms: FleetRoom[];
  buddies: Buddy[];
  activeRoom: string | undefined;
  selectRoom: (room: string) => void;
  reachable: boolean;
  onCloseRoom: (room: string) => void;
  onNewSlackChat: () => void;
  direct: RoomRailProps['direct'];
  activeHerd: string | undefined;
  onOpenHerd: (id: string) => void;
}) {
  const { collapsedSidebar, sidebarOpen, toggleSidebar } =
    usePageShellContext();
  const closeDrawer = () => {
    if (collapsedSidebar && sidebarOpen) toggleSidebar();
  };
  return (
    <RoomRail
      sidebar
      rooms={rooms}
      buddies={buddies}
      activeRoom={activeRoom}
      onSelectRoom={room => {
        selectRoom(room);
        closeDrawer();
      }}
      daemonReachable={reachable}
      onCloseRoom={onCloseRoom}
      onNewSlackChat={() => {
        onNewSlackChat();
        closeDrawer();
      }}
      activeHerd={activeHerd}
      onOpenHerd={id => {
        onOpenHerd(id);
        closeDrawer();
      }}
      direct={
        direct && {
          ...direct,
          onOpen: () => {
            direct.onOpen();
            closeDrawer();
          },
        }
      }
    />
  );
}

interface ChatPageProps {
  rooms: RoomSummary[];
  roomsLoaded: boolean;
  messagesLoaded: boolean;
  openRooms: RoomSummary[];
  railRooms: FleetRoom[];
  activeRoom: string | undefined;
  activeRoomSummary: RoomSummary | undefined;
  selectRoom: (room: string) => void;
  daemon: ReturnType<typeof useDaemonHealth>;
  buddies: Buddy[];
  roomMembers: string[];
  membersLoaded: boolean;
  messages: ChatMessage[];
  anchor: string | undefined;
  me: Me;
  composerRef: RefObject<ComposerHandle | null>;
  onOpenDm: (handle: string, draft?: string) => void;
  onCloseRoom: (room: string) => void;
  onNewSlackChat: () => void;
  /** Messages to you is the open view. */
  directOpen: boolean;
  directPick: string | undefined;
  /** What was typed in a room before a DM opened from its `@` list. */
  directDraft: string | undefined;
  onDirectPick: (room: string | undefined) => void;
  railDirect: RoomRailProps['direct'];
  /** The herd route's id, whether or not the listing has its rooms yet. */
  herdOpen: string | undefined;
  herd: HerdGroup | undefined;
  herdPick: string | undefined;
  onHerdPick: (room: string | undefined) => void;
  onOpenHerd: (id: string) => void;
}

function ChatPage({
  rooms,
  roomsLoaded,
  messagesLoaded,
  openRooms,
  railRooms,
  activeRoom,
  activeRoomSummary,
  selectRoom,
  daemon,
  buddies,
  roomMembers,
  membersLoaded,
  messages,
  anchor,
  me,
  composerRef,
  onOpenDm,
  onCloseRoom,
  onNewSlackChat,
  directOpen,
  directPick,
  directDraft,
  onDirectPick,
  railDirect,
  herdOpen,
  herd,
  herdPick,
  onHerdPick,
  onOpenHerd,
}: ChatPageProps) {
  const isMobile = useIsMobile();
  const opening = isOpening(useSlackChat(activeRoom ?? ''), activeRoomSummary);
  return (
    <PageShell
      scrollClamp
      resizableSidebar={{
        storageKey: 'chat-sidebar-width',
        bounds: SIDEBAR_BOUNDS,
      }}
      headerHeight={PAGE_ROW_HEIGHT}
      compactHeader
      drawerStateKey="chat-rooms-sidebar"
    >
      {(!roomsLoaded || rooms.length > 0 || buddies.length > 0) && (
        <PageShell.Sidebar
          hideCollapseButton
          // The kit's sidebar ScrollArea content defaults to
          // `min-width: min-content`, which would size the column to its
          // widest row and defeat each row's own truncation.
          scrollAreaProps={{ styles: { content: { minWidth: 0 } } }}
        >
          {roomsLoaded ? (
            <ChatSidebar
              rooms={railRooms}
              buddies={buddies}
              activeRoom={activeRoom}
              selectRoom={selectRoom}
              reachable={daemon.reachable}
              onCloseRoom={onCloseRoom}
              onNewSlackChat={onNewSlackChat}
              direct={railDirect}
              activeHerd={herdOpen}
              onOpenHerd={onOpenHerd}
            />
          ) : (
            <RailSkeleton />
          )}
        </PageShell.Sidebar>
      )}
      <PageShell.Main>
        {herdOpen ? (
          <PageShell.Header>
            {herd ? (
              <HerdBar
                group={herd}
                onArchive={() => confirmArchiveHerd(herd, onCloseRoom)}
              />
            ) : roomsLoaded ? null : (
              <TitleSkeleton />
            )}
          </PageShell.Header>
        ) : !directOpen && (activeRoomSummary || !roomsLoaded) ? (
          <PageShell.Header>
            {activeRoomSummary ? (
              <PageBar
                room={activeRoomSummary}
                buddies={buddies.filter(b => roomMembers.includes(b.handle))}
                membersLoading={!membersLoaded}
                onArchive={onCloseRoom}
                reachable={daemon.reachable}
              />
            ) : (
              <TitleSkeleton />
            )}
          </PageShell.Header>
        ) : null}
        <PageShell.Content
          contentContainer={false}
          bg="var(--tk-card)"
          topNotch={{
            opened: !daemon.reachable,
            content: (
              <Box w="100%" px="lg" pt="lg" data-testid="daemon-banner-slot">
                <DaemonBanner
                  reachable={daemon.reachable}
                  downSince={daemon.downSince}
                  probeCount={daemon.probeCount}
                  lastAnsweredAt={daemon.lastAnsweredAt}
                  onProbeNow={daemon.probeNow}
                />
              </Box>
            ),
          }}
        >
          <Group
            align="stretch"
            wrap="nowrap"
            gap={0}
            style={{ flex: 1, minHeight: 0, minWidth: 0 }}
          >
            {herdOpen ? (
              herd ? (
                <HerdView
                  key={herd.tag.id}
                  tag={herd.tag}
                  rooms={herd.rooms}
                  me={me.handle}
                  picked={herdPick}
                  onPick={onHerdPick}
                  composer={(room, worker, to, onDraftChange) => (
                    <Composer
                      ref={composerRef}
                      phone={isMobile}
                      humanHandle={me.handle}
                      room={room}
                      roomMembers={
                        worker
                          ? [me.handle, herd.tag.shepherdHandle, worker.handle]
                          : [me.handle]
                      }
                      buddies={buddies}
                      isDm={worker !== undefined}
                      daemonReachable={daemon.reachable}
                      onOpenDm={onOpenDm}
                      to={to}
                      onDraftChange={onDraftChange}
                    />
                  )}
                />
              ) : roomsLoaded ? (
                <Box style={{ flex: 1, minWidth: 0 }} p="xl">
                  <Text c="dimmed">This herd has no conversations</Text>
                </Box>
              ) : (
                <RoomSkeleton />
              )
            ) : directOpen ? (
              <DirectView
                rooms={rooms}
                me={me.handle}
                picked={directPick}
                onPick={onDirectPick}
                composer={(room, to, onDraftChange) => (
                  <Composer
                    ref={composerRef}
                    phone={isMobile}
                    humanHandle={me.handle}
                    room={room}
                    roomMembers={to ? [me.handle, to.handle] : [me.handle]}
                    buddies={buddies}
                    isDm
                    daemonReachable={daemon.reachable}
                    onOpenDm={onOpenDm}
                    replyTo={to}
                    onDraftChange={onDraftChange}
                    prefill={directDraft ? { body: directDraft } : undefined}
                  />
                )}
              />
            ) : openRooms.length === 0 && !activeRoomSummary ? (
              roomsLoaded ? (
                <Box style={{ flex: 1, minWidth: 0 }} p="xl">
                  <RoomsPlaceholder
                    anyBuddies={buddies.length > 0}
                    allClosed={rooms.length > 0}
                  />
                </Box>
              ) : (
                <RoomSkeleton />
              )
            ) : (
              activeRoom && (
                <Transcript
                  room={activeRoom}
                  messages={messages}
                  loading={!messagesLoaded}
                  humanHandle={me.handle}
                  anchor={anchor}
                  empty={opening ? <SlackOpeningNote /> : undefined}
                  footer={
                    <Composer
                      ref={composerRef}
                      phone={isMobile}
                      humanHandle={me.handle}
                      room={activeRoom}
                      roomMembers={roomMembers}
                      buddies={buddies}
                      isDm={activeRoomSummary?.kind === 'dm'}
                      daemonReachable={daemon.reachable}
                      onOpenDm={onOpenDm}
                      opening={opening}
                    />
                  }
                />
              )
            )}
          </Group>
        </PageShell.Content>
      </PageShell.Main>
    </PageShell>
  );
}

/**
 * The whole app, today: `MattstackShell` (rail + header chrome) around the
 * Rooms placeholder, routed by wouter's default browser-location hooks (see
 * ./routes). The kit's
 * full-screen PageShell demo stays reachable at '/demo' -- inherited
 * scaffold content, unrelated to chat, and it bypasses the chrome entirely
 * the same way it always has.
 *
 * `initialState` seeds the daemon-health and buddies data instead of a
 * network call -- the seam every UI test in this repo uses. Production
 * never passes it: the daemon poll and the buddies fetch run for real.
 */
export function App({ initialState }: { initialState?: AppInitialState } = {}) {
  const { chats: slackChats, refresh: refreshSlackChats } = useSlackChats();
  const me = useMe();
  // Your org, team and role for the top bar, as console shows them.
  const viewer = useViewer();
  const ownFace = useOwnSlackFace(viewer?.viewer?.name);
  return (
    <SlackChatsProvider
      chats={slackChats}
      refresh={refreshSlackChats}
      own={ownFace ? { handle: me.handle, url: ownFace } : undefined}
    >
      <AppContent initialState={initialState} me={me} viewer={viewer} />
    </SlackChatsProvider>
  );
}

function AppContent({
  initialState,
  me,
  viewer,
}: {
  initialState?: AppInitialState;
  me: Me;
  viewer: ReturnType<typeof useViewer>;
}) {
  const [path] = useLocation();
  const route = useAppRoute();
  const refreshSlackChats = useRefreshSlackChats();
  const [newChatOpen, setNewChatOpen] = useState(false);
  const daemon = useDaemonHealth(initialState?.daemonReachable);
  const { buddies, refetchBuddies } = useBuddies(initialState?.buddies);
  const {
    rooms,
    loaded: roomsLoaded,
    setRooms,
    refetchRooms,
  } = useRooms(initialState?.rooms);
  // A room mid-close is still in the daemon's list until the close request
  // resolves; a background refetch racing that request would otherwise put
  // the optimistically-removed row right back.
  const closingRoomsRef = useRef(new Set<string>());
  const refetchRoomsFiltered = useCallback(async () => {
    const next = await refetchRooms();
    if (closingRoomsRef.current.size === 0) return next;
    const filtered = next.filter(r => !closingRoomsRef.current.has(r.room));
    setRooms(filtered);
    return filtered;
  }, [refetchRooms, setRooms]);
  // The floor beneath the relay-driven refreshes below: a poll that still
  // runs even if a frame is missed, a reconnect never fires, or the tab
  // never blurs long enough to trigger the visibility refetch.
  useInterval(refetchRoomsFiltered, 5000);
  const routeRoom =
    route.name === 'room' || route.name === 'embed' ? route.room : undefined;
  const [activeRoom, setActiveRoom] = useState<string | undefined>(routeRoom);
  const directOpen = route.name === 'direct';
  const herdOpen = route.name === 'herd' ? route.herd : undefined;
  const chatRoute =
    route.name === 'home' ||
    route.name === 'room' ||
    directOpen ||
    herdOpen !== undefined;
  const [herdPick, setHerdPick] = useState<string>();
  const [directPick, setDirectPick] = useState<string>();
  const [directDraft, setDirectDraft] = useState<string>();
  // The view's composer mounts with the route, after the DM has opened.
  const focusWhenOpen = useRef(false);
  const hash = useHash();
  const anchor = hash.startsWith('#m-') ? hash.slice(1) : undefined;
  const composerRef = useRef<ComposerHandle>(null);

  // The URL owns the room: `/r/<room>` names it, and `/` hands over to the
  // latest active conversation. A rail click writes the URL (selectRoom), so
  // a room the viewer chose is always a `/r/` route.
  useEffect(() => {
    if (route.name === 'room' || route.name === 'embed') {
      if (route.room !== activeRoom) setActiveRoom(route.room);
    } else if (
      (route.name === 'home' ||
        route.name === 'direct' ||
        route.name === 'herd') &&
      activeRoom !== undefined
    ) {
      setActiveRoom(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name, routeRoom]);

  function selectRoom(room: string) {
    setActiveRoom(room);
    const to = `/r/${encodeURIComponent(room)}`;
    if (window.location.pathname !== to) navigate(to);
  }

  const openDm = useCallback(
    async (handle: string, draft?: string) => {
      try {
        const res = await fetch('/api/chat/dm/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: handle }),
        });
        if (!res.ok) throw new Error('dm open failed');
        const data = (await res.json()) as { room: string };
        void refetchRooms();
        const embed = route.name === 'embed';
        // A DM of the human's own opens in Messages to you, aimed at them.
        if (!embed) {
          setDirectPick(data.room);
          setActiveRoom(undefined);
          if (window.location.pathname === DIRECT_PATH) {
            composerRef.current?.focus();
            return;
          }
          setDirectDraft(draft?.trim() ? draft : undefined);
          focusWhenOpen.current = true;
          navigate(DIRECT_PATH);
          return;
        }
        setActiveRoom(data.room);
        const to = `${embed ? '/embed/r' : '/r'}/${encodeURIComponent(data.room)}`;
        if (window.location.pathname !== to) {
          navigate(embed ? to + window.location.search : to);
        }
        composerRef.current?.focus();
      } catch {
        notifications.error("Couldn't open the DM");
      }
    },
    [refetchRooms, route.name]
  );

  // Optimistic: the row leaves the rail before the request resolves, and a
  // failure puts the snapshot back. Closing the open room lands on `/`, the
  // same first-open-room landing a fresh open uses.
  const closeRoom = useCallback(
    async (room: string) => {
      const snapshot = rooms;
      closingRoomsRef.current.add(room);
      setRooms(prev => prev.filter(r => r.room !== room));
      if (room === activeRoom) {
        setActiveRoom(undefined);
        if (window.location.pathname !== '/') navigate('/');
      }
      try {
        const res = await fetch('/api/chat/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room }),
        });
        if (!res.ok) throw new Error(await errorOf(res));
      } catch (err) {
        notifications.error(
          `Couldn't archive the room: ${err instanceof Error ? err.message : 'no answer from the server'}`
        );
        // Restore only THIS room. A blanket setRooms(snapshot) would resurrect
        // a room a concurrent close already removed and drop one that arrived
        // since; rebuild from the snapshot keeping rooms still present plus the
        // one we failed to close, in snapshot order, then append anything new.
        setRooms(prev => {
          const present = new Set(prev.map(r => r.room));
          const revived = snapshot.filter(
            r => r.room === room || present.has(r.room)
          );
          const known = new Set(revived.map(r => r.room));
          return [...revived, ...prev.filter(r => !known.has(r.room))];
        });
        return;
      } finally {
        closingRoomsRef.current.delete(room);
      }
      void refetchRooms();
    },
    [rooms, activeRoom, setRooms, refetchRooms]
  );

  // The new chat's room is in the daemon's list the moment the start
  // answers; both lists read again so its row and its Opening state show.
  const slackChatStarted = useCallback(
    async (room: string | null) => {
      refreshSlackChats();
      await refetchRooms();
      if (room) selectRoom(room);
    },
    [refreshSlackChats, refetchRooms]
  );

  const focusPane = useCallback(async (paneId: string) => {
    try {
      // Raw pane id in the path, like the peek route; Hono routes the colon.
      const res = await fetch(`/api/panes/${paneId}/focus`, { method: 'POST' });
      if (!res.ok) throw new Error('focus failed');
    } catch {
      notifications.error("Couldn't focus the pane");
    }
  }, []);

  const buddyActions = useMemo(
    () => ({
      mention: (handle: string) => composerRef.current?.insertMention(handle),
      dm: (handle: string) => void openDm(handle),
      focusPane: (paneId: string) => void focusPane(paneId),
    }),
    [openDm, focusPane]
  );
  const openRooms = rooms.filter(r => r.archivedAt === undefined);
  const railRooms = visibleRooms(rooms, activeRoom);
  useEffect(() => {
    if (route.name !== 'home') return;
    const latest = latestActiveRoom(rooms);
    if (!latest) return;
    const room = rooms.find(r => r.room === latest);
    const to =
      room && isMine(room, me.handle)
        ? DIRECT_PATH
        : `/r/${encodeURIComponent(latest)}`;
    navigate(to, { replace: true });
  }, [route.name, rooms, me.handle]);

  useEffect(() => {
    if (!directOpen || !focusWhenOpen.current) return;
    focusWhenOpen.current = false;
    composerRef.current?.focus();
  }, [directOpen, directPick]);

  // The pick and the carried draft belong to one visit to the view.
  useEffect(() => {
    if (directOpen) return;
    setDirectPick(undefined);
    setDirectDraft(undefined);
  }, [directOpen]);

  const herd = herdOpen
    ? groupHerds(rooms).find(g => g.tag.id === herdOpen)
    : undefined;
  const openHerd = useCallback((id: string) => {
    setHerdPick(undefined);
    const to = herdPath(id);
    if (window.location.pathname !== to) navigate(to);
  }, []);
  useEffect(() => {
    setHerdPick(undefined);
  }, [herdOpen]);
  const herdUnread = herd?.rooms.some(r => r.unread > 0) ?? false;
  const markingHerd = useRef(false);
  // Seeing the herd reads it, retried on each listing like Messages to you.
  useEffect(() => {
    if (!herdOpen || !herdUnread || markingHerd.current) return;
    if (document.visibilityState !== 'visible') return;
    markingHerd.current = true;
    void fetch(`/api/chat/herd/${encodeURIComponent(herdOpen)}/read`, {
      method: 'POST',
    })
      .then(res => {
        if (res.ok) void refetchRooms();
      })
      .catch(() => {})
      .finally(() => {
        markingHerd.current = false;
      });
  }, [herdOpen, herdUnread, rooms, refetchRooms]);

  const waiting = waitingCount(rooms, me.handle);
  const marking = useRef(false);
  // Seeing the timeline reads it. Each listing tries again, so a failed mark
  // or a tab that was hidden catches up on the next one.
  useEffect(() => {
    if (!directOpen || waiting === 0 || marking.current) return;
    if (document.visibilityState !== 'visible') return;
    marking.current = true;
    void fetch('/api/chat/direct/read', { method: 'POST' })
      .then(res => {
        if (res.ok) void refetchRooms();
      })
      .catch(() => {})
      .finally(() => {
        marking.current = false;
      });
  }, [directOpen, waiting, rooms, refetchRooms]);
  const railDirect = useMemo(
    () => ({
      active: directOpen,
      waiting: directOpen ? 0 : waiting,
      onOpen: () => {
        setDirectPick(undefined);
        if (window.location.pathname !== DIRECT_PATH) navigate(DIRECT_PATH);
      },
      isMine: (room: FleetRoom) => isMine(room, me.handle),
    }),
    [directOpen, waiting, me.handle]
  );

  const { messages, loaded: messagesLoaded } = useMessages(
    activeRoom,
    initialState?.messages
  );
  const {
    members: roomMembers,
    memberNames: roomMemberNames,
    loaded: membersLoaded,
    refetchMembers,
  } = useRoomMembers(activeRoom, initialState?.members);
  const activeRoomSummary = rooms.find(r => r.room === activeRoom);

  // What a sleeping tab missed: rooms first (a room may have appeared),
  // then the roster, then the open room's members. The transcript refetches
  // its own tail on the same triggers.
  const refetchAll = useCallback(async () => {
    await refetchRoomsFiltered();
    refetchBuddies();
    refetchMembers();
  }, [refetchRoomsFiltered, refetchBuddies, refetchMembers]);
  useRelayOpen(reconnect => {
    if (reconnect) void refetchAll();
  });
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetchAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetchAll]);

  // Each route change starts at the top of the new page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);

  if (route.name === 'demo-page-shell') {
    return <PageShellDemoPage />;
  }

  // An open room on a phone gets its own shell; anything else falls through
  const drawnTogether = [...roomMembers, ...messages.map(m => m.handle)];

  // to the desktop layout, whose PageShell drawers its sidebar.
  if (route.name === 'embed') {
    return (
      <BuddiesProvider
        buddies={buddies}
        roomMembers={roomMembers}
        memberNames={roomMemberNames}
        me={me}
        now={Date.now()}
        reachable={daemon.reachable}
        actions={buddyActions}
      >
        <FaceGroup handles={drawnTogether}>
          <PageShell scrollClamp>
            <PageShell.Main>
              <PageShell.Content contentContainer={false}>
                <Group
                  align="stretch"
                  wrap="nowrap"
                  gap={0}
                  style={{ flex: 1, minHeight: 0, minWidth: 0 }}
                >
                  {activeRoom && (
                    <Transcript
                      compact
                      room={activeRoom}
                      messages={messages}
                      loading={!messagesLoaded}
                      humanHandle={me.handle}
                      anchor={anchor}
                      footer={
                        <Composer
                          ref={composerRef}
                          compact
                          humanHandle={me.handle}
                          room={activeRoom}
                          roomMembers={roomMembers}
                          buddies={buddies}
                          isDm={activeRoomSummary?.kind === 'dm'}
                          daemonReachable={daemon.reachable}
                          onOpenDm={openDm}
                        />
                      }
                    />
                  )}
                </Group>
              </PageShell.Content>
            </PageShell.Main>
          </PageShell>
        </FaceGroup>
      </BuddiesProvider>
    );
  }

  return (
    <SupportChatOpenContext.Provider value={newChatOpen}>
      <BuddiesProvider
        buddies={buddies}
        roomMembers={roomMembers}
        memberNames={roomMemberNames}
        me={me}
        now={Date.now()}
        reachable={daemon.reachable}
        actions={buddyActions}
      >
        <FaceGroup handles={drawnTogether}>
          <MattstackShell name="chat" rail={false} app="chat">
            <MattstackShell.Header actions={<SettingsButton />} />
            <ScopeBar info={viewer} />
            <ViewerChip info={viewer} />
            {chatRoute ? (
              <ChatPage
                rooms={rooms}
                roomsLoaded={roomsLoaded}
                messagesLoaded={messagesLoaded}
                openRooms={openRooms}
                railRooms={railRooms}
                activeRoom={activeRoom}
                activeRoomSummary={activeRoomSummary}
                selectRoom={selectRoom}
                daemon={daemon}
                buddies={buddies}
                roomMembers={roomMembers}
                membersLoaded={membersLoaded}
                messages={messages}
                anchor={anchor}
                me={me}
                composerRef={composerRef}
                onOpenDm={openDm}
                onCloseRoom={closeRoom}
                onNewSlackChat={() => setNewChatOpen(true)}
                directOpen={directOpen}
                directPick={directPick}
                directDraft={directDraft}
                onDirectPick={setDirectPick}
                railDirect={railDirect}
                herdOpen={herdOpen}
                herd={herd}
                herdPick={herdPick}
                onHerdPick={setHerdPick}
                onOpenHerd={openHerd}
              />
            ) : (
              <NotFoundPage />
            )}
            <NewSlackChatDialog
              opened={newChatOpen}
              onClose={() => setNewChatOpen(false)}
              onStarted={room => void slackChatStarted(room)}
            />
          </MattstackShell>
        </FaceGroup>
      </BuddiesProvider>
    </SupportChatOpenContext.Provider>
  );
}
