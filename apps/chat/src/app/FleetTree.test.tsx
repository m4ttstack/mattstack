import { renderWithProviders } from '@mattstack/app-kit/test-utils';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import './icons';

import { FleetTree, type FleetRoom } from './FleetTree';
import type { RosterBuddy } from './roster-types';

const NOW = 1_700_000_000_000;
const M = 60_000;
const H = 60 * M;

/** design/build.py's FLEET table, one row at a time. `signedInAt` counts up
    with the argument order, so a test's own listing IS sign-in order. */
let signIn = 0;
function buddy(
  handle: string,
  repo: string,
  over: Partial<RosterBuddy> = {}
): RosterBuddy {
  signIn += 1;
  return {
    sessionId: `s-${handle}`,
    handle,
    baseHandle: handle,
    name: handle,
    repo,
    branch: 'main',
    cwd: `/Users/matt/Documents/GitHub/${repo}`,
    signedInAt: signIn,
    lastSeenAt: NOW - 12_000,
    status: 'live',
    rooms: [repo],
    ...over,
  };
}

function offline(handle: string, repo: string, agoMs: number): RosterBuddy {
  return buddy(handle, repo, { status: 'offline', signedOutAt: NOW - agoMs });
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
  return renderWithProviders(
    <FleetTree rooms={[]} dms={[]} buddies={[]} now={NOW} {...props} />
  );
}

test('every agent sits under the repo room it works in, in sign-in order', () => {
  renderTree({
    rooms: [room('rt'), room('boxscore')],
    buddies: [
      buddy('max', 'rt', { paneTitle: 'max', pane: 'wAR:p3' }),
      buddy('jay', 'boxscore', {
        paneTitle: 'Boxscore mattstack integration',
        pane: 'wBT:p1',
        branch: 'feat/metrics-hardening',
      }),
      buddy('remy', 'rt', { status: 'idle', pane: 'wAM:pF' }),
    ],
  });

  // The tree is one flat DOM list, so "under" is a claim about ORDER: the rt
  // room row, then its two members, then the next room.
  const rows = screen
    .getAllByTestId(/^(room-row-|ws-(?!doing|handle))/)
    .map(el => el.dataset.testid);
  expect(rows).toEqual([
    'room-row-rt',
    'ws-max',
    'ws-remy',
    'room-row-boxscore',
    'ws-jay',
  ]);
  expect(screen.getByTestId('ws-jay')).toHaveTextContent(
    'Boxscore mattstack integration'
  );
});

test('an agent whose repo has no room, or no repo at all, is not listed', () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [
      buddy('max', 'rt'),
      buddy('gail', 'board'),
      buddy('shep', 'rt', { repo: undefined }),
    ],
  });

  expect(screen.getByTestId('ws-max')).toBeInTheDocument();
  expect(screen.queryByTestId('ws-gail')).toBeNull();
  expect(screen.queryByTestId('ws-shep')).toBeNull();
});

test("an agent is listed under its repo's room even when the names differ in case or path form", () => {
  renderTree({
    rooms: [room('myrepo'), room('projects-scratch')],
    buddies: [buddy('ada', 'MyRepo'), buddy('bo', 'scratch')],
  });
  const rows = screen
    .getAllByTestId(/^(room-row-|ws-(?!doing|handle))/)
    .map(el => el.dataset.testid);
  expect(rows).toEqual([
    'room-row-myrepo',
    'ws-ada',
    'room-row-projects-scratch',
    'ws-bo',
  ]);
});

test('two local repos sharing a basename each keep their own room, by the room the agent joined', () => {
  renderTree({
    rooms: [room('github-api'), room('work-api')],
    buddies: [
      buddy('ada', 'api', { rooms: ['work-api'] }),
      buddy('bo', 'api', { rooms: ['github-api'] }),
      buddy('cy', 'api', { rooms: [] }),
    ],
  });
  const rows = screen
    .getAllByTestId(/^(room-row-|ws-(?!doing|handle))/)
    .map(el => el.dataset.testid);
  // cy matches both rooms and joined neither, so it is not guessed into one.
  expect(rows).toEqual([
    'room-row-github-api',
    'ws-bo',
    'room-row-work-api',
    'ws-ada',
  ]);
});

