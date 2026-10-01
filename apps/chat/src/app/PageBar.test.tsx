import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import './icons';

import { BuddiesProvider } from './buddies-context';
import { PageBar, RoomMenu } from './PageBar';
import { fetchMock, installFetchMock } from './test-utils';

beforeEach(() => {
  installFetchMock();
});

afterEach(() => {
  window.localStorage.removeItem('chat-expand-all');
});

test('the members pill shows the signed-in total and opens a roster grouped by herdr state, wake mode in its header', async () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'build',
        memberCount: 3,
        unread: 0,
        mentions: 0,
        defaultWake: 'mention',
      }}
      buddies={[
        { handle: 'a', status: 'live', agentStatus: 'blocked' },
        { handle: 'b', status: 'live' },
        { handle: 'c', status: 'idle' },
        { handle: 'gitq-main', status: 'offline' },
      ]}
    />
  );
  const chip = screen.getByTestId('members-chip');
  expect(chip).toHaveAccessibleName('Members of #build: 3 signed in');
  expect(chip).toHaveTextContent('3');
  await userEvent.click(chip);
  expect(await screen.findByTestId('members-dropdown')).toHaveTextContent(
    '3 in #build'
  );
  expect(screen.getByTestId('members-wakes')).toHaveTextContent(
    'wakes: mention'
  );
  // An agent waiting on the human leads, under its own group.
  expect(screen.getByTestId('members-group-blocked')).toHaveTextContent(
    'Needs you'
  );
  expect(screen.getByTestId('members-group-working')).toBeInTheDocument();
  expect(screen.getByTestId('members-group-done')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-a')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-b')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-c')).toBeInTheDocument();
  // Signed-out members fold into one row until it is opened.
  expect(screen.queryByTestId('members-row-gitq-main')).toBeNull();
  await userEvent.click(screen.getByTestId('members-signed-out'));
  expect(screen.getByTestId('members-row-gitq-main')).toBeInTheDocument();
});

test('a card action in the members dropdown runs and closes the menu', async () => {
  const mention = vi.fn();
  const max = {
    sessionId: 's-max',
    handle: 'max',
    baseHandle: 'max',
    name: 'max',
    signedInAt: 1,
    lastSeenAt: 1,
    status: 'live' as const,
    rooms: ['rt'],
  };
  renderWithProviders(
    <BuddiesProvider
      buddies={[max]}
      roomMembers={['max']}
      now={2}
      reachable
      actions={{ mention, dm: vi.fn() }}
    >
      <PageBar
        room={{ room: 'rt', memberCount: 1, unread: 0, mentions: 0 }}
        buddies={[max]}
      />
    </BuddiesProvider>
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  await userEvent.hover(await screen.findByTestId('members-row-max'));
  await userEvent.click(
    await screen.findByTestId('card-mention-max', {}, { timeout: 2000 })
  );
  expect(mention).toHaveBeenCalledWith('max');
  await waitFor(() =>
    expect(screen.queryByTestId('members-dropdown')).toBeNull()
  );
  // The card closed with the menu, so the next open starts on the list.
  await userEvent.click(screen.getByTestId('members-chip'));
  const row = await screen.findByTestId('members-row-max');
  expect(screen.queryByTestId('detail-max')).toBeNull();
  expect(row).not.toHaveAttribute('data-menu-active');
});

test('a group past eight rows ends in "N more", which lists the rest and keeps the menu open', async () => {
  const buddies = Array.from({ length: 11 }, (_, i) => ({
    handle: `w${i}`,
    status: 'live' as const,
  }));
  renderWithProviders(
    <PageBar
      room={{ room: 'rt', memberCount: 11, unread: 0, mentions: 0 }}
      buddies={buddies}
    />
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByTestId('members-row-w7')).toBeInTheDocument();
  expect(screen.queryByTestId('members-row-w8')).toBeNull();
  const more = screen.getByTestId('members-more-working');
  expect(more).toHaveTextContent('3 more');
  await userEvent.click(more);
  expect(screen.getByTestId('members-dropdown')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-w10')).toBeInTheDocument();
  expect(screen.queryByTestId('members-more-working')).toBeNull();
});

test('an empty room reads zero on the pill, with no sprites', () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'rt', memberCount: 0, unread: 0, mentions: 0 }}
      buddies={[]}
    />
  );
  const chip = screen.getByTestId('members-chip');
  expect(chip).toHaveTextContent('0');
  expect(chip.querySelector('svg[shape-rendering="crispEdges"]')).toBeNull();
});

