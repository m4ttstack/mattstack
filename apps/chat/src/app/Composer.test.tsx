import { createRef } from 'react';
import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { BuddiesProvider } from './buddies-context';
import { Composer, type ComposerHandle } from './Composer';
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
  expect(onOpenDm).toHaveBeenCalledWith('board-fix-auth');
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
  expect(
    recycled.querySelectorAll('svg[shape-rendering="crispEdges"]')
  ).toHaveLength(1);
  await userEvent.click(recycled);
  expect(box).toHaveValue('@remy ');
});

test('a roster pick inserts the name and a DM placeholder reads names', () => {
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
  expect(screen.getByRole('textbox')).toHaveAttribute(
    'placeholder',
    'Message matt ↔ remy (both will wake)'
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
    <Composer
      room="rt"
      roomMembers={['remy', 'remy.m2p4', 'kai']}
      buddies={[
        { handle: 'remy', name: 'remy', status: 'idle' },
        { handle: 'remy.m2p4', name: 'remy', status: 'live' },
        { handle: 'kai', name: 'kai', status: 'live' },
      ]}
    />
  );
  await userEvent.type(screen.getByRole('textbox'), '@');
  const fills = (option: HTMLElement) =>
    [...option.querySelectorAll('svg[shape-rendering="crispEdges"]')].map(svg =>
      svg.getAttribute('fill')
    );
  const legacy = await screen.findByTestId('composer-option-remy');
  const recycled = screen.getByTestId('composer-option-remy.m2p4');
  expect(fills(legacy)).toHaveLength(1);
  expect(fills(recycled)).toHaveLength(1);
  expect(fills(legacy)[0]).not.toBe(fills(recycled)[0]);
  expect(recycled).not.toHaveTextContent('m2p4');
  expect(fills(screen.getByTestId('composer-option-kai'))).toEqual([]);
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