test("a repo's signed-out members collapse into one line naming them", () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [
      buddy('max', 'rt'),
      offline('kai', 'rt', 16 * H),
      offline('ida', 'rt', 15 * H),
      offline('jax', 'rt', 23 * H),
      offline('sid', 'rt', 23 * H),
      offline('elsa', 'rt', 20 * H),
      offline('wren', 'rt', 20 * H),
    ],
  });

  expect(screen.getByTestId('offline-rt')).toHaveTextContent(
    '6 signed out · kai ida jax sid elsa wren'
  );
  // Collapsed means collapsed: no row of their own.
  expect(screen.queryByTestId('ws-kai')).toBeNull();
});

test('a lone signed-out member keeps its name and its age', () => {
  renderTree({
    rooms: [room('board')],
    buddies: [offline('gail', 'board', 3 * M)],
  });
  expect(screen.getByTestId('offline-board')).toHaveTextContent(
    'gail · signed out 3m ago'
  );
});

test('a DM row is one line: the pair, no subtitle', () => {
  renderTree({
    dms: [dm('jay', 'max')],
    buddies: [
      buddy('jay', 'boxscore', {
        paneTitle: 'Boxscore mattstack integration',
      }),
      buddy('max', 'repo-tools', { paneTitle: 'max' }),
    ],
  });
  expect(screen.getByTestId('dm-row-dm-jay-max')).toHaveTextContent(
    'jay ↔ max'
  );
  // The old preview line (a repo/task/last-message summary) is gone: it added
  // height that shifted on hover and carried nothing the pair did not.
  expect(screen.queryByTestId('dm-doing-dm-jay-max')).toBeNull();
});

test('the hashed DM room name is never rendered, only the pair', () => {
  renderTree({ dms: [dm('edie', 'stan')], buddies: [] });
  expect(screen.getByTestId('dm-row-dm-edie-stan')).toHaveTextContent(
    'edie ↔ stan'
  );
  expect(screen.queryByText(/dm-edie/)).toBeNull();
});

test('DMs cap at four and the rest collapse into an expandable line', async () => {
  renderTree({
    dms: [
      dm('max', 'stan'),
      dm('jay', 'max'),
      dm('edie', 'stan'),
      dm('kai', 'remy'),
      dm('kai', 'max', { unread: 1 }),
      dm('max', 'wren', { unread: 8 }),
      dm('gail', 'max', { unread: 6 }),
    ],
    buddies: [],
  });

  expect(screen.getAllByTestId(/^dm-row-/)).toHaveLength(4);
  const more = screen.getByTestId('dm-more');
  expect(more).toHaveTextContent(
    '3 more · kai ↔ max 1, max ↔ wren 8, gail ↔ max 6'
  );
  expect(more).toHaveAttribute('aria-expanded', 'false');
  // Not the inert offline roll-up: this one is the only way to those three.
  expect(more.tagName).toBe('BUTTON');
  expect(more.style.cursor).toBe('pointer');

  await userEvent.click(more);
  expect(screen.getAllByTestId(/^dm-row-/)).toHaveLength(7);
  expect(screen.getByTestId('dm-more')).toHaveTextContent('show fewer');

  await userEvent.click(screen.getByTestId('dm-more'));
  expect(screen.getAllByTestId(/^dm-row-/)).toHaveLength(4);
});

test('the collapse never hides the open conversation', () => {
  renderTree({
    dms: [
      dm('max', 'stan'),
      dm('jay', 'max'),
      dm('edie', 'stan'),
      dm('kai', 'remy'),
      dm('gail', 'max'),
    ],
    activeRoom: 'dm-gail-max',
    buddies: [],
  });

  // Still four rows: the active one displaces the last, rather than adding a
  // fifth past the drawn cap.
  const shown = screen.getAllByTestId(/^dm-row-/).map(el => el.dataset.testid);
  expect(shown).toEqual([
    'dm-row-dm-max-stan',
    'dm-row-dm-jay-max',
    'dm-row-dm-edie-stan',
    'dm-row-dm-gail-max',
  ]);
  expect(screen.getByTestId('dm-more')).toHaveTextContent(
    '1 more · kai ↔ remy'
  );
});

