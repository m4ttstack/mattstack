import { createRef } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { BuddiesProvider } from './buddies-context';
import { Composer, type ComposerHandle } from './Composer';
import { SlackChatsProvider } from './slack-chats-context';
import {
  fetchMock,
  installFetchMock,
  stubTextareaScrollHeight,
} from './test-utils';

beforeEach(() => {
  installFetchMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('@ autocompletes from the roster, offers DM instead for a buddy outside the room, and never lists an offline buddy', async () => {
  renderWithProviders(
    <Composer
      room="build"
      roomMembers={['acme-dev-42', 'gitq-main']}
      buddies={[
        { handle: 'acme-dev-42', status: 'live' },
        { handle: 'gitq-main', status: 'offline' },
        { handle: 'board-fix-auth', status: 'idle' },
      ]}
    />
  );
  await userEvent.type(screen.getByRole('textbox'), '@');
  expect(await screen.findByText('acme-dev-42')).toBeInTheDocument();
  expect(screen.queryByText('gitq-main')).toBeNull();
  expect(screen.getByText(/not in #build, DM instead/)).toBeInTheDocument();
  expect(screen.getByText(/@here/)).toHaveTextContent(/wakes 2 agents/);
});

test("the mention picker reads herdr's state, an agent waiting on you first", async () => {
  renderWithProviders(
    <Composer
      room="build"
      roomMembers={['busy', 'stuck']}
      buddies={[
        { handle: 'busy', status: 'live', agentStatus: 'working' },
        { handle: 'stuck', status: 'idle', agentStatus: 'blocked' },
      ]}
    />
  );
  await userEvent.type(screen.getByRole('textbox'), '@');
  const options = await screen.findAllByTestId(
    /^composer-option-(busy|stuck)$/
  );
  expect(options.map(o => o.dataset.testid)).toEqual([
    'composer-option-stuck',
    'composer-option-busy',
  ]);
  expect(options[0]).toHaveTextContent('Waiting on you');
  expect(options[1]).toHaveTextContent('Working');
});

test('choosing DM instead hands the handle to onOpenDm, drops the @ token and keeps the draft', async () => {
  const onOpenDm = vi.fn();
  renderWithProviders(
    <Composer
      room="build"
      roomMembers={[]}
      onOpenDm={onOpenDm}
      buddies={[{ handle: 'board-fix-auth', status: 'idle' }]}
    />
  );
  await userEvent.type(
    screen.getByRole('textbox'),
    'can you take the flaky one? @'
  );
  await userEvent.click(await screen.findByText('board-fix-auth'));
  expect(onOpenDm).toHaveBeenCalledWith('board-fix-auth', expect.any(String));
  expect(screen.getByRole('textbox')).toHaveValue(
    'can you take the flaky one? '
  );
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByText(/direct message to/)).toBeNull();
});

test('a repeat roster pick focuses instead of stacking another @handle', async () => {
  const ref = createRef<ComposerHandle>();
  renderWithProviders(
    <Composer
      ref={ref}
      room="build"
      roomMembers={['kai']}
      buddies={[{ handle: 'kai', status: 'live' }]}
    />
  );
  act(() => ref.current!.insertMention('kai'));
  expect(screen.getByRole('textbox')).toHaveValue('@kai ');
  act(() => ref.current!.insertMention('kai'));
  expect(screen.getByRole('textbox')).toHaveValue('@kai ');
});

test('the composer is disabled, draft kept, while the daemon is unreachable', async () => {
  const { rerender } = renderWithProviders(
    <Composer
      room="build"
      roomMembers={[]}
      buddies={[]}
      daemonReachable={true}
    />
  );
  await userEvent.type(screen.getByRole('textbox'), 'merge it');
  rerender(
    <Composer
      room="build"
      roomMembers={[]}
      buddies={[]}
      daemonReachable={false}
    />
  );
  expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  expect(screen.getByRole('textbox')).toHaveValue('merge it');
});

test('a second send while the first is in flight does not post twice', async () => {
  // ↵ twice, or ↵ while the button tap is already in flight. The draft is
  // only cleared on success, so without a guard the second press has a body
  // and posts the same message again.
  let release: (v: Response) => void = () => {};
  fetchMock.mockImplementationOnce(
    () => new Promise<Response>(r => (release = r))
  );

  renderWithProviders(
    <Composer room="build" roomMembers={[]} buddies={[]} daemonReachable />
  );
  const box = screen.getByRole('textbox');
  await userEvent.type(box, 'ship it');

  await userEvent.click(screen.getByRole('button', { name: /send/i }));
  await userEvent.click(screen.getByRole('button', { name: /send/i }));

  const posts = fetchMock.mock.calls.filter(c =>
    String(c[0]).includes('/api/chat/post')
  );
  expect(posts).toHaveLength(1);

  release(new Response(JSON.stringify({ id: 1 })));
});

test('the compose box grows with a multi-line draft and drops back to one line after a send', async () => {
  stubTextareaScrollHeight(20);
  renderWithProviders(<Composer room="build" roomMembers={[]} buddies={[]} />);
  const box = screen.getByRole('textbox');
  expect(box).toHaveStyle({ height: '20px' });

  await userEvent.type(
    box,
    'one{Shift>}{Enter}{/Shift}two{Shift>}{Enter}{/Shift}three'
  );
  expect(box).toHaveValue('one\ntwo\nthree');
  expect(box).toHaveStyle({ height: '60px' });

  await userEvent.click(screen.getByRole('button', { name: /send/i }));
  await waitFor(() => expect(box).toHaveValue(''));
  expect(box).toHaveStyle({ height: '20px' });
});

test('a long draft scrolls inside the box instead of growing past the cap', () => {
  renderWithProviders(<Composer room="build" roomMembers={[]} buddies={[]} />);
  expect(screen.getByRole('textbox')).toHaveStyle({
    maxHeight: '40vh',
    overflowY: 'auto',
  });
});

test('the phone keeps a shorter cap so the keyboard does not swallow the box', () => {
  renderWithProviders(
    <Composer room="build" roomMembers={[]} buddies={[]} phone />
  );
  expect(screen.getByRole('textbox')).toHaveStyle({ maxHeight: '25vh' });
});

test('autocomplete matches names, never ids, and posts the picked id', async () => {
  renderWithProviders(
    <Composer
      room="rt"
      roomMembers={['remy', 'remy.m2p4']}
      buddies={[
        { handle: 'remy', name: 'remy', status: 'idle' },
        { handle: 'remy.m2p4', name: 'remy', status: 'live' },
      ]}
    />
  );
  const box = screen.getByRole('textbox');
  // `remy.` prefixes the id but not the name, so it must match nothing.
  await userEvent.type(box, '@remy.');
  expect(screen.queryByTestId('composer-option-remy.m2p4')).toBeNull();
  await userEvent.clear(box);
  await userEvent.type(box, '@re');
  const recycled = await screen.findByTestId('composer-option-remy.m2p4');
  expect(recycled).toHaveTextContent('remy');
  expect(recycled).not.toHaveTextContent('m2p4');
  expect(screen.getByTestId('composer-option-remy')).toBeInTheDocument();
  await userEvent.click(recycled);
  expect(box).toHaveValue('@remy ');
  await userEvent.type(box, 'hi{Enter}');
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/post',
      expect.objectContaining({
        body: JSON.stringify({
          room: 'rt',
          body: '@remy hi',
          mentions: ['remy.m2p4'],
        }),
      })
    )
  );
});

test('autocomplete filters, labels and counts by the name it inserts when only the directory knows it', async () => {
  renderWithProviders(
    <BuddiesProvider
      buddies={[]}
      roomMembers={['remy', 'remy.m2p4']}
      memberNames={new Map([['remy.m2p4', 'remy']])}
      now={0}
      reachable
    >
      <Composer
        room="rt"
        roomMembers={['remy', 'remy.m2p4']}
        buddies={[
          { handle: 'remy', name: 'remy', status: 'idle' },
          { handle: 'remy.m2p4', status: 'live' },
        ]}
      />
    </BuddiesProvider>
  );
  const box = screen.getByRole('textbox');
  await userEvent.type(box, '@remy.');
  expect(screen.queryByTestId('composer-option-remy.m2p4')).toBeNull();
  await userEvent.clear(box);
  await userEvent.type(box, '@remy');
  const recycled = await screen.findByTestId('composer-option-remy.m2p4');
  expect(recycled).toHaveTextContent('remy');
  expect(recycled).not.toHaveTextContent('m2p4');
  expect(recycled.querySelectorAll('img')).toHaveLength(1);
  await userEvent.click(recycled);
  expect(box).toHaveValue('@remy ');
});

test('a roster pick inserts the name, once', () => {
  const ref = createRef<ComposerHandle>();
  renderWithProviders(
    <Composer
      ref={ref}
      room="dm-2c9b7e41d0a5"
      isDm
      roomMembers={['matt', 'remy.m2p4']}
      buddies={[{ handle: 'remy.m2p4', name: 'remy', status: 'live' }]}
    />
  );
  act(() => ref.current!.insertMention('remy.m2p4'));
  expect(screen.getByRole('textbox')).toHaveValue('@remy ');
  act(() => ref.current!.insertMention('remy.m2p4'));
  expect(screen.getByRole('textbox')).toHaveValue('@remy ');
});

test('roster picks of two agents sharing a name insert both and post both ids', async () => {
  const ref = createRef<ComposerHandle>();
  renderWithProviders(
    <Composer
      ref={ref}
      room="rt"
      roomMembers={['remy', 'remy.m2p4']}
      buddies={[
        { handle: 'remy', name: 'remy', status: 'idle' },
        { handle: 'remy.m2p4', name: 'remy', status: 'live' },
      ]}
    />
  );
  const box = screen.getByRole('textbox');
  act(() => ref.current!.insertMention('remy'));
  act(() => ref.current!.insertMention('remy.m2p4'));
  expect(box).toHaveValue('@remy @remy ');
  await userEvent.type(box, '{Enter}');
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/post',
      expect.objectContaining({
        body: JSON.stringify({
          room: 'rt',
          body: '@remy @remy',
          mentions: ['remy', 'remy.m2p4'],
        }),
      })
    )
  );
});

