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
  defaultMember: 'matt',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 0 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 0 },
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

function needsMeMr(iid: number) {
  return {
    iid,
    title: `mr ${iid}`,
    webUrl: `https://gitlab.example.com/g/p/-/merge_requests/${iid}`,
    author: { username: 'matt', name: 'Matthew Goodwin' },
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
      return new Response(JSON.stringify(servedData), { status: 200 });
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
    members: [{ username: 'matt', name: 'Matthew Goodwin', count: mrs.length }],
    allMembers: [
      {
        username: 'matt',
        name: 'Matthew Goodwin',
        hidden: false,
        count: mrs.length,
      },
    ],
    mrs,
  };
}

function alsoShow(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.tui-also-show-pill')].map(
    el => el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  );
}

function showButton(container: HTMLElement): HTMLButtonElement {
  const btn = [
    ...container.querySelectorAll<HTMLButtonElement>('.tui-menu-button'),
  ].find(b => b.textContent?.includes('Showing'));
  if (!btn) throw new Error('Showing button not found');
  return btn;
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
    expect(alsoShow(container)).toEqual([]);
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
    expect(alsoShow(container)).toEqual(['+ Not Posted 2']);
  });
});

test('unchecked drafts land on the Also show line, with no hidden-items note or footer', async () => {
  servedData = withRows([
    needsMeMr(1),
    { ...needsMeMr(2), isDraft: true },
    { ...needsMeMr(3), isDraft: true },
  ]);
  history.replaceState(null, '', '?drafts=hide');
  await mount(async container => {
    expect(container.querySelector('.tui-empty')).toBeNull();
    expect(alsoShow(container)).toEqual(['+ My drafts 2']);
    expect(container.querySelector('.tui-hidden-note')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
    expect(showButton(container).textContent).toContain('1 of 3');
  });
});

test('show everything checks every item again', async () => {
  servedData = withRows([
    { ...needsMeMr(1), slack: { posted: true, reactions: [] } },
    needsMeMr(2),
    { ...needsMeMr(3), isDraft: true },
  ]);
  history.replaceState(null, '', '?slack=posted&drafts=hide');
  await mount(async container => {
    expect(alsoShow(container)).toEqual(['+ Not Posted 2', '+ My drafts 1']);
    const everything = [
      ...container.querySelectorAll<HTMLButtonElement>('.tui-also-show button'),
    ].find(b => b.textContent === 'show everything')!;
    await React.act(async () => everything.click());
    expect(container.querySelector('.tui-also-show')).toBeNull();
    expect(showButton(container).textContent).toContain('3 of 3');
  });
});

test('the turn summary replaces the subtitle and links need you to Needs me', async () => {
  servedData = withRows([needsMeMr(1)]);
  await mount(async container => {
    const line = container.querySelector('.tui-turn-summary');
    expect(line?.textContent?.replace(/\s+/g, ' ')).toContain('1 need you');
    expect(container.textContent).not.toContain('awaiting review');
    expect(line?.querySelector('.tui-turn-synced')?.textContent).toMatch(
      /^· synced /
    );
    const link = [...(line?.querySelectorAll('button') ?? [])].find(
      b => b.textContent === 'need you'
    )!;
    await React.act(async () => link.click());
    expect(
      container.querySelector('[role="tab"][aria-selected="true"]')?.textContent
    ).toContain('Needs me');
  });
});

test('the Show menu lists its items checked and taking Not Posted off re-checks Slack', async () => {
  servedData = withRows([
    { ...needsMeMr(1), slackChannel: 'team-reviews' },
    { ...needsMeMr(2), slackChannel: 'team-reviews' },
  ]);
  await mount(async container => {
    await React.act(async () => showButton(container).click());
    expect(document.querySelector('[role="menu"]')?.textContent).toContain(
      'Posted to #team-reviews'
    );
    const items = () => [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemcheckbox"]'
      ),
    ];
    expect(items().map(i => i.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'true',
      'true',
    ]);
    const notPosted = () =>
      items().find(i => i.textContent?.includes('Not Posted'))!;
    await React.act(async () => notPosted().click());
    await React.act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(notPosted().getAttribute('aria-checked')).toBe('false');
    expect(posts).toEqual(['/slack/refresh']);
    await React.act(async () => notPosted().click());
    expect(notPosted().getAttribute('aria-checked')).toBe('true');
    expect(posts).toEqual(['/slack/refresh']);
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
    ).toEqual(['Group', 'Sort', 'Showing']);
  });
});