test('four or fewer DMs render no overflow control at all', () => {
  renderTree({ dms: [dm('max', 'stan'), dm('jay', 'max')], buddies: [] });
  expect(screen.queryByTestId('dm-more')).toBeNull();
});

test('every tree row label sits on the meta step', () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [buddy('max', 'rt'), buddy('gail', 'board')],
  });
  // The handle and its task line share one type step.
  expect(screen.getByTestId('ws-handle-max').style.fontSize).toBe(
    'var(--mantine-font-size-xs)'
  );
  expect(screen.getByTestId('ws-doing-max').style.fontSize).toBe(
    'var(--mantine-font-size-xs)'
  );
});

test('clicking a workstream focuses its pane', async () => {
  const onFocusPane = vi.fn();
  renderTree({
    rooms: [room('boxscore')],
    buddies: [buddy('jay', 'boxscore', { pane: 'wBT:p1' })],
    onFocusPane,
  });
  await userEvent.click(screen.getByTestId('ws-jay'));
  expect(onFocusPane).toHaveBeenCalledWith('wBT:p1');
});

test('onSelectBuddy wins over onFocusPane: the phone drawer opens a DM, not a pane', async () => {
  const onFocusPane = vi.fn();
  const onSelectBuddy = vi.fn();
  renderTree({
    rooms: [room('boxscore')],
    buddies: [buddy('jay', 'boxscore', { pane: 'wBT:p1' })],
    onFocusPane,
    onSelectBuddy,
  });
  await userEvent.click(screen.getByTestId('ws-jay'));
  expect(onSelectBuddy).toHaveBeenCalledWith('jay');
  expect(onFocusPane).not.toHaveBeenCalled();
});

test('a workstream with no pane is not a target', () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [buddy('max', 'rt')],
    onFocusPane: vi.fn(),
  });
  const row = screen.getByTestId('ws-max');
  expect(row.tagName).toBe('DIV');
  expect(row.style.cursor).toBe('default');
});

test('a pane row focuses on click with no hint text eating the task line', () => {
  renderTree({
    rooms: [room('boxscore')],
    buddies: [
      buddy('jay', 'boxscore', {
        pane: 'wBT:p1',
        paneTitle: 'Boxscore mattstack integration',
      }),
    ],
    onFocusPane: vi.fn(),
  });
  const row = screen.getByTestId('ws-jay');
  expect(row).toHaveAccessibleName("Focus jay's pane");
  expect(row).not.toHaveTextContent(/focus pane/i);
  expect(screen.getByTestId('ws-doing-jay')).toHaveTextContent(
    'Boxscore mattstack integration'
  );
});

test('hovering a desktop row docks the agent card; a phone row never opens one', async () => {
  const jay = buddy('jay', 'boxscore', { pane: 'wBT:p1' });
  const { unmount } = renderTree({
    rooms: [room('boxscore')],
    buddies: [jay],
    onFocusPane: vi.fn(),
  });
  await userEvent.hover(screen.getByTestId('ws-jay'));
  const card = await screen.findByTestId('detail-jay', {}, { timeout: 2000 });
  // Moving onto the card keeps the row marked, so it stays clear which
  // agent the card describes.
  await userEvent.hover(card);
  expect(screen.getByTestId('ws-jay')).toHaveAttribute('aria-expanded', 'true');
  unmount();

  renderTree({
    rooms: [room('boxscore')],
    buddies: [jay],
    onSelectBuddy: vi.fn(),
  });
  await userEvent.hover(screen.getByTestId('ws-jay'));
  await new Promise(r => setTimeout(r, 800));
  expect(screen.queryByTestId('detail-jay')).toBeNull();
});

test("a row's dot reads herdr's state: an agent blocked on the human goes red", () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [
      buddy('max', 'rt', { agentStatus: 'blocked' }),
      buddy('remy', 'rt', { agentStatus: 'done' }),
    ],
  });
  expect(screen.getByTestId('dot-max')).toHaveAttribute(
    'data-state',
    'blocked'
  );
  expect(screen.getByTestId('dot-remy')).toHaveAttribute('data-state', 'done');
});