test('options that share a name show their avatars; a unique name shows none', async () => {
  renderWithProviders(
    <BuddiesProvider
      buddies={[]}
      roomMembers={['remy', 'remy.m2p4', 'kai']}
      now={0}
      reachable
    >
      <Composer
        room="rt"
        roomMembers={['remy', 'remy.m2p4', 'kai']}
        buddies={[
          { handle: 'remy', name: 'remy', status: 'idle' },
          { handle: 'remy.m2p4', name: 'remy', status: 'live' },
          { handle: 'kai', name: 'kai', status: 'live' },
        ]}
      />
    </BuddiesProvider>
  );
  await userEvent.type(screen.getByRole('textbox'), '@');
  const faces = (option: HTMLElement) => option.querySelectorAll('img');
  const legacy = await screen.findByTestId('composer-option-remy');
  const recycled = screen.getByTestId('composer-option-remy.m2p4');
  expect(faces(legacy)).toHaveLength(1);
  expect(faces(recycled)).toHaveLength(1);
  expect(recycled).not.toHaveTextContent('m2p4');
  expect(faces(screen.getByTestId('composer-option-kai'))).toHaveLength(0);
});

test('re-picking a buddy after deleting its mention text inserts it again', async () => {
  const ref = createRef<ComposerHandle>();
  renderWithProviders(
    <Composer
      ref={ref}
      room="build"
      roomMembers={['kai']}
      buddies={[{ handle: 'kai', status: 'live' }]}
    />
  );
  const box = screen.getByRole('textbox');
  act(() => ref.current!.insertMention('kai'));
  expect(box).toHaveValue('@kai ');
  await userEvent.clear(box);
  act(() => ref.current!.insertMention('kai'));
  expect(box).toHaveValue('@kai ');
});

