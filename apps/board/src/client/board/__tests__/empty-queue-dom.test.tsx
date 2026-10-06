/** DOM-level test for the board's toolbar, Also show line, turn summary and
    empty-queue copy: a real happy-dom document and a real Board render. The
    Show picks persist across tabs, including Needs me, so an empty view they
    caused has to say so rather than read as "this queue has no work". */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  afterAll,
  beforeAll,
  beforeEach,
  expect,
  setSystemTime,
  test,
} from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

// Frozen for the whole suite (via setSystemTime in beforeAll below) so every
// fixture built from Date.now() -- module-level BOARD_DATA included, since
// it evaluates before any hook runs -- lands at the same instant the board's
// own freshness math reads at render time.
const NOW = Date.now();

class FakeEventSource {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  close(): void {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BOARD_DATA = {
  title: 'MRs ready for review',
  defaultMember: 'robin-example',
  members: [{ username: 'robin-example', name: 'Robin Example', count: 0 }],
  allMembers: [
    {
      username: 'robin-example',
      name: 'Robin Example',
      hidden: false,
      count: 0,
    },
  ],
  mrs: [],
  fetchedAt: 1755600000000,
  fetchError: null,
  local: true,
  slackEnabled: true,
  slackTemplates: {
    single: '{title}: {url}',
    multiHeader: '{count} ready',
    multiItem: '- {title}',
  },
  // Always "now": a fixed past timestamp drifts stale over time, which
  // fires the freshness banner and, in turn, suppresses the empty-queue
  // check mark these tests assert on.
  dataSyncedAt: NOW,
  scopeUncovered: [],
  scopeUncoveredSections: [],
  scopeKnownSections: null,
  scopeWindowDays: null,
  staleAfterDays: 90,
  canInvite: false,
  peering: null,
  tabs: [{ id: 'team', label: 'Team', source: { kind: 'authors' } }],
};

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;

const realFetch = globalThis.fetch;
let servedData: Record<string, unknown> = BOARD_DATA;
let posts: string[] = [];
let dataLoads = 0;

const TURN_DEF = {
  key: 'board.turn',
  type: 'object',
  scopes: ['user'],
  merge: 'replace',
  secret: false,
  teamLocked: false,
  repoScoped: false,
  writable: true,
  description: 'whose turn',
  hasDefault: false,
  effective: { scope: null, value: undefined },
};

function needsMeMr(iid: number) {
  return {
    iid,
    title: `mr ${iid}`,
    webUrl: `https://gitlab.example.com/g/p/-/merge_requests/${iid}`,
    author: { username: 'robin-example', name: 'Robin Example' },
    sourceBranch: `b${iid}`,
    targetBranch: 'main',
    updatedAt: '2026-08-19T00:00:00Z',
    createdAt: '2026-08-19T00:00:00Z',
    reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
    blockers: { any: true, hasConflicts: true },
    mergeButton: { visible: false, disabled: false, loading: false },
    autoMergeButton: { visible: false, isActive: false },
    reviewerComments: 0,
    unresolvedThreads: 0,
    isDraft: false,
    pipelineState: 'none',
    repositoryId: `gitlab:${iid}`,
    rtRepo: null,
    codeownerSections: [],
    gates: [],
    slack: { posted: false },
  };
}

beforeAll(async () => {
  setSystemTime(NOW);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (init?.method === 'POST') posts.push(url);
    if (url.startsWith('/data.json')) {
      dataLoads += 1;
      return new Response(JSON.stringify(servedData), { status: 200 });
    }
    if (url.startsWith('/api/settings/defs')) {
      return new Response(JSON.stringify({ defs: [TURN_DEF] }), {
        status: 200,
      });
    }
    if (url.startsWith('/api/settings/explain/')) {
      return new Response(JSON.stringify({ def: null, rows: [] }), {
        status: 200,
      });
    }
    if (url === '/api/settings/set') {
      const { value } = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ effective: { scope: 'user', value } }),
        { status: 200 }
      );
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  servedData = BOARD_DATA;
  posts = [];
  dataLoads = 0;
  localStorage.clear();
  history.replaceState(null, '', '/');
});

afterAll(async () => {
  setSystemTime();
  globalThis.fetch = realFetch;
  delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  await GlobalRegistrator.unregister();
});

async function renderBoard(container: HTMLElement) {
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return root;
}

async function openNeedsMe(container: HTMLElement) {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(el =>
    el.textContent?.includes('Needs me')
  ) as HTMLElement | undefined;
  if (!tab) throw new Error('Needs me tab not found');
  await React.act(async () => {
    tab.click();
  });
}