test('rooms and DMs both close, by hover × and by right-click menu', async () => {
  const onClose = vi.fn();
  const onMarkRead = vi.fn();
  const onOpenRoom = vi.fn();
  renderTree({
    rooms: [room('rt', { unread: 3 })],
    dms: [dm('jay', 'max', { unread: 2 })],
    buddies: [],
    onClose,
    onMarkRead,
    onOpenRoom,
  });

  const dmClose = screen.getByTestId('dm-close-dm-jay-max');
  expect(dmClose).toHaveAttribute('aria-label', 'Close jay ↔ max');
  expect(dmClose).not.toHaveStyle({ display: 'none' });
  await userEvent.click(dmClose);
  expect(onClose).toHaveBeenCalledWith('dm-jay-max');
  expect(onOpenRoom).not.toHaveBeenCalled();

  expect(screen.getByTestId('room-close-rt')).toHaveAttribute(
    'aria-label',
    'Close #rt'
  );

  fireEvent.contextMenu(screen.getByTestId('dm-row-dm-jay-max'));
  const menu = await screen.findByTestId('dm-context-dm-jay-max');
  expect(menu).toHaveTextContent('jay ↔ max');
  expect(within(menu).getByTestId('room-context-mark-read')).toHaveTextContent(
    '2'
  );
  await userEvent.click(within(menu).getByTestId('room-context-mark-read'));
  expect(onMarkRead).toHaveBeenCalledWith('dm-jay-max');
});

test('two DM rows with kai stay distinct, read kai ↔ remy, and show different avatars', () => {
  renderTree({
    dms: [
      dm('kai', 'remy', { room: 'dm-e41f7a3c68bd' }),
      dm('kai', 'remy.m2p4', {
        room: 'dm-2c9b7e41d0a5',
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
      }),
      dm('jay', 'max'),
    ],
    buddies: [],
  });
  const legacy = screen.getByTestId('dm-row-dm-e41f7a3c68bd');
  const recycled = screen.getByTestId('dm-row-dm-2c9b7e41d0a5');
  expect(legacy).toHaveTextContent('kai ↔ remy');
  expect(recycled).toHaveTextContent('kai ↔ remy');
  expect(recycled).not.toHaveTextContent('m2p4');
  const fills = (row: HTMLElement) =>
    [...row.querySelectorAll('svg[shape-rendering="crispEdges"]')].map(svg =>
      svg.getAttribute('fill')
    );
  expect(fills(legacy)).toHaveLength(2);
  expect(fills(legacy)[0]).toBe(fills(recycled)[0]);
  expect(fills(legacy)[1]).not.toBe(fills(recycled)[1]);
  expect(fills(screen.getByTestId('dm-row-dm-jay-max'))).toEqual([]);
});

test('workstream and offline rows show names; the overflow line reads pairs by name', async () => {
  renderTree({
    rooms: [room('rt')],
    buddies: [
      buddy('remy.m2p4', 'rt', { name: 'remy', baseHandle: 'remy' }),
      buddy('kai.x9z1', 'rt', {
        name: 'kai',
        baseHandle: 'kai',
        status: 'offline',
        signedOutAt: NOW - 5 * M,
      }),
    ],
    dms: [
      dm('max', 'stan'),
      dm('jay', 'max'),
      dm('edie', 'stan'),
      dm('kai', 'max'),
      dm('kai', 'remy.m2p4', {
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
        unread: 2,
      }),
    ],
  });
  expect(screen.getByTestId('ws-remy.m2p4')).toHaveTextContent('remy');
  expect(screen.getByTestId('ws-remy.m2p4')).not.toHaveTextContent('m2p4');
  expect(screen.getByTestId('offline-rt')).toHaveTextContent('kai · ');
  expect(screen.getByTestId('offline-rt')).not.toHaveTextContent('x9z1');
  expect(screen.getByTestId('dm-more')).toHaveTextContent(
    '1 more · kai ↔ remy 2'
  );
});