test('a roster pick adopts a hand-typed mention of a unique name instead of repeating it', async () => {
  const ref = createRef<ComposerHandle>();
  renderWithProviders(
    <Composer
      ref={ref}
      room="build"
      roomMembers={['kai']}
      buddies={[{ handle: 'kai', status: 'live' }]}
    />
  );
  const box = screen.getByRole('textbox');
  await userEvent.type(box, 'ping @kai{Escape} ');
  act(() => ref.current!.insertMention('kai'));
  expect(box).toHaveValue('ping @kai ');
  await userEvent.type(box, '{Enter}');
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/post',
      expect.objectContaining({
        body: JSON.stringify({
          room: 'build',
          body: 'ping @kai',
          mentions: ['kai'],
        }),
      })
    )
  );
});

test('a roster pick never adopts an @name glued to the word before it', async () => {
  const ref = createRef<ComposerHandle>();
  renderWithProviders(
    <Composer
      ref={ref}
      room="build"
      roomMembers={['team']}
      buddies={[{ handle: 'team', status: 'live' }]}
    />
  );
  const box = screen.getByRole('textbox');
  await userEvent.type(box, 'contact kai@team');
  act(() => ref.current!.insertMention('team'));
  expect(box).toHaveValue('contact kai@team @team ');
});

