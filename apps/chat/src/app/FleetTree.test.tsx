import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import './icons';

import { BuddiesProvider } from './buddies-context';
import { dayLabel, localTime } from './day-label';
import { FleetTree, listedBuddies, type FleetRoom } from './FleetTree';
import type { RosterBuddy } from './roster-types';
import { SlackChatsProvider } from './slack-chats-context';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function buddy(
  handle: string,
  repo: string | undefined,
  over: Partial<RosterBuddy> = {}
): RosterBuddy {
  return {
    sessionId: `s-${handle}`,
    handle,
    baseHandle: handle,
    name: handle,
    repo,
    signedInAt: 1,
    lastSeenAt: NOW,
    status: 'live',
    rooms: repo ? [repo] : [],
    ...over,
  };
}

function room(name: string, over: Partial<FleetRoom> = {}): FleetRoom {
  return { room: name, memberCount: 2, unread: 0, mentions: 0, ...over };
}

function dm(a: string, b: string, over: Partial<FleetRoom> = {}): FleetRoom {
  return {
    room: `dm-${a}-${b}`,
    memberCount: 3,
    unread: 0,
    mentions: 0,
    kind: 'dm',
    participants: { a, b, aName: a, bName: b },
    ...over,
  };
}

function renderTree(props: Partial<Parameters<typeof FleetTree>[0]> = {}) {
  return renderWithProviders(<FleetTree rooms={[]} dms={[]} {...props} />);
}

const listed = (rooms: FleetRoom[], buddies: RosterBuddy[]) =>
  listedBuddies(rooms, buddies).map(b => b.handle);

afterEach(() => {
  vi.restoreAllMocks();
});

test('an agent whose repo has no room, or no repo at all, is not listed', () => {
  expect(
    listed(
      [room('rt')],
      [buddy('max', 'rt'), buddy('gail', 'board'), buddy('shep', undefined)]
    )
  ).toEqual(['max']);
});

test("an agent counts toward its repo's room even when the names differ in case or path form", () => {
  expect(
    listed(
      [room('myrepo'), room('projects-scratch')],
      [buddy('ada', 'MyRepo'), buddy('bo', 'scratch')]
    )
  ).toEqual(['ada', 'bo']);
});

test('an agent whose basename matches two rooms needs to have joined one', () => {
  expect(
    listed(
      [room('github-api'), room('work-api')],
      [
        buddy('ada', 'api', { rooms: ['work-api'] }),
        buddy('bo', 'api', { rooms: ['github-api'] }),
        buddy('cy', 'api', { rooms: [] }),
      ]
    )
  ).toEqual(['ada', 'bo']);
});

test('rooms list first, then direct conversations under their own label and count', () => {
  renderTree({
    rooms: [room('rt'), room('boxscore')],
    dms: [dm('jay', 'max'), dm('edie', 'stan')],
  });
  const rows = screen
    .getAllByTestId(/^(room-row-|dm-row-)/)
    .map(el => el.dataset.testid);
  expect(rows).toEqual([
    'room-row-rt',
    'room-row-boxscore',
    'dm-row-dm-jay-max',
    'dm-row-dm-edie-stan',
  ]);
  expect(screen.getByRole('heading', { name: 'Direct' })).toBeInTheDocument();
  expect(screen.getByTestId('section-detail')).toHaveTextContent('2');
});

test('every DM is listed, with no overflow line', () => {
  const dms = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(n => dm(n, 'max'));
  renderTree({ dms });
  expect(screen.getAllByTestId(/^dm-row-/)).toHaveLength(7);
});