function emptyCopy(container: HTMLElement): string {
  return container.querySelector('.tui-empty')?.textContent?.trim() ?? '';
}

function withRows(mrs: unknown[]) {
  return {
    ...BOARD_DATA,
    members: [
      { username: 'robin-example', name: 'Robin Example', count: mrs.length },
    ],
    allMembers: [
      {
        username: 'robin-example',
        name: 'Robin Example',
        hidden: false,
        count: mrs.length,
      },
    ],
    mrs,
  };
}

function chips(container: HTMLElement): HTMLLabelElement[] {
  return [...container.querySelectorAll<HTMLLabelElement>('.tui-show-chip')];
}

/** Each Show chip as "label count", for the unchecked ones only. */
function unchecked(container: HTMLElement): string[] {
  return chips(container)
    .filter(c => !c.querySelector('input')!.checked)
    .map(c => {
      const count = c.querySelector('.tui-show-chip-count')!.textContent;
      return `${c.textContent!.slice(0, -count!.length).trim()} ${count}`;
    });
}

function chip(container: HTMLElement, label: string): HTMLInputElement {
  const c = chips(container).find(c => c.textContent?.startsWith(label));
  if (!c) throw new Error(`no ${label} chip`);
  return c.querySelector('input')!;
}

async function mount(fn: (container: HTMLElement) => Promise<void>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = await renderBoard(container);
  try {
    await fn(container);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
}

test('an empty Needs me queue with everything shown says nothing is waiting', async () => {
  await mount(async container => {
    await openNeedsMe(container);
    expect(emptyCopy(container)).toBe('nothing waiting on review ✓');
  });
});

test('an empty queue the picks did not empty keeps the nothing-waiting copy', async () => {
  history.replaceState(null, '', '?slack=posted');
  await mount(async container => {
    await openNeedsMe(container);
    expect(emptyCopy(container)).toBe('nothing waiting on review ✓');
    expect(unchecked(container)).toEqual(['Not Posted 0']);
  });
});

test('a red freshness banner suppresses the empty-queue check mark', async () => {
  servedData = {
    ...BOARD_DATA,
    dataSyncedAt: 0,
    mrs: [],
    syncError: {
      since: NOW - 100 * 60_000,
      lastAt: NOW - 60_000,
      kind: 'timeout',
      message: 'GraphQL errors: Timeout on MergeRequest.id',
      projects: 1,
    },
  };
  await mount(async container => {
    const el = container.querySelector<HTMLElement>(
      '.tui-banner[role="status"]'
    );
    expect(el?.dataset.intent).toBe('bad');
    expect(container.querySelector('.tui-empty')).toBeNull();
  });
});

test('a queue the Show picks emptied says so and offers the rows back', async () => {
  servedData = withRows([needsMeMr(1), needsMeMr(2)]);
  history.replaceState(null, '', '?slack=posted');
  await mount(async container => {
    await openNeedsMe(container);
    expect(emptyCopy(container)).toBe('nothing to show with these picks');
    expect(unchecked(container)).toEqual(['Not Posted 2']);
  });
});

test('unchecked drafts show as an unchecked chip, with no hidden-items note or footer', async () => {
  servedData = withRows([
    needsMeMr(1),
    { ...needsMeMr(2), isDraft: true },
    { ...needsMeMr(3), isDraft: true },
  ]);
  history.replaceState(null, '', '?drafts=hide');
  await mount(async container => {
    expect(container.querySelector('.tui-empty')).toBeNull();
    expect(unchecked(container)).toEqual(['My drafts 2']);
    expect(container.querySelector('.tui-hidden-note')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
    expect(rowCount(container)).toBe(1);
  });
});

test('checking an unchecked chip brings its rows back', async () => {
  servedData = withRows([
    { ...needsMeMr(1), slack: { posted: true, reactions: [] } },
    needsMeMr(2),
    {
      ...needsMeMr(3),
      isDraft: true,
      slack: { posted: true, reactions: [] },
    },
  ]);
  history.replaceState(null, '', '?slack=posted&drafts=hide');
  await mount(async container => {
    expect(unchecked(container)).toEqual(['Not Posted 1', 'My drafts 1']);
    expect(rowCount(container)).toBe(1);
    await React.act(async () => chip(container, 'My drafts').click());
    expect(unchecked(container)).toEqual(['Not Posted 1']);
    expect(rowCount(container)).toBe(2);
  });
});

test('the turn summary replaces the subtitle and links need you to Needs me', async () => {
  servedData = withRows([needsMeMr(1)]);
  await mount(async container => {
    const line = container.querySelector('.tui-turn-summary');
    expect(line?.textContent?.replace(/\s+/g, ' ')).toContain('1 need you');
    expect(container.textContent).not.toContain('awaiting review');
    expect(line?.querySelector('.tui-turn-synced')?.textContent).toMatch(
      /^synced \d{1,2}:\d{2}$/
    );
    expect(line?.textContent).not.toContain('·');
    const link = [...(line?.querySelectorAll('button') ?? [])].find(
      b => b.textContent === 'need you'
    )!;
    await React.act(async () => link.click());
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    ).toContain('Needs me');
  });
});

test('the Show chips start checked and taking Not Posted off re-checks Slack', async () => {
  servedData = withRows([
    { ...needsMeMr(1), slackChannel: 'team-reviews' },
    { ...needsMeMr(2), slackChannel: 'team-reviews' },
  ]);
  await mount(async container => {
    expect(chips(container)[0]!.textContent).toContain(
      'Posted to #team-reviews'
    );
    expect(unchecked(container)).toEqual([]);
    await React.act(async () => chip(container, 'Not Posted').click());
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(chip(container, 'Not Posted').checked).toBe(false);
    expect(posts).toEqual(['/slack/refresh']);
    await React.act(async () => chip(container, 'Not Posted').click());
    expect(chip(container, 'Not Posted').checked).toBe(true);
    expect(posts).toEqual(['/slack/refresh']);
  });
});

test('with no channel known the Slack items name the team channel', async () => {
  servedData = withRows([needsMeMr(1)]);
  await mount(async container => {
    expect(chips(container)[0]!.textContent).toContain(
      'Posted to team channel'
    );
    expect(chips(container)[1]!.title).toBe('not posted to team channel yet');
  });
});

test('the toolbar drops the copy-summary button and the old filter chips', async () => {
  servedData = withRows([needsMeMr(1)]);
  await mount(async container => {
    const header = container.querySelector('.tui-controls-header')!;
    expect(header.querySelector('[title="copy summary for Slack"]')).toBeNull();
    expect(header.querySelector('.tui-slack-filter')).toBeNull();
    expect(
      [...header.querySelectorAll('.tui-menu-button-label')].map(
        l => l.textContent
      )
    ).toEqual(['Group', 'Sort']);
  });
});

function rowCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-mr-iid]').length;
}

