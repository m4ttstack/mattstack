/** A gate re-raised while its sheet is open: the daemon closes the old gate
    as superseded (never answered) and opens a new one on the same MR and
    kind. The next data reload carries the successor and the old->new
    mapping, and the open sheet must move onto the new gate with no manual
    refresh. */

import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

GlobalRegistrator.register({ url: 'http://localhost/' });

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor() {
    FakeEventSource.last = this;
  }
  close(): void {}
}
(globalThis as unknown as { EventSource: unknown }).EventSource =
  FakeEventSource;
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const gate = (gateId: string, label: string) => ({
  gateId,
  subject: 'mr:https://gitlab.example.com/acme/webapp/-/merge_requests/301',
  kind: 'clarify',
  label: 'clarify',
  status: 'open',
  openedAt: Date.now() - 60_000,
  questions: [
    {
      id: 'verify',
      label,
      multi: false,
      options: [
        { value: 'push-ci', label: 'Push and let CI run' },
        { value: 'local', label: 'Run it locally first' },
      ],
    },
  ],
});

const boardData = (reraised: boolean) => ({
  title: 'MRs ready for review',
  defaultMember: 'all',
  members: [{ username: 'matt', name: 'Matthew Goodwin', count: 1 }],
  allMembers: [
    { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 1 },
  ],
  mrs: [
    {
      iid: 301,
      title: 'guard the login redirect',
      webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/301',
      author: { username: 'matt', name: 'Matthew Goodwin' },
      sourceBranch: 'guard-login-redirect',
      targetBranch: 'main',
      updatedAt: '2026-09-23T00:00:00Z',
      createdAt: '2026-09-23T00:00:00Z',
      reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
      blockers: { any: false },
      mergeButton: { visible: false, disabled: false, loading: false },
      autoMergeButton: { visible: false, isActive: false },
      reviewerComments: 0,
      unresolvedThreads: 0,
      isDraft: false,
      pipelineState: 'none',
      repositoryId: 'gitlab:1',
      rtRepo: null,
      codeownerSections: [],
      gates: [
        reraised
          ? gate('g-new', 'How should the second round be verified?')
          : gate('g-old', 'How should this be verified?'),
      ],
    },
  ],
  gateReplacements: reraised ? { 'g-old': 'g-new' } : {},
  fetchedAt: 1790000000000,
  fetchError: null,
  local: true,
  slackEnabled: false,
  slackTemplates: {
    single: '{title}: {url}',
    multiHeader: '{count} ready',
    multiItem: '- {title}',
  },
  dataSyncedAt: 1790000000000,
  scopeUncovered: [],
  scopeUncoveredSections: [],
  scopeKnownSections: null,
  scopeWindowDays: null,
  staleAfterDays: 90,
  canInvite: false,
  peering: null,
  tabs: [{ id: 'team', label: 'Team', source: { kind: 'authors' } }],
});

let React: typeof import('react');
let createRoot: typeof import('react-dom/client').createRoot;
let Board: typeof import('../Board.tsx').Board;
let reraised: boolean;

beforeAll(async () => {
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ Board } = await import('../Board.tsx'));
});

beforeEach(() => {
  localStorage.clear();
  reraised = false;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/data.json'))
      return new Response(JSON.stringify(boardData(reraised)), {
        status: 200,
      });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function settle() {
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

async function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  await React.act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}

test('the open sheet moves onto the gate that superseded it after a data reload', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Board));
  });
  await settle();
  try {
    await click(container.querySelector('.tui-dq-open'));
    const sheetText = () =>
      document.body.querySelector('.tui-gate-sheet')?.textContent ?? '';
    expect(sheetText()).toContain('How should this be verified?');

    // The agent re-raises: the SSE nudge reloads /data.json, which now
    // carries only the successor and the old->new mapping.
    reraised = true;
    await React.act(async () => {
      FakeEventSource.last!.onmessage!({ data: 'nudge' } as MessageEvent);
    });
    await settle();

    expect(sheetText()).toContain('How should the second round be verified?');
    expect(sheetText()).not.toContain('How should this be verified?');
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
  }
});