test("an open Slack chat's composer shows Only Claude sees this", () => {
  renderWithProviders(
    <SlackChatsProvider chats={[{ room: 'dm-slack' }]}>
      <Composer
        room="dm-slack"
        roomMembers={['alex', 'kai']}
        buddies={[]}
        isDm
      />
    </SlackChatsProvider>
  );
  expect(screen.getByText('Only Claude sees this')).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveAccessibleDescription(
    'Only Claude sees this'
  );
});

test('a normal room shows no label', () => {
  renderWithProviders(
    <SlackChatsProvider chats={[{ room: 'dm-slack' }]}>
      <Composer room="build" roomMembers={['kai']} buddies={[]} />
    </SlackChatsProvider>
  );
  expect(screen.queryByText('Only Claude sees this')).toBeNull();
});

test('a composer outside any provider shows no label', () => {
  renderWithProviders(
    <Composer room="dm-slack" roomMembers={['kai']} buddies={[]} />
  );
  expect(screen.queryByText('Only Claude sees this')).toBeNull();
});

test("a Slack chat's note names its agent when the chat says who", () => {
  renderWithProviders(
    <SlackChatsProvider chats={[{ room: 'dm-slack', agentName: 'kai' }]}>
      <Composer room="dm-slack" roomMembers={[]} buddies={[]} isDm />
    </SlackChatsProvider>
  );
  expect(screen.getByTestId('composer-slack-note')).toHaveTextContent(
    'Only kai sees this'
  );
});

test('a closed Slack chat shows when it closed beside a Resume button, and no box', () => {
  const closedAt = new Date(2026, 10, 6, 15, 22).getTime();
  renderWithProviders(
    <SlackChatsProvider chats={[{ id: 7, room: 'dm-slack', closedAt }]}>
      <Composer room="dm-slack" roomMembers={[]} buddies={[]} isDm />
    </SlackChatsProvider>
  );
  expect(screen.getByTestId('composer-ended')).toHaveTextContent(
    /^Chat closed .+Resume$/
  );
  expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
});

test('an open Slack chat has no Resume button', () => {
  renderWithProviders(
    <SlackChatsProvider chats={[{ id: 7, room: 'dm-slack' }]}>
      <Composer room="dm-slack" roomMembers={[]} buddies={[]} isDm />
    </SlackChatsProvider>
  );
  expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  expect(screen.getByRole('textbox')).toBeInTheDocument();
});

test('Resume asks the server to reopen that chat, then reads the chats again', async () => {
  const refresh = vi.fn();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ conversation: 8, room: 'dm-slack' }))
  );
  renderWithProviders(
    <SlackChatsProvider
      chats={[{ id: 7, room: 'dm-slack', closedAt: 5 }]}
      refresh={refresh}
    >
      <Composer room="dm-slack" roomMembers={[]} buddies={[]} isDm />
    </SlackChatsProvider>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  expect(url).toBe('/api/chat/slack-resume');
  expect(JSON.parse(init.body)).toEqual({ conversation: 7 });
});

test('a refused Resume leaves the chat closed and says why', async () => {
  const refresh = vi.fn();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: 'no folder for this repo' }), {
      status: 502,
    })
  );
  renderWithProviders(
    <SlackChatsProvider
      chats={[{ id: 7, room: 'dm-slack', closedAt: 5 }]}
      refresh={refresh}
    >
      <Composer room="dm-slack" roomMembers={[]} buddies={[]} isDm />
    </SlackChatsProvider>
  );
  await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
  );
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByTestId('composer-ended')).toBeInTheDocument();
});

test('a Slack chat that is still opening waits instead of taking a message', () => {
  renderWithProviders(
    <SlackChatsProvider chats={[{ id: 7, room: 'dm-slack' }]}>
      <Composer room="dm-slack" roomMembers={[]} buddies={[]} isDm opening />
    </SlackChatsProvider>
  );
  expect(screen.getByTestId('composer-opening')).toHaveTextContent(
    'Chat is opening'
  );
  expect(screen.queryByRole('textbox')).toBeNull();
});

test('every room reads the same Message placeholder, DM or not', () => {
  const { rerender } = renderWithProviders(
    <Composer room="dm-1" roomMembers={['kai', 'remy']} buddies={[]} isDm />
  );
  expect(screen.getByRole('textbox')).toHaveAttribute(
    'placeholder',
    'Message…'
  );
  rerender(<Composer room="build" roomMembers={['kai']} buddies={[]} />);
  expect(screen.getByRole('textbox')).toHaveAttribute(
    'placeholder',
    'Message…'
  );
});
