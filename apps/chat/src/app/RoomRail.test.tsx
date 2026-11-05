import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import './icons';

import { RoomRail } from './RoomRail';

test('DM rooms sit in a direct section and are named by their pair, never the hash', () => {
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        {
          room: 'dm-9f3a2b1c0d4e',
          memberCount: 3,
          unread: 1,
          mentions: 1,
          kind: 'dm',
          participants: {
            a: 'deck-main',
            b: 'rt-chat-wt',
            aName: 'deck-main',
            bName: 'rt-chat-wt',
          },
        },
      ]}
    />
  );
  expect(screen.getByRole('heading', { name: /direct/i })).toBeInTheDocument();
  expect(screen.getByTestId('dm-row-dm-9f3a2b1c0d4e')).toHaveTextContent(
    'deck-main, rt-chat-wt'
  );
  expect(screen.queryByText(/dm-9f3a/)).toBeNull();
});

test('a DM room with no participants renders nowhere, hashed id included', () => {
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        {
          room: 'dm-orphaned-hash',
          memberCount: 0,
          unread: 1,
          mentions: 0,
          kind: 'dm',
        },
      ]}
    />
  );
  expect(screen.queryByTestId('dm-row-dm-orphaned-hash')).toBeNull();
  expect(screen.queryByTestId('room-row-dm-orphaned-hash')).toBeNull();
  expect(screen.queryByText(/dm-orphaned-hash/)).toBeNull();
});

test('the active room carries the accent wash, and clicking a row selects it', () => {
  const onSelectRoom = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 3, unread: 0, mentions: 0 },
        { room: 'repo-tools', memberCount: 2, unread: 0, mentions: 0 },
      ]}
      activeRoom="build"
      onSelectRoom={onSelectRoom}
    />
  );
  expect(screen.getByTestId('room-row-build').dataset.active).toBe('true');
  expect(
    screen.getByTestId('room-row-repo-tools').dataset.active
  ).toBeUndefined();

  screen.getByTestId('room-row-repo-tools').click();
  expect(onSelectRoom).toHaveBeenCalledWith('repo-tools');
});

test('no DM rooms means no direct section at all', () => {
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }]}
    />
  );
  expect(screen.queryByRole('heading', { name: /direct/i })).toBeNull();
});

test('no ARCHIVED section renders, and a closed room passed in is listed like any other', () => {
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 2, unread: 1, mentions: 0 },
        {
          room: 'retro',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          archivedAt: 5,
        },
      ]}
      activeRoom="retro"
    />
  );
  expect(screen.queryByText('ARCHIVED')).toBeNull();
  expect(screen.queryByTestId('archived-toggle')).toBeNull();
  expect(screen.getByTestId('room-row-retro').dataset.active).toBe('true');
  expect(screen.getByTestId('room-row-retro').style.opacity).toBe('');
});

test('a left click selects the row and never opens its menu', async () => {
  const onCloseRoom = vi.fn();
  const onSelectRoom = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }]}
      onCloseRoom={onCloseRoom}
      onSelectRoom={onSelectRoom}
    />
  );
  const row = screen.getByTestId('room-row-build');
  await userEvent.click(row);
  expect(onSelectRoom).toHaveBeenCalledWith('build');
  expect(screen.queryByTestId('room-context-build')).toBeNull();

  fireEvent.contextMenu(row);
  expect(await screen.findByTestId('room-context-build')).toBeInTheDocument();
});

test('right-click opens a menu for that row, and Close closes that row', async () => {
  const onCloseRoom = vi.fn();
  const onSelectRoom = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[
        { room: 'build', memberCount: 2, unread: 0, mentions: 0 },
        { room: 'quiet', memberCount: 2, unread: 0, mentions: 0 },
      ]}
      onCloseRoom={onCloseRoom}
      onSelectRoom={onSelectRoom}
    />
  );
  fireEvent.contextMenu(screen.getByTestId('room-row-quiet'));
  const quiet = await screen.findByTestId('room-context-quiet');
  await userEvent.click(within(quiet).getByTestId('room-context-close'));
  expect(onCloseRoom).toHaveBeenCalledWith('quiet');
  expect(onSelectRoom).not.toHaveBeenCalled();
});