test("the overflow line carries each hidden pair's unread as the rows' badge, not trailing text", () => {
  renderTree({
    dms: [
      dm('max', 'stan'),
      dm('jay', 'max'),
      dm('edie', 'stan'),
      dm('kai', 'max'),
      dm('kai', 'remy.m2p4', {
        participants: { a: 'kai', b: 'remy.m2p4', aName: 'kai', bName: 'remy' },
        unread: 2,
      }),
      dm('kai', 'wren'),
    ],
  });
  const more = screen.getByTestId('dm-more');
  const badges = within(more).getAllByTestId('unread-badge');
  expect(badges).toHaveLength(1);
  expect(badges[0]).toHaveTextContent(/^2$/);
  expect(badges[0]).toHaveAttribute('aria-label', '2 unread');
  expect(within(more).queryByText(/remy 2/)).toBeNull();
  expect(more).toHaveTextContent('2 more · kai ↔ remy 2, kai ↔ wren');
});

test('the daemon down withholds every presence claim in the tree', () => {
  renderTree({
    rooms: [room('rt')],
    dms: [dm('jay', 'max')],
    buddies: [
      buddy('max', 'rt', { pane: 'wAR:p3' }),
      buddy('jay', 'boxscore', { paneTitle: 'Boxscore mattstack integration' }),
    ],
    daemonReachable: false,
  });

  expect(screen.getByTestId('ws-doing-max')).toHaveTextContent(
    'presence withheld'
  );
  // The dot goes hollow, the signed-out treatment, claiming no state.
  expect(screen.getByTestId('dot-max')).toHaveAttribute(
    'data-state',
    'offline'
  );
  // No pane title leaks anywhere while the daemon is down.
  expect(screen.queryByText(/Boxscore mattstack integration/)).toBeNull();
});

test('workstream rows that share a name show avatars and an ordinal in render order; a unique name gets neither', async () => {
  const onFocusPane = vi.fn();
  const buddies = [
    buddy('remy.m2p4', 'boxscore', {
      name: 'remy',
      baseHandle: 'remy',
      pane: 'wBT:p2',
    }),
    buddy('remy', 'rt', { pane: 'wAR:p1' }),
    buddy('kai', 'rt', { pane: 'wAR:p2' }),
  ];
  const { unmount } = renderTree({
    rooms: [room('rt'), room('boxscore')],
    buddies,
    onFocusPane,
  });
  const avatars = (el: HTMLElement) =>
    el.querySelectorAll('svg[shape-rendering="crispEdges"]').length;

  // rt renders before boxscore, so the legacy remy is first even though the
  // recycled one signed in earlier.
  expect(screen.getByTestId('ws-remy')).toHaveAttribute(
    'aria-label',
    "Focus remy (1 of 2)'s pane"
  );
  expect(screen.getByTestId('ws-remy.m2p4')).toHaveAttribute(
    'aria-label',
    "Focus remy (2 of 2)'s pane"
  );
  expect(avatars(screen.getByTestId('ws-remy'))).toBe(1);
  expect(avatars(screen.getByTestId('ws-remy.m2p4'))).toBe(1);
  expect(screen.getByTestId('ws-kai')).toHaveAttribute(
    'aria-label',
    "Focus kai's pane"
  );
  expect(avatars(screen.getByTestId('ws-kai'))).toBe(0);

  const noIds = () => {
    expect(document.body.textContent).not.toContain('m2p4');
    for (const el of document.body.querySelectorAll('[aria-label]'))
      expect(el.getAttribute('aria-label')).not.toContain('m2p4');
  };
  noIds();
  unmount();

  renderTree({
    rooms: [room('rt'), room('boxscore')],
    buddies,
    onSelectBuddy: vi.fn(),
  });
  expect(screen.getByTestId('ws-remy')).toHaveAttribute(
    'aria-label',
    'Message remy (1 of 2)'
  );
  expect(screen.getByTestId('ws-remy.m2p4')).toHaveAttribute(
    'aria-label',
    'Message remy (2 of 2)'
  );
  expect(screen.getByTestId('ws-kai')).toHaveAttribute(
    'aria-label',
    'Message kai'
  );
  noIds();
});