test("a member row's card opens beside it, and the row stays marked while it is open", async () => {
  const max = {
    sessionId: 's-max',
    handle: 'max',
    baseHandle: 'max',
    name: 'max',
    signedInAt: 1,
    lastSeenAt: 1,
    status: 'live' as const,
    rooms: ['rt'],
  };
  renderWithProviders(
    <BuddiesProvider
      buddies={[max]}
      roomMembers={['max']}
      now={2}
      reachable
      actions={{ mention: vi.fn(), dm: vi.fn() }}
    >
      <PageBar
        room={{ room: 'rt', memberCount: 1, unread: 0, mentions: 0 }}
        buddies={[max]}
      />
    </BuddiesProvider>
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  const row = await screen.findByTestId('members-row-max');
  await userEvent.hover(row);
  const card = await screen.findByTestId('detail-max', {}, { timeout: 2000 });
  await userEvent.hover(card);
  expect(row).toHaveAttribute('data-menu-active', 'true');
});

test("a member's repo shows only when it differs from the room's", async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'rt', memberCount: 2, unread: 0, mentions: 0 }}
      buddies={[
        { handle: 'home', status: 'live', repo: 'rt' },
        { handle: 'away', status: 'live', repo: 'acme-api' },
      ]}
    />
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByTestId('members-row-away')).toHaveTextContent(
    'acme-api'
  );
  expect(screen.getByTestId('members-row-home')).not.toHaveTextContent(
    /\brt\b/
  );
});

test('mark read is explicit: rendering never calls it, the control does', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 4, mentions: 0 }}
      buddies={[]}
    />
  );
  expect(fetchMock).not.toHaveBeenCalledWith(
    expect.stringContaining('/api/chat/mark'),
    expect.anything()
  );
  await userEvent.click(
    screen.getByRole('button', { name: /mark #build read/i })
  );
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/chat/mark',
    expect.objectContaining({ method: 'POST' })
  );
});

test('the roster lists a member under its status group', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      buddies={[{ handle: 'board-fix-auth', status: 'idle' }]}
    />
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByTestId('members-group-done')).toBeInTheDocument();
  expect(screen.getByTestId('members-row-board-fix-auth')).toBeInTheDocument();
});

test('daemon down: the chip reads last known and the roster withholds presence', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      buddies={[
        { handle: 'a', status: 'live' },
        { handle: 'b', status: 'idle' },
      ]}
      reachable={false}
    />
  );
  const chip = screen.getByTestId('members-chip');
  expect(chip).toHaveTextContent('last known');
  expect(chip).toHaveAccessibleName(
    'Members of #build: 2 signed in, last known'
  );
  await userEvent.click(chip);
  expect(
    await screen.findByText('presence withheld while the daemon is down')
  ).toBeInTheDocument();
  // No status groups while presence is withheld.
  expect(screen.queryByTestId('members-group-working')).toBeNull();
});

test('a DM shows the pair as its title, wakes: all in its member popover', async () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-9f3a2b1c0d4e',
        memberCount: 2,
        unread: 0,
        mentions: 0,
        kind: 'dm',
        participants: {
          a: 'deck-main',
          b: 'rt-chat-wt',
          aName: 'deck-main',
          bName: 'rt-chat-wt',
        },
      }}
      buddies={[]}
    />
  );
  expect(screen.getByText('deck-main ↔ rt-chat-wt')).toBeInTheDocument();
  // A DM uses the same members chip + roster as a channel, so wakes moves
  // into the popover header.
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByTestId('members-wakes')).toHaveTextContent(
    'wakes: all'
  );
});

test('a DM without participants shows a neutral title, never its hashed id', () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-9f3a2b1c0d4e',
        memberCount: 2,
        unread: 0,
        mentions: 0,
        kind: 'dm',
      }}
      buddies={[]}
    />
  );
  expect(screen.getByText('Direct message')).toBeInTheDocument();
  expect(screen.queryByText(/dm-9f3a2b1c0d4e/)).toBeNull();
});

test('a DM lists each end and its task in the member roster, join-order gone', async () => {
  const now = 1_700_000_000_000;
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-8c1d4e6a2f90',
        memberCount: 3,
        unread: 0,
        mentions: 0,
        kind: 'dm',
        participants: { a: 'jay', b: 'max', aName: 'jay', bName: 'max' },
      }}
      now={now}
      buddies={[
        {
          handle: 'jay',
          status: 'live',
          paneTitle: 'Boxscore mattstack integration',
        },
        { handle: 'max', status: 'idle', cwd: '/x/repo-tools', branch: 'main' },
        { handle: 'kai', status: 'offline', signedOutAt: now - 60_000 },
      ]}
    />
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByTestId('members-row-jay')).toHaveTextContent(
    'Boxscore mattstack integration'
  );
  expect(screen.getByTestId('members-row-max')).toHaveTextContent(
    'repo-tools · main'
  );
  await userEvent.click(screen.getByTestId('members-signed-out'));
  expect(screen.getByTestId('members-row-kai')).toBeInTheDocument();
  // No fanned-out task chips on the bar any more, and no join-order select.
  expect(screen.queryByTestId('chip-task-jay')).toBeNull();
  expect(screen.queryByTestId('room-order')).toBeNull();
});