test('a stored Not Posted pick hides nothing on a board without Slack', async () => {
  servedData = {
    ...withRows([needsMeMr(1), needsMeMr(2)]),
    slackEnabled: false,
  };
  localStorage.setItem(
    'mrs-view-state',
    JSON.stringify({ off: ['notPosted'] })
  );
  await mount(async container => {
    expect(rowCount(container)).toBe(2);
    expect(chips(container).map(c => c.textContent)).not.toContainEqual(
      expect.stringContaining('Not Posted')
    );
  });
});

test('Needs me keeps its rows under a stored Waiting on author pick and offers no such item', async () => {
  servedData = withRows([needsMeMr(1), needsMeMr(2)]);
  localStorage.setItem(
    'mrs-view-state',
    JSON.stringify({ off: ['authorTurn'] })
  );
  await mount(async container => {
    await openNeedsMe(container);
    expect(rowCount(container)).toBe(2);
    const labels = chips(container).map(c => c.textContent ?? '');
    expect(labels.some(l => l.startsWith('Not Posted'))).toBe(true);
    expect(labels.some(l => l.startsWith('Waiting on author'))).toBe(false);
  });
});

test('saving a Whose turn signal reloads the board', async () => {
  servedData = withRows([needsMeMr(1)]);
  await mount(async container => {
    await React.act(async () =>
      container
        .querySelector<HTMLButtonElement>('.tui-show-chips-settings')!
        .click()
    );
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const box = [
      ...document.querySelectorAll<HTMLLabelElement>('.tui-config-turn label'),
    ]
      .find(l => l.textContent?.includes('merge conflicts'))!
      .querySelector('input')!;
    const before = dataLoads;
    await React.act(async () => box.click());
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(dataLoads).toBe(before + 1);
  });
});

test('the roster counts only the rows the Show picks leave on the board', async () => {
  servedData = withRows([
    { ...needsMeMr(1), slack: { posted: true, reactions: [] } },
    needsMeMr(2),
    needsMeMr(3),
  ]);
  const counts = (container: HTMLElement) =>
    [...container.querySelectorAll('.tui-sidebar .tui-side-count')].map(
      c => c.textContent
    );
  await mount(async container => {
    expect(counts(container)[0]).toBe('3');
    await React.act(async () => chip(container, 'Not Posted').click());
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(counts(container)[0]).toBe('1');
    expect(rowCount(container)).toBe(1);
  });
});