test('without onCloseRoom right-click does nothing', () => {
  renderWithProviders(
    <RoomRail
      rooms={[{ room: 'build', memberCount: 2, unread: 0, mentions: 0 }]}
    />
  );
  fireEvent.contextMenu(screen.getByTestId('room-row-build'));
  expect(screen.queryByTestId('room-context-build')).toBeNull();
});

test('the header names the rooms and counts who is working, and withholds the count when the daemon is down', () => {
  const buddies = [
    {
      sessionId: 's-max',
      handle: 'max',
      baseHandle: 'max',
      name: 'max',
      repo: 'rt',
      signedInAt: 1,
      lastSeenAt: 2,
      status: 'live' as const,
      rooms: ['rt'],
    },
    {
      sessionId: 's-kai',
      handle: 'kai',
      baseHandle: 'kai',
      name: 'kai',
      repo: 'rt',
      signedInAt: 2,
      lastSeenAt: 3,
      signedOutAt: 3,
      status: 'offline' as const,
      rooms: ['rt'],
    },
  ];
  const rooms = [{ room: 'rt', memberCount: 2, unread: 0, mentions: 0 }];
  const roomless = {
    ...buddies[0]!,
    sessionId: 's-gail',
    handle: 'gail',
    name: 'gail',
    repo: 'board',
  };
  const { rerender } = renderWithProviders(
    <RoomRail rooms={rooms} buddies={[...buddies, roomless]} />
  );
  expect(screen.getByRole('heading', { name: 'Rooms' })).toBeInTheDocument();
  // An agent with no repo room and a signed-out agent do not count.
  expect(screen.getByTestId('section-detail')).toHaveTextContent('1 working');

  rerender(
    <RoomRail rooms={rooms} buddies={buddies} daemonReachable={false} />
  );
  expect(screen.getByTestId('section-detail')).toHaveTextContent('last known');
});

test('DMs read newest post first, one with no post last', () => {
  const pair = { a: 'kai', b: 'max', aName: 'kai', bName: 'max' };
  const direct = (room: string, lastPostedAt?: number) => ({
    room,
    memberCount: 2,
    unread: 0,
    mentions: 0,
    kind: 'dm' as const,
    participants: pair,
    lastPostedAt,
  });
  renderWithProviders(
    <RoomRail
      rooms={[direct('dm-old', 10), direct('dm-none'), direct('dm-new', 20)]}
    />
  );
  expect(
    screen.getAllByTestId(/^dm-row-/).map(row => row.dataset.testid)
  ).toEqual(['dm-row-dm-new', 'dm-row-dm-old', 'dm-row-dm-none']);
});

test('Messages to you sits above the rooms, takes the human’s DMs out of Direct and counts them', async () => {
  const onOpen = vi.fn();
  renderWithProviders(
    <RoomRail
      rooms={[
        {
          room: 'dm-mine',
          memberCount: 2,
          unread: 2,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'kai', b: 'matt', aName: 'kai', bName: 'matt' },
        },
        {
          room: 'dm-theirs',
          memberCount: 2,
          unread: 0,
          mentions: 0,
          kind: 'dm',
          participants: { a: 'kai', b: 'remy', aName: 'kai', bName: 'remy' },
        },
      ]}
      direct={{
        active: false,
        waiting: 2,
        onOpen,
        isMine: r => r.room === 'dm-mine',
      }}
    />
  );
  const row = screen.getByTestId('direct-row');
  expect(row).toHaveTextContent('Messages to you');
  expect(row).toHaveTextContent('2');
  expect(screen.queryByTestId('dm-row-dm-mine')).toBeNull();
  expect(screen.getByTestId('dm-row-dm-theirs')).toBeInTheDocument();
  await userEvent.click(row);
  expect(onOpen).toHaveBeenCalled();
});
