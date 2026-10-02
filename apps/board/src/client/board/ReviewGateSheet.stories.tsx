import { useEffect, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { gateDraftKey } from '@mattstack/gate-kit/react';
import { registerTheme, SoribashiProvider } from '@mattstack/tui-kit/provider';
import { tuiTheme } from '@mattstack/tui-kit/theme';

import '@mattstack/tui-kit/theme.css';
import '@mattstack/tui-kit/canvas.css';
import '../../style.css';

import type { GateQuestion, GateRow } from '../../gates/store.ts';
import type { BoardMRWithReview } from '../types.ts';
import { useGateForm } from './GateForm.tsx';
import { ReviewGateSheet } from './ReviewGateSheet.tsx';

/**
 * Storybook coverage for the full-screen review gate sheet (design doc
 * `docs/superpowers/specs/2026-09-18-review-gate-redesign-design.md` §4):
 * six invented findings across two chunked questions plus a clean-review
 * (outcome-only) variant. The fixtures carry review@1 (gate-level) and
 * findings@1 (per-chunk) contexts, the shapes `readReviewGate` joins. The
 * sheet fills the viewport itself, so the stage only needs the theme
 * provider, not DecisionQueueModal.stories.tsx's tall padded stage.
 */
function Stage({
  scheme,
  children,
}: {
  scheme: 'light' | 'dark';
  children: ReactNode;
}) {
  return (
    <div
      className={scheme === 'dark' ? 'dark' : undefined}
      style={{
        background: 'var(--page)',
        color: 'var(--text-1)',
        height: '100vh',
      }}
    >
      <SoribashiProvider theme={tuiTheme}>{children}</SoribashiProvider>
    </div>
  );
}

const stage = (
  Story: () => ReactNode,
  context: { globals: { scheme?: string } }
) => (
  <Stage scheme={context.globals.scheme === 'dark' ? 'dark' : 'light'}>
    <Story />
  </Stage>
);

const meta = {
  title: 'Gates/Board/ReviewGateSheet',
  decorators: [stage],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

registerTheme(tuiTheme);

function question(
  id: string,
  label: string,
  multi: boolean,
  options: GateQuestion['options'],
  context?: string
): GateQuestion {
  return { id, label, multi, options, ...(context ? { context } : {}) };
}

const boardMr = {
  iid: 31,
  title: 'themed gate controls',
  webUrl: 'https://gitlab.example.com/acme/widgets/-/merge_requests/31',
  author: { id: 'gitlab:7', username: 'paul', name: 'Paul', avatarUrl: null },
  sourceBranch: 'board-28-themed-gate-controls',
  targetBranch: 'main',
  createdAt: '2026-09-17T09:00:00.000Z',
  diff: { additions: 84, deletions: 21, filesChanged: 6 },
} as unknown as BoardMRWithReview;

const ctx = (v: unknown) => JSON.stringify(v);
const findingsCtx = (...findings: object[]) =>
  ctx({ 'gate-ctx': 'findings@1', findings });
const F = {
  f1: {
    id: 'f1',
    severity: 'critical',
    title: 'SQL built from unsanitized input',
    file: 'lib/db/query.ts:42',
    fix: 'parameterize the query',
    body: 'The search handler interpolates the raw `q` parameter into the WHERE clause, so a crafted query string reaches the database as SQL.',
  },
  f2: {
    id: 'f2',
    severity: 'important',
    title: 'Missing null check on response',
    file: 'lib/api/client.ts:88',
    fix: 'guard before dereferencing',
    body: 'A 204 from the upstream returns no body, and `data.items` is read before anything checks that `data` exists.',
  },
  f3: {
    id: 'f3',
    severity: 'important',
    title: 'Inconsistent error wording',
    file: 'lib/errors.ts:15',
    fix: 'align with the style guide',
    body: 'Two of the new messages end in a period and one does not; the style guide asks for none.',
  },
  f4: {
    id: 'f4',
    severity: 'minor',
    title: 'Unused import',
    file: 'lib/utils.ts:3',
    fix: 'drop the dead import',
    body: '`debounce` is imported and never called.',
  },
  f5: {
    id: 'f5',
    severity: 'important',
    title: 'Retry loop lacks backoff',
    file: 'lib/retry.ts:41',
    fix: 'add exponential backoff',
    body: 'The loop retries immediately up to five times, which turns one upstream blip into a burst of six requests.',
  },
  f6: {
    id: 'f6',
    severity: 'minor',
    title: 'Inconsistent spacing',
    file: 'lib/format.ts:9',
    fix: 'run prettier',
    body: 'The new block mixes two- and four-space indents.',
  },
};

const findingsQuestions = [
  question(
    'findings-1',
    'Post which findings to !31?',
    true,
    [
      {
        value: 'f1',
        label: '[Critical] SQL built from unsanitized input',
        description: 'lib/db/query.ts:42 · parameterize the query',
      },
      {
        value: 'f2',
        label: '[Important] Missing null check on response',
        description:
          'lib/api/client.ts:88 · guard before dereferencing · kind:bug',
      },
      {
        value: 'f3',
        label: '[Important] Inconsistent error wording',
        description: 'lib/errors.ts:15 · align with the style guide',
      },
      {
        value: 'f4',
        label: '[Minor] Unused import',
        description: 'lib/utils.ts:3 · drop the dead import',
      },
    ],
    findingsCtx(F.f1, F.f2, F.f3, F.f4)
  ),
  question(
    'findings-2',
    'Post which findings to !31?',
    true,
    [
      {
        value: 'f5',
        label: '[Important] Retry loop lacks backoff',
        description:
          'lib/retry.ts:41 · add exponential backoff · kind:suggestion',
      },
      {
        value: 'f6',
        label: '[Minor] Inconsistent spacing',
        description: 'lib/format.ts:9 · run prettier',
      },
    ],
    findingsCtx(F.f5, F.f6)
  ),
  question('outcome', 'Verdict on !31', false, [
    {
      value: 'approve',
      label: 'approve (recommended)',
      description:
        'Approve !31 and post the selected findings as inline threads.',
    },
    {
      value: 'comment',
      label: 'comment',
      description:
        'Post the selected findings without a verdict; the important ones stay open.',
    },
  ]),
];

const sixFindingGate: GateRow = {
  gateId: 'sheet-six-findings',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1788962100000,
  context: ctx({
    'gate-ctx': 'review@1',
    reviewer: 'renee',
    readiness: 'with-fixes',
    summary: 'One critical injection risk; everything else is polish.',
    findings: { critical: 1, important: 3, minor: 2 },
  }),
  questions: findingsQuestions,
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

const reportJson = JSON.stringify({
  findings: [],
  depth:
    'verify. jest 120/120 green; typecheck noise was codegen, not defects.',
  strengths: [
    {
      lead: 'Retry loop now covers the abort path',
      detail: 'lib/retry.ts:58, matches the earlier thread',
    },
    { lead: 'Config validation reads clean', detail: 'lib/config.ts:12-40' },
  ],
  checks: [
    { tag: 'PASS', text: 'jest suite (120/120)' },
    { tag: 'PASS', text: 'typecheck' },
    { tag: 'N/A', text: 'visual regression (no UI touched)' },
  ],
  notes: ['Consider a follow-up MR to backfill retry tests for the old path.'],
});

// Captured once at module scope, before any story stubs it: the restore
// target every fetchStub decorator falls back to and resets to on cleanup.
const REAL_FETCH = globalThis.fetch;

/** Installs a fetch stub for the story's mount only and restores the real
    fetch on unmount, rather than clobbering globalThis.fetch permanently.
    `handler` answers `/review/*` urls; anything it returns undefined for
    falls through to the real fetch. */
function fetchStub(
  handler: (url: string) => Response | Promise<Response> | undefined
) {
  return function FetchStubDecorator(Story: () => ReactNode) {
    // Installed during render, not in an effect: the sheet's own mount
    // effect fetches report.json, and child effects run before this
    // decorator's would, so an effect-installed stub arrives too late.
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const url = typeof input === 'string' ? input : input.toString();
      const stubbed = await handler(url);
      if (stubbed !== undefined) return stubbed;
      return REAL_FETCH(input as RequestInfo, init);
    }) as typeof fetch;
    useEffect(
      () => () => {
        globalThis.fetch = REAL_FETCH;
      },
      []
    );
    return <Story />;
  };
}

const noop = () => {};

function seedDraft(
  gateId: string,
  draft: {
    selections: Record<string, string | string[]>;
    notes: Record<string, string>;
    item: string | null;
  }
) {
  localStorage.setItem(gateDraftKey(gateId), JSON.stringify(draft));
}

function Host({ gate, mr }: { gate: GateRow; mr: BoardMRWithReview }) {
  const form = useGateForm(gate, noop);
  return (
    <ReviewGateSheet
      gate={gate}
      mr={mr}
      form={form}
      queue={{
        index: 1,
        total: 3,
        states: ['done', 'active', 'todo'],
        canPrev: true,
        canNext: true,
        onPrev: noop,
        onNext: noop,
      }}
      onClose={noop}
      onContinue={noop}
      onFocusPane={noop}
    />
  );
}

// --- SixFindings -------------------------------------------------------

/** The full record cluster: report.json resolves with every optional array
    populated, so `/review/report.json` is mocked in rather than left to hit
    the network from Storybook's iframe. */
export const SixFindings: Story = {
  decorators: [
    fetchStub(url =>
      url.startsWith('/review/report.json')
        ? new Response(reportJson, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : undefined
    ),
  ],
  render: () => <Host gate={sixFindingGate} mr={boardMr} />,
};

// --- UnselectedSome ------------------------------------------------------

/** Mid-triage: three findings unchecked, so the tally and submit label both
    read a partial count -- the draft seed drives the same localStorage key
    useGateForm reads on mount. */
const partialGate: GateRow = { ...sixFindingGate, gateId: 'sheet-partial' };

export const UnselectedSome: Story = {
  decorators: [
    fetchStub(url =>
      url.includes('/review/')
        ? new Response('no structured review yet', { status: 404 })
        : undefined
    ),
  ],
  render: () => {
    seedDraft(partialGate.gateId, {
      selections: { findings: ['f1', 'f3', 'f5'], outcome: 'comment' },
      notes: {},
      item: null,
    });
    return <Host gate={partialGate} mr={boardMr} />;
  },
};

// --- CleanReview -----------------------------------------------------------

/** No findings at all: the outcome question rides alone, so the sheet skips
    the findings head/list entirely and shows only the MR card, the (absent)
    record cluster's full-report fallback, and the verdict. */
const cleanGate: GateRow = {
  gateId: 'sheet-clean',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/46',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1788964320000,
  context: ctx({
    'gate-ctx': 'review@1',
    readiness: 'yes',
    summary: 'Nothing flagged worth a thread.',
    findings: {},
  }),
  questions: [
    question('outcome', 'Verdict on !46', false, [
      {
        value: 'approve',
        label: 'approve (recommended)',
        description: 'Approve !46; nothing was flagged worth a thread.',
      },
      {
        value: 'comment',
        label: 'comment',
        description: 'Leave a comment without approving.',
      },
    ]),
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

const cleanMr = { ...boardMr, iid: 46 } as BoardMRWithReview;

export const CleanReview: Story = {
  decorators: [
    fetchStub(url =>
      url.includes('/review/')
        ? new Response('no structured review yet', { status: 404 })
        : undefined
    ),
  ],
  render: () => <Host gate={cleanGate} mr={cleanMr} />,
};

// --- ReReview --------------------------------------------------------------

/** Round 2: the decision card's meta line carries the reviewer, the round,
    and the addressed/still-open tally, and three carried-over findings each
    show their own disposition pill. */
const reReviewGate: GateRow = {
  gateId: 'sheet-re-review',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1788965520000,
  context: ctx({
    'gate-ctx': 'review@1',
    reviewer: 'renee',
    readiness: 'with-fixes',
    summary: 'Two important findings carried over; the rest is polish.',
    findings: { important: 2, minor: 1 },
    round: 2,
    re_review: true,
    prior: { addressed: 3, still_open: 1 },
  }),
  questions: [
    question(
      'findings-1',
      'Post which findings to !31?',
      true,
      [
        findingsQuestions[0]!.options[1]!,
        findingsQuestions[1]!.options[0]!,
        findingsQuestions[1]!.options[1]!,
      ],
      findingsCtx(
        { ...F.f2, disposition: 'still-open' },
        { ...F.f5, disposition: 'new' },
        { ...F.f6, disposition: 'addressed-check' }
      )
    ),
    findingsQuestions[2]!,
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

export const ReReview: Story = {
  decorators: [
    fetchStub(url =>
      url.includes('/review/')
        ? new Response('no structured review yet', { status: 404 })
        : undefined
    ),
  ],
  render: () => <Host gate={reReviewGate} mr={boardMr} />,
};

// --- Later rounds: earlier threads, new findings, skipped findings --------

const no404 = fetchStub(url =>
  url.includes('/review/')
    ? new Response('no structured review yet', { status: 404 })
    : undefined
);

function carryQuestion(
  n: number,
  thread: string,
  file: string,
  defaults: { post: boolean; resolve: boolean },
  carry: {
    round: number;
    call: 'fixed' | 'not-fixed' | 'pushback-accepted' | 'pushback-rejected';
    original: string;
    authorReply?: string;
    note?: string;
    reply: string;
  }
): GateQuestion {
  return question(
    `thread-${n}`,
    file,
    true,
    [
      {
        value: `post:${thread}`,
        label: defaults.post ? 'Post reply (Recommended)' : 'Post reply',
        description: 'post this reply to the thread',
      },
      {
        value: `resolve:${thread}`,
        label: defaults.resolve ? 'Resolve (Recommended)' : 'Resolve',
        description: 'resolve the thread when the review is submitted',
      },
    ],
    ctx({ 'gate-ctx': 'carryover@1', thread, file, ...carry })
  );
}

const threadFixed = carryQuestion(
  1,
  'd-query',
  'lib/db/query.ts:42',
  { post: true, resolve: true },
  {
    round: 1,
    call: 'fixed',
    original:
      '**issue:** the search handler interpolates the raw `q` parameter into the WHERE clause, so a crafted query string reaches the database as SQL.',
    authorReply:
      'Switched to a parameterized query in 4c1e9a2 and added a test with a quote in the search term.',
    note: 'verified: query.ts:42 now binds $1, and the new test covers a quoted term',
    reply: "Thanks, that's exactly the fix. Resolving.",
  }
);

const threadNotFixed = carryQuestion(
  2,
  'd-retry',
  'lib/retry.ts:41',
  { post: true, resolve: false },
  {
    round: 2,
    call: 'not-fixed',
    original:
      '**issue:** the loop retries immediately up to five times, which turns one upstream blip into a burst of six requests.',
    authorReply: 'Added exponential backoff in 7d2f310.',
    note: 'the backoff landed, but an aborted request still goes round the loop: retry.ts:58 never checks signal.aborted',
    reply:
      'The backoff looks good. One gap left: an aborted request still goes round the loop, since nothing checks `signal.aborted` before the next try (`retry.ts:58`).',
  }
);

const threadPushbackAccepted = carryQuestion(
  3,
  'd-errors',
  'lib/errors.ts:15',
  { post: true, resolve: true },
  {
    round: 2,
    call: 'pushback-accepted',
    original:
      '**suggestion:** two of the new messages end in a period and one does not; the style guide asks for none.',
    authorReply:
      "These mirror the upstream API's error strings word for word, so support can search for them. I'd rather keep them identical.",
    note: 'fair: the strings are copied verbatim from the upstream API, and matching them is the better rule here',
    reply:
      'Makes sense, matching the API exactly is the better call. Resolving.',
  }
);

const threadPushbackRejected = carryQuestion(
  4,
  'd-client',
  'lib/api/client.ts:88',
  { post: true, resolve: false },
  {
    round: 1,
    call: 'pushback-rejected',
    original:
      '**issue:** a 204 from the upstream returns no body, and `data.items` is read before anything checks that `data` exists.',
    authorReply: 'The upstream never sends a 204 for this endpoint.',
    note: 'the upstream docs list a 204 for an empty page, and client.test.ts has no case for it',
    reply:
      "The upstream docs list a 204 for an empty page (`GET /items?page=`), so I think the guard still earns its place. Happy to be wrong if you've seen otherwise.",
  }
);

const threadNoReply = carryQuestion(
  5,
  'd-cache-ttl',
  'lib/cache.ts:9',
  { post: true, resolve: false },
  {
    round: 2,
    call: 'not-fixed',
    original:
      '**question:** is a 24h TTL intended here? The other caches in this module use 5 minutes.',
    note: 'no reply and no change at cache.ts:9',
    reply: 'Bumping this one: is the 24h TTL intended?',
  }
);

const NEW = {
  n1: {
    id: 'n1',
    severity: 'important',
    title: 'Cache key ignores the tenant',
    file: 'lib/cache.ts:23',
    fix: 'prefix the key with the tenant id',
    body: 'Two tenants asking for the same page share one cache entry, so the second one is served the first tenant’s results.',
    disposition: 'new',
  },
  n2: {
    id: 'n2',
    severity: 'minor',
    title: 'Debug log prints the whole session object',
    file: 'lib/auth/session.ts:61',
    fix: 'log the session id only',
    body: 'The new `log.debug` call serializes the full session, refresh token included.',
    disposition: 'new',
  },
};

const newFindingsQuestion = question(
  'findings-1',
  'Post which findings to !31?',
  true,
  [
    {
      value: 'n1',
      label: '[Important] Cache key ignores the tenant',
      description: 'lib/cache.ts:23 · prefix the key with the tenant id',
    },
    {
      value: 'n2',
      label: '[Minor] Debug log prints the whole session object',
      description: 'lib/auth/session.ts:61 · log the session id only',
    },
  ],
  findingsCtx(NEW.n1, NEW.n2)
);

const skippedQuestion = question(
  'skipped-1',
  'Bring back which skipped findings?',
  true,
  [
    {
      value: 'restore:s1',
      label: '[Minor] Unused import',
      description: 'lib/utils.ts:3 · skipped in round 1',
    },
    {
      value: 'restore:s2',
      label: '[Minor] Inconsistent spacing',
      description: 'lib/format.ts:9 · skipped in round 1 · code changed since',
    },
    {
      value: 'restore:s3',
      label: '[Important] Config defaults live in two files',
      description: 'lib/config.ts:12 · skipped in round 2',
    },
  ],
  ctx({
    'gate-ctx': 'skipped@1',
    skipped: [
      {
        id: 's1',
        round: 1,
        severity: 'minor',
        title: 'Unused import',
        file: 'lib/utils.ts:3',
      },
      {
        id: 's2',
        round: 1,
        severity: 'minor',
        title: 'Inconsistent spacing',
        file: 'lib/format.ts:9',
        changed: true,
      },
      {
        id: 's3',
        round: 2,
        severity: 'important',
        title: 'Config defaults live in two files',
        file: 'lib/config.ts:12',
      },
    ],
  })
);

const commentFirst = question('outcome', 'Verdict on !31', false, [
  {
    value: 'comment',
    label: 'comment (recommended)',
    description:
      'Submit as a Comment review: the replies, resolves and new findings post together.',
  },
  {
    value: 'approve',
    label: 'approve',
    description: 'Submit the review and approve !31.',
  },
]);

const roundThreeGate: GateRow = {
  gateId: 'sheet-round-three',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1788969120000,
  context: ctx({
    'gate-ctx': 'review@1',
    reviewer: 'renee',
    readiness: 'with-fixes',
    summary:
      'The injection fix and the backoff both landed. An aborted request still retries, the 204 guard is still missing, and the new cache layer shares entries across tenants.',
    findings: { important: 1, minor: 1 },
    round: 3,
    re_review: true,
  }),
  questions: [
    threadFixed,
    threadNotFixed,
    threadPushbackAccepted,
    threadPushbackRejected,
    threadNoReply,
    newFindingsQuestion,
    skippedQuestion,
    commentFirst,
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

/** Round 3: five earlier threads, one per call the agent can make (plus a
    thread the author never answered), two new findings, and three findings
    skipped in earlier rounds, collapsed. Fixed and accepted pushback start
    on reply + resolve; the rest start on reply only. */
export const RoundThree: Story = {
  decorators: [no404],
  render: () => <Host gate={roundThreeGate} mr={boardMr} />,
};

const bringingBackGate: GateRow = {
  ...roundThreeGate,
  gateId: 'sheet-round-three-bringing-back',
};

/** The same round with one skipped finding ticked to come back: the skipped
    row opens on its own, its hint and the submit label count it, and the
    rest stay off the MR. */
export const RoundThreeBringingOneBack: Story = {
  decorators: [no404],
  render: () => {
    seedDraft(bringingBackGate.gateId, {
      selections: { skipped: ['restore:s2'] },
      notes: {},
      item: null,
    });
    return <Host gate={bringingBackGate} mr={boardMr} />;
  },
};

const settledGate: GateRow = {
  gateId: 'sheet-round-two-settled',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1788970320000,
  context: ctx({
    'gate-ctx': 'review@1',
    reviewer: 'renee',
    readiness: 'yes',
    summary:
      'Both asks from round 1 are settled and nothing new turned up. Ready to approve.',
    findings: {},
    round: 2,
    re_review: true,
  }),
  questions: [
    threadFixed,
    threadPushbackAccepted,
    question('outcome', 'Verdict on !31', false, [
      {
        value: 'approve',
        label: 'approve (recommended)',
        description: 'Submit the replies and resolves, and approve !31.',
      },
      {
        value: 'comment',
        label: 'comment',
        description: 'Submit the replies and resolves without approving.',
      },
    ]),
  ],
  origin: { paneId: 'pane-1', worktree: 'widgets' },
};

/** Round 2 where everything from round 1 is settled: the earlier threads
    start on reply + resolve, the new-findings section says nothing turned
    up, and approve is the recommendation. */
export const RoundTwoAllSettled: Story = {
  decorators: [no404],
  render: () => <Host gate={settledGate} mr={boardMr} />,
};