test('the ⋯ menu offers Close for a channel, with no confirm', async () => {
  const onClose = vi.fn();
  renderWithProviders(
    <RoomMenu
      room={{ room: 'build', memberCount: 3, unread: 0, mentions: 0 }}
      onClose={onClose}
    />
  );
  await userEvent.click(screen.getByTestId('room-menu'));
  const item = await screen.findByTestId('room-menu-close');
  expect(item).toHaveTextContent('Close #build');
  await userEvent.click(item);
  expect(onClose).toHaveBeenCalledWith('build');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('the ⋯ menu offers Close this conversation for a DM, fleet or not', async () => {
  const onClose = vi.fn();
  const dm = {
    room: 'dm-aaaa1111bbbb',
    memberCount: 2,
    unread: 0,
    mentions: 0,
    kind: 'dm' as const,
    participants: {
      a: 'fred',
      b: 'gitq-main',
      aName: 'fred',
      bName: 'gitq-main',
    },
  };
  renderWithProviders(<RoomMenu room={dm} onClose={onClose} />);
  await userEvent.click(screen.getByTestId('room-menu'));
  const item = await screen.findByTestId('room-menu-close');
  expect(item).toHaveTextContent('Close this conversation');
  await userEvent.click(item);
  expect(onClose).toHaveBeenCalledWith('dm-aaaa1111bbbb');
});

test('a closed room still shows mark read and its wake mode; nothing says archived', async () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'retro',
        memberCount: 2,
        unread: 4,
        mentions: 1,
        archivedAt: Date.now() - 3 * 86_400_000,
      }}
      buddies={[{ handle: 'fred', status: 'live' }]}
    />
  );
  expect(screen.queryByTestId('chip-archived')).toBeNull();
  expect(screen.getByTestId('mark-read-button')).toBeInTheDocument();
  expect(screen.queryByText(/archiv/i)).toBeNull();
  await userEvent.click(screen.getByTestId('members-chip'));
  expect(await screen.findByTestId('members-wakes')).toHaveTextContent(
    'wakes: mention'
  );
});

test('add agents sits before mark read, only when wired, disabled while the daemon is down', async () => {
  const onAddAgents = vi.fn();
  const room = { room: 'build', memberCount: 2, unread: 3, mentions: 0 };
  const { rerender } = renderWithProviders(
    <PageBar room={room} buddies={[]} />
  );
  expect(screen.queryByTestId('add-agents-button')).toBeNull();
  rerender(
    <PageBar
      room={room}
      buddies={[]}
      onAddAgents={onAddAgents}
      reachable={false}
    />
  );
  expect(screen.getByTestId('add-agents-button')).toBeDisabled();
  rerender(
    <PageBar
      room={room}
      buddies={[]}
      onAddAgents={onAddAgents}
      onMarkedRead={() => {}}
    />
  );
  const buttons = screen
    .getAllByRole('button')
    .map(b => b.getAttribute('data-testid'));
  expect(buttons.indexOf('add-agents-button')).toBeLessThan(
    buttons.indexOf('mark-read-button')
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Add agents to #build' })
  );
  expect(onAddAgents).toHaveBeenCalled();
});

test('a DM title reads the pair by name, never an id', () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-2c9b7e41d0a5',
        memberCount: 3,
        unread: 0,
        mentions: 0,
        kind: 'dm',
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
      }}
      buddies={[]}
    />
  );
  expect(screen.getByText('kai ↔ remy')).toBeInTheDocument();
  expect(screen.queryByText(/m2p4/)).toBeNull();
});

test('member rows show names and stay keyed by id', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'rt', memberCount: 2, unread: 0, mentions: 0 }}
      buddies={[
        { handle: 'remy', name: 'remy', status: 'idle' },
        { handle: 'remy.m2p4', name: 'remy', status: 'live' },
      ]}
    />
  );
  await userEvent.click(screen.getByTestId('members-chip'));
  const recycled = await screen.findByTestId('members-row-remy.m2p4');
  expect(recycled).toHaveTextContent('remy');
  expect(recycled).not.toHaveTextContent('m2p4');
  expect(screen.getByTestId('members-row-remy')).toBeInTheDocument();
});

test('the expand-all toggle flips and persists the app-wide preference', async () => {
  renderWithProviders(
    <PageBar
      room={{ room: 'build', memberCount: 1, unread: 0, mentions: 0 }}
      buddies={[]}
    />
  );
  const toggle = screen.getByTestId('expand-all-toggle');
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(window.localStorage.getItem('chat-expand-all')).toBe('true');
});

const avatars = (el: HTMLElement) =>
  el.querySelectorAll('svg[shape-rendering="crispEdges"]');

test("a DM title whose pair repeats shows both ends' avatars, still by name", () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-2c9b7e41d0a5',
        memberCount: 3,
        unread: 0,
        mentions: 0,
        kind: 'dm',
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
      }}
      buddies={[]}
      withAvatars
    />
  );
  const title = screen.getByTestId('page-bar-title');
  expect(title).toHaveTextContent('kai ↔ remy');
  expect(title).not.toHaveTextContent('m2p4');
  expect(avatars(title)).toHaveLength(2);
});

test('a DM title whose pair is unique keeps the plain label, no avatars', () => {
  renderWithProviders(
    <PageBar
      room={{
        room: 'dm-2c9b7e41d0a5',
        memberCount: 3,
        unread: 0,
        mentions: 0,
        kind: 'dm',
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
      }}
      buddies={[]}
    />
  );
  const title = screen.getByTestId('page-bar-title');
  expect(title).toHaveTextContent(/^kai ↔ remy$/);
  expect(avatars(title)).toHaveLength(0);
});