test('a DM with no participants has no row and no label', () => {
  renderTree({ dms: [room('dm-orphan', { kind: 'dm' })] });
  expect(screen.queryByTestId('dm-row-dm-orphan')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Direct' })).toBeNull();
});

test('a DM row reads the pair, and never the hashed room name', () => {
  renderTree({ dms: [dm('edie', 'stan')] });
  expect(screen.getByTestId('dm-row-dm-edie-stan')).toHaveTextContent(
    /^edie, stan$/
  );
  expect(screen.queryByText(/dm-edie/)).toBeNull();
});

test('a DM row previews its newest message on one plain line, markdown marks removed', () => {
  renderTree({
    dms: [
      dm('jay', 'max', {
        lastMessage: {
          handle: 'jay',
          name: 'jay',
          body: '**ship**  the `fix`\n# today',
        },
      }),
    ],
  });
  expect(screen.getByTestId('dm-row-dm-jay-max')).toHaveTextContent(
    'jay: ship the fix today'
  );
});

test("a preview names the viewer by the viewer's own name, then the sender's, then the id", () => {
  renderWithProviders(
    <BuddiesProvider
      buddies={[]}
      roomMembers={[]}
      me={{ handle: 'alex', name: 'Alex' }}
      now={NOW}
      reachable
    >
      <FleetTree
        rooms={[]}
        dms={[
          dm('alex', 'kai', {
            lastMessage: { handle: 'alex', name: 'alex', body: 'mine' },
          }),
          dm('jay', 'kai', {
            lastMessage: { handle: 'jay.x1', name: 'jay', body: 'named' },
          }),
          dm('sid', 'kai', {
            lastMessage: { handle: 'sid.y2', body: 'bare' },
          }),
        ]}
      />
    </BuddiesProvider>
  );
  expect(screen.getByTestId('dm-row-dm-alex-kai')).toHaveTextContent(
    'Alex: mine'
  );
  expect(screen.getByTestId('dm-row-dm-jay-kai')).toHaveTextContent(
    'jay: named'
  );
  expect(screen.getByTestId('dm-row-dm-sid-kai')).toHaveTextContent(
    'sid.y2: bare'
  );
});

test('a DM row dates its newest post: the clock today, the day otherwise', () => {
  const today = Date.now();
  const earlier = today - 10 * DAY;
  renderTree({
    dms: [
      dm('jay', 'max', { lastPostedAt: today }),
      dm('kai', 'max', { lastPostedAt: earlier }),
    ],
  });
  expect(screen.getByTestId('dm-row-dm-jay-max')).toHaveTextContent(
    localTime(today)
  );
  expect(screen.getByTestId('dm-row-dm-kai-max')).toHaveTextContent(
    dayLabel(earlier)
  );
});

test('two DMs with the same names stay two rows, each with both faces, no ids shown', () => {
  renderTree({
    dms: [
      dm('kai', 'remy', { room: 'dm-e41f7a3c68bd' }),
      dm('kai', 'remy.m2p4', {
        room: 'dm-2c9b7e41d0a5',
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
      }),
    ],
  });
  const legacy = screen.getByTestId('dm-row-dm-e41f7a3c68bd');
  const recycled = screen.getByTestId('dm-row-dm-2c9b7e41d0a5');
  expect(legacy).toHaveTextContent('kai, remy');
  expect(recycled).toHaveTextContent('kai, remy');
  expect(recycled).not.toHaveTextContent('m2p4');
  expect(legacy.querySelectorAll('img')).toHaveLength(2);
  expect(recycled.querySelectorAll('img')).toHaveLength(2);
});

test('a row opens on click and from the keyboard, room and DM alike', async () => {
  const onOpenRoom = vi.fn();
  const onOpenDm = vi.fn();
  renderTree({
    rooms: [room('rt')],
    dms: [dm('jay', 'max')],
    onOpenRoom,
    onOpenDm,
  });
  await userEvent.click(screen.getByTestId('room-row-rt'));
  expect(onOpenRoom).toHaveBeenCalledWith('rt');
  await userEvent.click(screen.getByTestId('dm-row-dm-jay-max'));
  expect(onOpenDm).toHaveBeenCalledWith('dm-jay-max');

  fireEvent.keyDown(screen.getByTestId('room-row-rt'), { key: 'Enter' });
  fireEvent.keyDown(screen.getByTestId('dm-row-dm-jay-max'), { key: ' ' });
  expect(onOpenRoom).toHaveBeenCalledTimes(2);
  expect(onOpenDm).toHaveBeenCalledTimes(2);
});

test('the open conversation carries the active mark, whichever kind it is', () => {
  renderTree({
    rooms: [room('rt')],
    dms: [dm('jay', 'max')],
    activeRoom: 'dm-jay-max',
  });
  expect(screen.getByTestId('dm-row-dm-jay-max').dataset.active).toBe('true');
  expect(screen.getByTestId('room-row-rt').dataset.active).toBeUndefined();
});

test('the right-click menu closes a room or a conversation, named for which', async () => {
  const onClose = vi.fn();
  renderTree({
    rooms: [room('rt')],
    dms: [dm('jay', 'max')],
    onClose,
  });

  fireEvent.contextMenu(screen.getByTestId('room-row-rt'));
  const roomMenu = await screen.findByTestId('room-context-rt');
  const closeRoom = within(roomMenu).getByTestId('room-context-close');
  expect(closeRoom).toHaveTextContent('Close room');
  await userEvent.click(closeRoom);
  expect(onClose).toHaveBeenCalledWith('rt');

  fireEvent.contextMenu(screen.getByTestId('dm-row-dm-jay-max'));
  const dmMenu = await screen.findByTestId('dm-context-dm-jay-max');
  const closeDm = within(dmMenu).getByTestId('room-context-close');
  expect(closeDm).toHaveTextContent('Close conversation');
  await userEvent.click(closeDm);
  expect(onClose).toHaveBeenCalledWith('dm-jay-max');
});

test('the menu copies a link to the room', async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  try {
    renderTree({ rooms: [room('a room')], onClose: vi.fn() });
    fireEvent.contextMenu(screen.getByTestId('room-row-a room'));
    await userEvent.click(await screen.findByTestId('room-context-copy'));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/r/a%20room`
      )
    );
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

test("a DM's menu offers each end's herdr pane by name, and a room's offers none", async () => {
  const focusPane = vi.fn();
  renderWithProviders(
    <BuddiesProvider
      buddies={[buddy('jay', 'rt', { pane: 'wBT:p1' }), buddy('max', 'rt')]}
      roomMembers={[]}
      now={NOW}
      reachable
      actions={{ mention: vi.fn(), dm: vi.fn(), focusPane }}
    >
      <FleetTree
        rooms={[room('rt')]}
        dms={[dm('jay', 'max')]}
        onClose={vi.fn()}
      />
    </BuddiesProvider>
  );
  fireEvent.contextMenu(screen.getByTestId('room-row-rt'));
  const roomMenu = await screen.findByTestId('room-context-rt');
  expect(within(roomMenu).queryByText('Focus pane')).toBeNull();

  fireEvent.contextMenu(screen.getByTestId('dm-row-dm-jay-max'));
  const dmMenu = await screen.findByTestId('dm-context-dm-jay-max');
  const item = within(dmMenu).getByTestId('room-context-focus-wBT:p1');
  expect(item).toHaveTextContent('jay');
  expect(
    dmMenu.querySelectorAll('[data-testid^="room-context-focus-"]')
  ).toHaveLength(1);
  await userEvent.click(item);
  expect(focusPane).toHaveBeenCalledWith('wBT:p1');
});

test('with no close handler a row has no menu', async () => {
  renderTree({ rooms: [room('rt')], dms: [dm('jay', 'max')] });
  fireEvent.contextMenu(screen.getByTestId('room-row-rt'));
  fireEvent.contextMenu(screen.getByTestId('dm-row-dm-jay-max'));
  expect(screen.queryByTestId('room-context-rt')).toBeNull();
  expect(screen.queryByTestId('dm-context-dm-jay-max')).toBeNull();
});

test('archive all closes every DM but a live Slack chat, after a confirm', async () => {
  const onClose = vi.fn();
  const dms = [
    dm('alex', 'sam', { room: 'dm-1' }),
    dm('alex', 'jo', { room: 'dm-2' }),
  ];
  renderWithProviders(
    <SlackChatsProvider chats={[{ room: 'dm-2' }]}>
      <FleetTree rooms={[]} dms={dms} onClose={onClose} />
    </SlackChatsProvider>
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Archive all direct messages' })
  );
  expect(onClose).not.toHaveBeenCalled();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Archive all' })
  );
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledWith('dm-1');
});

test('with only a live Slack chat there is nothing to archive', () => {
  const dms = [dm('alex', 'jo', { room: 'dm-2' })];
  renderWithProviders(
    <SlackChatsProvider chats={[{ room: 'dm-2' }]}>
      <FleetTree rooms={[]} dms={dms} onClose={vi.fn()} />
    </SlackChatsProvider>
  );
  expect(
    screen.queryByRole('button', { name: 'Archive all direct messages' })
  ).toBeNull();
});
