/** DOM-level test for the full-screen review gate sheet: the findings list
    collapses `findings-1`/`findings-2` chunks into one list, the tally and
    submit label track the checked set, tier groups show their counts, and
    the verdict renders as gate choices with the recommended badge. The
    fixtures carry review@1 (gate-level) and findings@1 (per-chunk) contexts,
    the shapes `readReviewGate` actually joins. Mirrors
    gate-form-skip-dom.test.tsx's direct-mount harness rather than a full
    Board render, since the sheet is host-agnostic. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { MotionGlobalConfig } from 'motion/react';
import { createRoot, type Root } from 'react-dom/client';

import { gateDraftKey } from '@mattstack/gate-kit/react';
import type { GateQuestion, GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { useGateForm } from '../GateForm.tsx';
import { ReviewGateSheet } from '../ReviewGateSheet.tsx';
import {
  installFakeResizeObserver,
  reserveOf,
} from './fake-resize-observer.ts';

GlobalRegistrator.register({ url: 'http://localhost/' });
// happy-dom's Web Animations stub rejects a cancelled animation, which motion
// raises as an unhandled error when a comment swaps faces; without `animate`
// motion falls back to its own frame loop.
delete (Element.prototype as { animate?: unknown }).animate;
// Folds and fades finish at once, so an unticked card's sections leave the
// DOM in the same act() rather than after an exit animation.
MotionGlobalConfig.skipAnimations = true;

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const j = (v: unknown) => JSON.stringify(v);

function entry(
  id: string,
  severity: 'critical' | 'important' | 'minor',
  title: string,
  file: string | undefined,
  fix: string | undefined,
  extra: Record<string, unknown> = {}
) {
  return {
    id,
    severity,
    title,
    body: `${title}: the full finding text, never truncated.`,
    ...(file !== undefined ? { file } : {}),
    ...(fix !== undefined ? { fix } : {}),
    ...extra,
  };
}

const E = {
  f1: entry(
    'f1',
    'critical',
    'SQL built from unsanitized input',
    'lib/db/query.ts:42',
    'parameterize the query'
  ),
  f2: entry(
    'f2',
    'important',
    'Missing null check on response',
    'lib/api/client.ts:88',
    'guard before dereferencing'
  ),
  f3: entry(
    'f3',
    'important',
    'Inconsistent error wording',
    'lib/errors.ts:15',
    'align with the style guide'
  ),
  f4: entry(
    'f4',
    'minor',
    'Unused import',
    'lib/utils.ts:3',
    'drop the dead import'
  ),
  f5: entry(
    'f5',
    'important',
    'Retry loop lacks backoff',
    'lib/retry.ts:41',
    'add exponential backoff'
  ),
  f6: entry(
    'f6',
    'minor',
    'Inconsistent spacing',
    'lib/format.ts:9',
    'run prettier'
  ),
};

const findingsCtx = (...entries: object[]) =>
  j({ 'gate-ctx': 'findings@1', findings: entries });

const REVIEW = {
  'gate-ctx': 'review@1',
  reviewer: 'renee',
  readiness: 'with-fixes',
  summary: 'One critical injection path; the rest are cleanups.',
  findings: { critical: 1, important: 3, minor: 2 },
};

const GATE: GateRow = {
  gateId: 'g-review',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1,
  context: j(REVIEW),
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      context: findingsCtx(E.f1, E.f2, E.f3, E.f4),
      options: [
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
    },
    {
      id: 'findings-2',
      label: 'Post which findings to !31?',
      multi: true,
      context: findingsCtx(E.f5, E.f6),
      options: [
        {
          value: 'f5',
          label: '[Important] Retry loop lacks backoff',
          description: 'lib/retry.ts:41 · add exponential backoff',
        },
        {
          value: 'f6',
          label: '[Minor] Inconsistent spacing',
          description: 'lib/format.ts:9 · run prettier',
        },
      ],
    },
    {
      id: 'outcome',
      label: 'Verdict on !31',
      multi: false,
      options: [
        { value: 'approve', label: 'approve (recommended)' },
        { value: 'comment', label: 'comment' },
      ],
    },
  ],
};

const MR = {
  iid: 31,
  title: 'themed gate controls',
  webUrl: 'https://gitlab.example.com/acme/widgets/-/merge_requests/31',
  author: { username: 'paul', name: 'Paul' },
  sourceBranch: 'board-28-themed-gate-controls',
  targetBranch: 'main',
  createdAt: '2026-09-17T00:00:00.000Z',
  diff: { additions: 40, deletions: 12, filesChanged: 3 },
} as unknown as BoardMRWithReview;

const QUEUE = {
  index: 1,
  total: 3,
  states: ['done', 'active', 'todo'] as const,
  canNext: true,
  onPrev: () => {},
  onNext: () => {},
};

function Host({
  gate = GATE,
  queueIndex = QUEUE.index,
  onPrev = () => {},
  onContinue = () => {},
  noMr = false,
}: {
  gate?: GateRow;
  queueIndex?: number;
  onPrev?: () => void;
  onContinue?: () => void;
  noMr?: boolean;
}) {
  const form = useGateForm(gate);
  return (
    <ReviewGateSheet
      gate={gate}
      mr={noMr ? undefined : MR}
      form={form}
      queue={{
        ...QUEUE,
        index: queueIndex,
        canPrev: queueIndex > 0,
        states: [...QUEUE.states],
        onPrev,
      }}
      onClose={() => sheetCloses++}
      onContinue={onContinue}
      onFocusPane={() => {}}
    />
  );
}

let sheetCloses = 0;
let root: Root;
let container: HTMLElement;
let posts: Array<{ url: string; body: unknown }>;
let answeredElsewhere: boolean;

beforeEach(() => {
  localStorage.clear();
  posts = [];
  answeredElsewhere = false;
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL,
    init?: { body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json'))
      return new Response('no structured review yet', { status: 404 });
    posts.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    if (answeredElsewhere && url === '/gate/answer')
      return new Response(
        JSON.stringify({
          ok: false,
          conflict: true,
          row: { answer: { answers: {}, by: 'pane' } },
        }),
        { status: 409 }
      );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

async function render(
  gate?: GateRow,
  hostProps?: {
    queueIndex?: number;
    onPrev?: () => void;
    onContinue?: () => void;
    noMr?: boolean;
  }
) {
  await React.act(async () => {
    root.render(<Host gate={gate} {...hostProps} />);
  });
}

async function click(el: Element) {
  await React.act(async () => {
    (el as HTMLElement).click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    b => b.textContent?.trim() === text
  );
  if (!found) throw new Error(`no button with text "${text}"`);
  return found as HTMLButtonElement;
}

/** Seeds `useGateForm`'s draft the way DecisionQueueModal.stories.tsx's own
    `seedDraft` does, so a note reaches `form.notes` without simulating a
    keystroke -- happy-dom's `<input>` does not install React's value
    tracker the way it does for a `<textarea>` (row-view-dom.test.tsx's own
    technique), so a synthetic `input` event on this field never reaches
    React's onChange here. The draft is the same path a resumed gate's note
    takes in production, so this exercises the same submit code the note
    field's onChange would otherwise feed. */
function seedDraft(
  gateId: string,
  draft: {
    selections?: Record<string, string | string[]>;
    notes?: Record<string, string>;
    item?: string | null;
  }
) {
  localStorage.setItem(
    gateDraftKey(gateId),
    JSON.stringify({ selections: {}, notes: {}, item: null, ...draft })
  );
}

test('collapses findings-1/findings-2 into one six-row list with a full tally', async () => {
  await render();

  const rows = container.querySelectorAll('.tui-review-finding-row');
  expect(rows.length).toBe(6);

  const tally = container.querySelector('.tui-sheet-list-tally');
  expect(tally?.textContent).toContain('6 of 6 selected');
});

test('tier group headers show their counts', async () => {
  await render();

  const pills = [...container.querySelectorAll('.tui-review-tier-pill')].map(
    p => p.textContent?.trim()
  );
  expect(pills).toContain('Critical (1)');
  expect(pills).toContain('Important (3)');
  expect(pills).toContain('Minor (2)');
});

test('unchecking a finding updates the tally; the submit names the verdict alone', async () => {
  await render();

  const submitBefore = container.querySelector('.tui-sheet-submit');
  expect(submitBefore?.textContent).toBe('approve');

  const first = container.querySelector(
    '.tui-review-finding-row input[type="checkbox"]'
  ) as HTMLInputElement;
  expect(first.checked).toBe(true);
  await click(first);

  const tally = container.querySelector('.tui-sheet-list-tally');
  expect(tally?.textContent).toContain('5 of 6 selected');

  const submitAfter = container.querySelector('.tui-sheet-submit');
  expect(submitAfter?.textContent).toBe('approve');
});

test('the verdict radios form one radio group named by the question', async () => {
  await render();
  const group = container.querySelector(
    '[role="radiogroup"][aria-label="Verdict on !31"]'
  );
  expect(group?.querySelectorAll('input[type="radio"]').length).toBe(2);
});

test('the verdict renders as gate choices with the recommended badge', async () => {
  await render();

  const choices = container.querySelectorAll(
    '.tui-sheet-rail .tui-gate-choice'
  );
  expect(choices.length).toBe(2);

  const radios = [
    ...container.querySelectorAll('.tui-sheet-rail input[type=radio]'),
  ] as HTMLInputElement[];
  expect(radios.map(r => r.value).sort()).toEqual(['approve', 'comment']);
  expect(radios.find(r => r.value === 'approve')?.checked).toBe(true);

  const recommended = container.querySelector('[data-gate="recommended"]');
  expect(recommended).not.toBeNull();
  expect(recommended?.textContent?.trim()).toBe('recommended');
});

/** No findings question at all: the outcome question rides alone, and the
    sheet still renders since `readReviewGate`'s join only touches
    `findings-N` chunks when the gate actually has one. */
const CLEAN_GATE: GateRow = {
  ...GATE,
  gateId: 'g-clean',
  context: j({
    'gate-ctx': 'review@1',
    readiness: 'yes',
    summary: 'Nothing worth a thread.',
    findings: {},
  }),
  questions: [GATE.questions[2]!],
};

test('the previous-gate chevron is enabled past the first gate and calls its handler', async () => {
  let calls = 0;
  await render(undefined, {
    queueIndex: 1,
    onPrev: () => {
      calls++;
    },
  });

  const prev = container.querySelector(
    '[aria-label="previous gate"]'
  ) as HTMLButtonElement;
  expect(prev.disabled).toBe(false);
  await click(prev);
  expect(calls).toBe(1);
});

test('the previous-gate chevron is disabled at the first gate', async () => {
  await render(undefined, { queueIndex: 0 });

  const prev = container.querySelector(
    '[aria-label="previous gate"]'
  ) as HTMLButtonElement;
  expect(prev.disabled).toBe(true);
});

test('the head carries no skip-gate chip', async () => {
  await render();
  expect(
    [...container.querySelectorAll('button')].some(
      b => b.textContent?.trim() === 'skip gate'
    )
  ).toBe(false);
});

test('a clean review labels the submit with the outcome alone, never post 0', async () => {
  await render(CLEAN_GATE);

  expect(buttonByText('approve')).toBeDefined();
  expect(
    [...container.querySelectorAll('button')].some(b =>
      b.textContent?.includes('post 0')
    )
  ).toBe(false);
});

test('a note saved in an earlier draft posts as {value, note}, not silently dropped', async () => {
  seedDraft(GATE.gateId, { notes: { outcome: 'Merge once CI settles.' } });
  await render();

  await click(buttonByText('approve'));

  const answerPost = posts.find(p => p.url === '/gate/answer');
  expect(answerPost).toBeDefined();
  const body = answerPost!.body as { answers: Record<string, unknown> };
  expect(body.answers.outcome).toEqual({
    value: 'approve',
    note: 'Merge once CI settles.',
  });
  // The note wrap on outcome doesn't disturb the chunk split.
  expect(body.answers.findings).toBeUndefined();
  expect(body.answers['findings-1']).toEqual(['f1', 'f2', 'f3', 'f4']);
  expect(body.answers['findings-2']).toEqual(['f5', 'f6']);
});

test('a gate answered elsewhere offers continue, which retires it from the queue', async () => {
  answeredElsewhere = true;
  let continues = 0;
  await render(undefined, {
    onContinue: () => {
      continues++;
    },
  });
  await click(buttonByText('approve'));
  expect(container.querySelector('.tui-sheet-lost')!.textContent).toContain(
    'answered elsewhere'
  );
  await click(buttonByText('continue'));
  expect(continues).toBe(1);
});

test('an unchunked findings question posts its answer under its own id', async () => {
  const unchunked: GateRow = {
    ...GATE,
    gateId: 'g-unchunked',
    context: j({ ...REVIEW, findings: { important: 1, minor: 1 } }),
    questions: [
      {
        ...GATE.questions[1]!,
        id: 'findings',
      },
      GATE.questions[2]!,
    ],
  };
  await render(unchunked);

  await click(buttonByText('approve'));

  const answerPost = posts.find(p => p.url === '/gate/answer');
  const body = answerPost!.body as { answers: Record<string, unknown> };
  expect(body.answers).toEqual({ findings: ['f5', 'f6'], outcome: 'approve' });
});

test('a blank or whitespace-only note posts the bare selection, not an empty note', async () => {
  seedDraft(GATE.gateId, { notes: { outcome: '   ' } });
  await render();

  await click(buttonByText('approve'));

  const answerPost = posts.find(p => p.url === '/gate/answer');
  const body = answerPost!.body as { answers: Record<string, unknown> };
  expect(body.answers.outcome).toBe('approve');
});

test('the verdict dock has no reset and no note field', async () => {
  await render();
  const dock = container.querySelector('.tui-sheet-dock')!;
  expect(
    [...dock.querySelectorAll('button')].filter(b =>
      /reset/i.test(b.textContent ?? '')
    )
  ).toEqual([]);
  expect(dock.querySelector('.tui-gate-note')).toBeNull();
});

async function openReportTab() {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    b => b.textContent === 'Report'
  ) as HTMLButtonElement;
  await click(tab);
}

function checkboxForTitle(title: string): HTMLInputElement {
  const row = [...container.querySelectorAll('.tui-review-finding-row')].find(
    r => r.querySelector('.tui-review-finding-title')?.textContent === title
  );
  if (!row) throw new Error(`no finding row titled "${title}"`);
  return row.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

test('submit splits the checked union back into the original findings-1/findings-2 chunks, with an explicit [] for an emptied chunk', async () => {
  await render();

  // Both findings-2 rows unchecked: that chunk posts an explicit [], while
  // findings-1 (untouched) posts its full four-id union.
  await click(checkboxForTitle('Retry loop lacks backoff'));
  await click(checkboxForTitle('Inconsistent spacing'));

  await click(buttonByText('approve'));

  const answerPost = posts.find(p => p.url === '/gate/answer');
  expect(answerPost).toBeDefined();
  const body = answerPost!.body as { answers: Record<string, unknown> };
  expect(body.answers).toEqual({
    'findings-1': ['f1', 'f2', 'f3', 'f4'],
    'findings-2': [],
    outcome: 'approve',
  });
  expect(body.answers.findings).toBeUndefined();
});

test("a malformed report.json renders the sheet without throwing and skips the record cluster's bad parts", async () => {
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json')) {
      return new Response(
        JSON.stringify({
          depth: 'clean run, one flake unrelated to this change',
          strengths: 'not an array',
          checks: [{ tag: 'PASS' }, { tag: 'FAIL', text: 'real check' }],
          notes: 'also not an array',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  await render();
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await openReportTab();

  const labels = [
    ...container.querySelectorAll('.tui-review-record-label'),
  ].map(l => l.textContent);
  // strengths and notes are dropped whole (not arrays); the checks leave
  // the record for their own card, in the Report tab as in the rail.
  expect(labels).toEqual(['depth']);
  // The one malformed check entry (missing `text`) is dropped, the
  // well-typed one stays in the Report tab's checks card.
  const checks = container.querySelector('.tui-sheet-main .tui-review-checks')!;
  expect(checks.textContent).toContain('real check');
  expect(checks.querySelector('.tui-review-checks-tally')!.textContent).toBe(
    '1 fail'
  );
  expect(container.textContent).not.toContain('not an array');
});

const RE_REVIEW_GATE: GateRow = {
  ...GATE,
  gateId: 'g-re-review',
  context: j({
    ...REVIEW,
    summary: 'One important finding carried over; the rest are cleanups.',
    findings: { critical: 0, important: 1, minor: 2 },
    round: 2,
    re_review: true,
    prior: { addressed: 3, still_open: 1 },
  }),
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      context: findingsCtx(
        { ...E.f2, disposition: 'still-open', kind: 'follow-up' },
        { ...E.f4, disposition: 'new' },
        entry('f7', 'minor', 'Changelog entry missing', undefined, undefined, {
          disposition: 'addressed-check',
        })
      ),
      options: [
        {
          value: 'f2',
          label: '[Important] Missing null check on response',
          description:
            'lib/api/client.ts:88 · guard before dereferencing · kind:follow-up',
        },
        GATE.questions[0]!.options[3]!,
        {
          value: 'f7',
          label: '[Minor] Changelog entry missing',
          description: 'not inline-anchorable',
        },
      ],
    },
    GATE.questions[2]!,
  ],
};

test('a row reads title, accent file:line, the full body, and the fix line, in that order', async () => {
  await render();
  const row = container.querySelector('.tui-review-finding-row')!;
  const parts = [
    ...row.querySelectorAll(
      '.tui-review-finding-title, .tui-review-finding-anchor, .tui-review-finding-text, .tui-review-finding-fix'
    ),
  ].map(el => el.className);
  expect(parts).toEqual([
    'tui-review-finding-title',
    'tui-review-finding-anchor',
    'tui-review-finding-text',
    'tui-review-finding-fix',
  ]);
  expect(row.querySelector('.tui-review-finding-title')!.textContent).toBe(
    'SQL built from unsanitized input'
  );
  expect(row.querySelector('.tui-review-finding-anchor')!.textContent).toBe(
    'lib/db/query.ts:42'
  );
  expect(row.querySelector('.tui-review-finding-dir')!.textContent).toBe(
    'lib/db/'
  );
  expect(row.querySelector('.tui-review-finding-file')!.textContent).toBe(
    'query.ts:42'
  );
  expect(row.querySelector('.tui-review-finding-text')!.textContent).toContain(
    'SQL built from unsanitized input: the full finding text, never truncated.'
  );
  expect(row.querySelector('.tui-review-finding-fix')!.textContent).toBe(
    'parameterize the query'
  );
});

test("a finding row's checkbox is labelled by the title alone, not the whole row", async () => {
  await render();
  const row = container.querySelector('.tui-review-finding-row')!;
  const checkbox = row.querySelector('input[type="checkbox"]')!;
  const labelledBy = checkbox.getAttribute('aria-labelledby');
  expect(labelledBy).toBeTruthy();
  const label = document.getElementById(labelledBy!);
  expect(label).toBe(row.querySelector('.tui-review-finding-title'));
  expect(label!.textContent).toBe('SQL built from unsanitized input');
});

/** findings-1's first option is a minor finding, not the critical one GATE
    leads with: a grouping that follows first-appearance order would put
    Minor first here, so this is the case that actually distinguishes
    severity order from arrival order. */
const MINOR_FIRST_GATE: GateRow = {
  ...GATE,
  gateId: 'g-minor-first',
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      context: findingsCtx(E.f1, E.f2, E.f3, E.f4),
      options: [
        GATE.questions[0]!.options[3]!,
        GATE.questions[0]!.options[0]!,
        GATE.questions[0]!.options[1]!,
        GATE.questions[0]!.options[2]!,
      ],
    },
    GATE.questions[1]!,
    GATE.questions[2]!,
  ],
};

test('groups follow the severity order, whatever order the options arrive in', async () => {
  await render(MINOR_FIRST_GATE);
  const groups = [
    ...container.querySelectorAll(
      '.tui-review-tier-group .tui-review-tier-pill'
    ),
  ].map(p => p.textContent);
  expect(groups).toEqual(['Critical (1)', 'Important (3)', 'Minor (2)']);
});

test('a row with no file shows no anchor line, and no pill without a disposition', async () => {
  await render(RE_REVIEW_GATE);
  const rows = [...container.querySelectorAll('.tui-review-finding-row')];
  const changelog = rows.find(r =>
    r.textContent?.includes('Changelog entry missing')
  )!;
  expect(changelog.querySelector('.tui-review-finding-anchor')).toBeNull();
  await render();
  expect(
    container.querySelector('.tui-review-finding-row [data-disposition]')
  ).toBeNull();
});

test('a disposition renders as a small state pill on its row', async () => {
  await render(RE_REVIEW_GATE);
  const pills = Object.fromEntries(
    [
      ...container.querySelectorAll(
        '.tui-review-finding-row [data-disposition]'
      ),
    ].map(p => [
      p.getAttribute('data-disposition'),
      [p.textContent, p.getAttribute('data-hue')],
    ])
  );
  expect(pills).toEqual({
    'still-open': ['waiting on author', 'amber'],
    new: ['new', 'accent'],
    'addressed-check': ['author says fixed', 'green'],
  });
});

test('a kind renders as a grey pill on its row, and a row without one has none', async () => {
  await render(RE_REVIEW_GATE);
  const rows = [...container.querySelectorAll('.tui-review-finding-row')];
  const pills = rows.map(r => {
    const p = r.querySelector('.tui-respond-pill[data-kind]');
    return p && [p.textContent, p.getAttribute('data-hue')];
  });
  expect(pills).toEqual([['follow-up', null], null, null]);
});

test('the decision card reads readiness, summary, counts, and the re-review line from review@1', async () => {
  await render(RE_REVIEW_GATE);
  expect(container.querySelector('.tui-sheet-context-lead')!.textContent).toBe(
    'Ready to merge: with fixes'
  );
  expect(
    container.querySelector('.tui-sheet-context-reasoning')!.textContent
  ).toContain('One important finding carried over; the rest are cleanups.');
  expect(container.querySelector('.tui-sheet-context-meta')!.textContent).toBe(
    'renee · round 2 · 3 addressed, 1 waiting on author'
  );
  const railPills = [
    ...container.querySelectorAll('.tui-sheet-context-card .tui-review-sev'),
  ].map(p => p.textContent);
  expect(railPills).toEqual(['Important1', 'Minor2']);
});

test('a first-round review has no meta line beyond the reviewer', async () => {
  await render();
  expect(container.querySelector('.tui-sheet-context-meta')!.textContent).toBe(
    'renee'
  );
});

test("report.json's summary never reaches the decision card", async () => {
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json'))
      return new Response(
        JSON.stringify({
          summary: { readiness: 'no', reasoning: 'from the report file' },
          depth: 'verify. suite green',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await render();
  await React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await openReportTab();
  expect(container.querySelector('.tui-sheet-context-lead')!.textContent).toBe(
    'Ready to merge: with fixes'
  );
  expect(container.textContent).not.toContain('from the report file');
  expect(container.textContent).toContain('verify. suite green');
});

test('a gate the join rejects renders nothing', async () => {
  await render({ ...GATE, context: 'prose' });
  expect(container.querySelector('.tui-review-sheet')).toBeNull();
});

test('the verdict dock and the lost panel each reserve their height on the scroller', async () => {
  const restore = installFakeResizeObserver();
  try {
    answeredElsewhere = true;
    await render();
    expect(await reserveOf('.tui-sheet-dock', 294)).toBe('294px');
    await click(buttonByText('approve'));
    expect(await reserveOf('.tui-sheet-lost', 332)).toBe('332px');
  } finally {
    restore();
  }
});

describe('a later round', () => {
  /** Every earlier thread here has an author reply, so the "never answered"
      line appears only where a test drops one. */
  const EARLIER: Array<{
    thread: string;
    file: string;
    round: number;
    call: string;
    original: string;
    authorReply: string;
    note?: string;
    reply: string;
  }> = [
    {
      thread: 'd-query',
      file: 'lib/db/query.ts:42',
      round: 1,
      call: 'fixed',
      original: 'the search handler puts the raw `q` into the WHERE clause.',
      authorReply: 'Switched to a parameterized query, with a test.',
      note: 'query.ts:42 now binds $1',
      reply: "Thanks, that's the fix. Resolving.",
    },
    {
      thread: 'd-retry',
      file: 'lib/retry.ts:41',
      round: 2,
      call: 'not-fixed',
      original: 'the loop retries immediately up to five times.',
      authorReply: 'Added exponential backoff.',
      note: 'an aborted request still goes round the loop at retry.ts:58',
      reply: 'The backoff looks good; an aborted request still retries.',
    },
    {
      thread: 'd-errors',
      file: 'lib/errors.ts:15',
      round: 2,
      call: 'pushback-accepted',
      original: 'two of the new messages end in a period.',
      authorReply: "These copy the upstream API's strings word for word.",
      reply: 'Makes sense, matching the API is the better call. Resolving.',
    },
    {
      thread: 'd-client',
      file: 'lib/api/client.ts:88',
      round: 1,
      call: 'pushback-rejected',
      original: 'a 204 from the upstream returns no body.',
      authorReply: 'The upstream never sends a 204 here.',
      reply: 'The upstream docs list a 204 for an empty page.',
    },
  ];

  const settled = (call: string) =>
    call === 'fixed' || call === 'pushback-accepted';

  /** No title here matches a new finding's (f5, f6), or a skipped title
      showing up among the new findings could not be told apart. */
  const SKIPPED = [
    {
      id: 'r1-f4',
      round: 1,
      severity: 'minor',
      title: 'Unused import',
      file: 'lib/utils.ts:3',
      changed: false,
    },
    {
      id: 'r1-f9',
      round: 1,
      severity: 'minor',
      title: 'Page size is a magic number',
      file: 'lib/paging.ts:9',
      changed: true,
    },
    {
      id: 'r2-f3',
      round: 2,
      severity: 'important',
      title: 'Config defaults live in two files',
      changed: false,
    },
  ];

  const SKIPPED_QUESTION: GateQuestion = {
    id: 'skipped-1',
    label: 'Bring back a finding you skipped earlier?',
    multi: true,
    context: j({ 'gate-ctx': 'skipped@1', skipped: SKIPPED }),
    options: SKIPPED.map(s => ({
      value: `restore:${s.id}`,
      label: `[${s.severity[0]!.toUpperCase()}${s.severity.slice(1)}] ${s.title}`,
      description: [
        s.file,
        `skipped in round ${s.round}`,
        s.changed ? 'code changed since' : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
  };

  function roundThreeGate({
    dropAuthorReplyOn,
  }: { dropAuthorReplyOn?: number } = {}): GateRow {
    const threads: GateQuestion[] = EARLIER.map(
      ({ authorReply, ...carry }, i) => ({
        id: `thread-${i + 1}`,
        label: carry.file,
        multi: true,
        context: j({
          'gate-ctx': 'carryover@1',
          ...carry,
          ...(i === dropAuthorReplyOn ? {} : { authorReply }),
        }),
        options: [
          { value: `post:${carry.thread}`, label: 'Post reply (recommended)' },
          {
            value: `resolve:${carry.thread}`,
            label: settled(carry.call)
              ? 'Resolve thread (recommended)'
              : 'Resolve thread',
          },
        ],
      })
    );
    return {
      ...GATE,
      gateId: 'g-round-three',
      context: j({
        ...REVIEW,
        summary: 'The injection fix landed; an aborted request still retries.',
        findings: { important: 1, minor: 1 },
        round: 3,
        re_review: true,
      }),
      questions: [
        ...threads,
        { ...GATE.questions[1]!, id: 'findings-1' },
        SKIPPED_QUESTION,
        GATE.questions[2]!,
      ],
    };
  }

  function submitted() {
    const post = posts.findLast(p => p.url === '/gate/answer');
    if (!post) throw new Error('nothing was submitted');
    return post.body as { answers: Record<string, unknown> };
  }

  function renderSheet(gate: GateRow) {
    React.act(() => {
      root.render(<Host gate={gate} />);
    });
    return { container, submitted };
  }

  const fileFor = (call: string) => EARLIER[earlierIndex(call)]!.file;

  const cardFor = (scope: Element, call: string) =>
    scope.querySelector<HTMLElement>(
      `article.tui-reply-card[aria-label="${fileFor(call)}"]`
    )!;

  const tickFor = (scope: Element, call: string, value: 'post' | 'resolve') =>
    cardFor(scope, call).querySelector<HTMLInputElement>(
      `input[aria-label="${fileFor(call)}: ${
        value === 'post' ? 'post reply' : 'resolve thread'
      }"]`
    );

  const earlierCards = (scope: Element) => [
    ...scope.querySelectorAll<HTMLElement>(
      '.tui-respond-list > article.tui-reply-card'
    ),
  ];

  async function untick(
    scope: Element,
    call: string,
    value: 'post' | 'resolve'
  ) {
    const box = tickFor(scope, call, value)!;
    if (!box.checked) throw new Error(`${call} ${value} is not ticked`);
    await React.act(async () => box.click());
  }

  async function editReply(scope: Element, call: string, text: string) {
    const card = cardFor(scope, call);
    await React.act(async () => {
      card.querySelector<HTMLElement>('.tui-cte-view')!.click();
    });
    const box = card.querySelector<HTMLTextAreaElement>(
      'textarea.tui-composer-input'
    )!;
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  const submit = (scope: Element) =>
    click(scope.querySelector('.tui-sheet-submit')!);

  function earlierIndex(call: string): number {
    const i = EARLIER.findIndex(c => c.call === call);
    if (i < 0) throw new Error(`no earlier thread called ${call}`);
    return i;
  }

  const threadNameFor = (call: string) => `thread-${earlierIndex(call) + 1}`;

  const postValueFor = (call: string) =>
    `post:${EARLIER[earlierIndex(call)]!.thread}`;

  async function openSkipped(scope: Element) {
    const head = scope.querySelector<HTMLElement>('.tui-review-skipped-head')!;
    if (head.getAttribute('aria-expanded') !== 'false')
      throw new Error('skipped earlier is not closed');
    await click(head);
  }

  async function tickSkipped(scope: Element, n: number) {
    const box = scope.querySelectorAll<HTMLInputElement>(
      '.tui-review-skipped-row input[type="checkbox"]'
    )[n];
    if (!box) throw new Error(`no skipped row ${n}`);
    if (box.checked) throw new Error(`skipped row ${n} is already ticked`);
    await click(box);
  }

  test('the main column opens with the review heading, its round on the timeline', () => {
    const { container } = renderSheet(roundThreeGate());
    const heading = container.querySelector('.tui-sheet-round')!;
    expect(heading.querySelector('.tui-sheet-round-n')!.textContent).toBe(
      "Review Paul's MR"
    );
    const chip = heading.querySelector('.tui-tl-round-chip')!;
    expect(chip.textContent).toBe('Round 3');
    expect(chip.hasAttribute('data-menu')).toBe(true);
    expect(
      [...heading.querySelectorAll('.tui-tl-step')].map(li => [
        li.textContent,
        li.getAttribute('data-state'),
      ])
    ).toEqual([
      ['Your review', 'current'],
      ["Paul's response", 'next'],
    ]);
    expect(heading.querySelector('.tui-sheet-round-summary')).toBeNull();
  });

  test('each earlier thread is a card naming who acts', () => {
    const { container } = renderSheet(roundThreeGate());
    const cards = earlierCards(container);
    expect(cards.map(c => c.getAttribute('aria-label'))).toEqual(
      EARLIER.map(c => c.file)
    );
    const marks = cards.map(
      c => c.querySelector('.tui-reply-head .tui-reply-status')!.textContent
    );
    for (const mark of marks) expect(mark).not.toMatch(/open|unresolved/i);
    expect(marks).toEqual([
      'Fixed',
      'Waiting on author',
      'Pushback accepted',
      'Holding firm',
    ]);
  });

  test('neither the round heading nor the earlier threads heading says open or unresolved', () => {
    const { container } = renderSheet(roundThreeGate());
    const round = container.querySelector('.tui-sheet-round')!.textContent!;
    const earlier = [
      ...container.querySelectorAll('.tui-sheet-list-head'),
    ].find(h =>
      h
        .querySelector('.tui-sheet-list-title')
        ?.textContent?.startsWith('Earlier threads')
    )!.textContent!;
    expect(round).toContain('Round 3');
    expect(earlier).toContain(`Earlier threads (${EARLIER.length})`);
    for (const text of [round, earlier])
      expect(text).not.toMatch(/open|unresolved/i);
  });

  test('a thread the author never answered says so', () => {
    const { container } = renderSheet(roundThreeGate({ dropAuthorReplyOn: 0 }));
    const silent = cardFor(container, EARLIER[0]!.call);
    const said = [...silent.querySelectorAll('.tui-reply-silence')];
    expect(said).toHaveLength(1);
    expect(said[0]!.textContent).toBe('No reply from author');
    const answered = earlierCards(container).filter(c => c !== silent);
    expect(answered).toHaveLength(EARLIER.length - 1);
    for (const card of answered)
      expect(card.querySelector('.tui-reply-silence')).toBeNull();
  });

  test('a fixed thread starts with post and resolve ticked; a waiting one with post only', () => {
    const { container } = renderSheet(roundThreeGate());
    const ticks = (call: string) =>
      [
        ...cardFor(container, call).querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]'
        ),
      ].map(i => [i.getAttribute('aria-label'), i.checked]);
    expect(ticks('fixed')).toEqual([
      [`${fileFor('fixed')}: post reply`, true],
      [`${fileFor('fixed')}: resolve thread`, true],
    ]);
    expect(ticks('not-fixed')).toEqual([
      [`${fileFor('not-fixed')}: post reply`, true],
      [`${fileFor('not-fixed')}: resolve thread`, false],
    ]);
  });

  test('submitting sends each thread its picked values, and an edited reply as text', async () => {
    const { container, submitted } = renderSheet(roundThreeGate());
    await untick(container, 'fixed', 'resolve');
    await editReply(container, 'fixed', 'Looks right now.');
    await submit(container);
    const answer = submitted().answers;
    const fixed = answer[threadNameFor('fixed')];
    expect(fixed).toEqual({
      value: [postValueFor('fixed')],
      text: 'Looks right now.',
    });
    const waiting = answer[threadNameFor('not-fixed')];
    expect(waiting).toEqual([postValueFor('not-fixed')]);
  });

  describe('skipped earlier', () => {
    test('the row is closed, counts its findings, and ticks nothing', () => {
      const { container } = renderSheet(roundThreeGate());
      const row = container.querySelector('.tui-review-skipped')!;
      expect(
        row
          .querySelector('.tui-review-skipped-head')!
          .getAttribute('aria-expanded')
      ).toBe('false');
      expect(row.querySelector('.tui-review-skipped-count')!.textContent).toBe(
        '3'
      );
      expect(row.querySelector('.tui-review-skipped-hint')!.textContent).toBe(
        'you chose not to raise these · tick one to bring it back'
      );
      const boxes = [
        ...row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      ];
      expect(boxes).toHaveLength(SKIPPED.length);
      expect(boxes.some(i => i.checked)).toBe(false);
    });

    test('a finding whose code moved says so', () => {
      const { container } = renderSheet(roundThreeGate());
      expect(
        container.querySelector('.tui-review-skipped-changed')!.textContent
      ).toBe('code changed since');
    });

    test('ticking one marks it coming back and sends its restore value', async () => {
      const { container, submitted } = renderSheet(roundThreeGate());
      await openSkipped(container);
      await tickSkipped(container, 0);
      expect(
        container.querySelector('.tui-review-skipped-restoring')!.textContent
      ).toBe('coming back this round');
      expect(
        container.querySelector('.tui-review-skipped-hint')!.textContent
      ).toBe('1 coming back this round');
      await submit(container);
      const answers = submitted().answers;
      expect(answers['skipped-1']).toEqual([`restore:${SKIPPED[0]!.id}`]);
      expect(Object.hasOwn(answers, 'skipped')).toBe(false);
      const restored = Object.entries(answers)
        .filter(([k]) => k.startsWith('skipped'))
        .flatMap(([, v]) => v as string[]);
      expect(restored).toEqual([`restore:${SKIPPED[0]!.id}`]);
    });

    test('a skipped finding never appears among the new findings', () => {
      const { container } = renderSheet(roundThreeGate());
      const newTitles = [
        ...container.querySelectorAll(
          '.tui-review-find-list .tui-review-finding-title'
        ),
      ].map(n => n.textContent);
      const skippedTitles = [
        ...container.querySelectorAll(
          '.tui-review-skipped .tui-review-finding-title'
        ),
      ].map(n => n.textContent);
      expect(newTitles.length).toBeGreaterThan(0);
      expect(skippedTitles).toHaveLength(SKIPPED.length);
      for (const t of skippedTitles) expect(newTitles).not.toContain(t);
    });
  });
});

describe('a gate whose poster honors edited drafts', () => {
  const COMMENT = {
    f1: 'Hi! The query on line 42 splices user input straight into SQL. Could we bind it as a parameter instead?\n\nA test with a quote in the name would pin it.',
    f2: 'Small one: the response can be null here when the upstream times out.',
    f3: 'The error copy in this MR mixes two styles; the guide picks the short one.',
    f4: 'Nit: this import is unused now.',
  };
  const SUMMARY = 'Thanks! One real issue inline, the rest are small.';
  const SUMMARY_COMMENT =
    'Thanks! One real issue inline; holding the merge call until it lands.';

  function draftsGate(
    over: {
      editable?: boolean;
      round?: number;
      summaryComments?: Record<string, string>;
    } = {}
  ): GateRow {
    const editable = over.editable ?? true;
    return {
      ...GATE,
      gateId: 'g-review-drafts',
      context: j({
        ...REVIEW,
        findings: { critical: 1, important: 2, minor: 1 },
        ...(over.round !== undefined ? { round: over.round } : {}),
        ...(editable ? { editable: true } : {}),
        summaryComments: over.summaryComments ?? {
          approve: SUMMARY,
          comment: SUMMARY_COMMENT,
        },
      }),
      questions: [
        {
          ...GATE.questions[0]!,
          context: findingsCtx(
            { ...E.f1, comment: COMMENT.f1 },
            { ...E.f2, comment: COMMENT.f2 },
            entry(
              'f3',
              'important',
              'Inconsistent error wording',
              undefined,
              'align with the style guide',
              { comment: COMMENT.f3 }
            ),
            { ...E.f4, comment: COMMENT.f4 }
          ),
        },
        GATE.questions[2]!,
      ],
    };
  }

  const itemFor = (title: string): Element => {
    const item = [...container.querySelectorAll('.tui-review-finding')].find(
      r => r.querySelector('.tui-review-finding-title')?.textContent === title
    );
    if (!item) throw new Error(`no finding titled "${title}"`);
    return item;
  };

  async function edit(scope: Element, text: string) {
    let box = scope.querySelector<HTMLTextAreaElement>(
      'textarea.tui-composer-input'
    );
    if (!box) {
      await React.act(async () => {
        scope.querySelector<HTMLElement>('.tui-cte-view')!.click();
      });
      box = scope.querySelector<HTMLTextAreaElement>(
        'textarea.tui-composer-input'
      );
    }
    await React.act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(box!, text);
      box!.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  /** What each comment field in `scope` holds: the raw text while it is
      open, the rendered text at rest. */
  const valueOf = (scope: Element | null | undefined) =>
    [...(scope?.querySelectorAll('.tui-cte') ?? [])]
      .map(
        f =>
          f.querySelector('textarea')?.value ??
          f.querySelector('.tui-cte-view')?.textContent ??
          ''
      )
      .join('\n');

  const answers = () =>
    (
      posts.find(p => p.url === '/gate/answer')!.body as {
        answers: Record<string, unknown>;
      }
    ).answers;

  const submitButton = () =>
    container.querySelector('.tui-sheet-submit') as HTMLButtonElement;

  const sectionOf = (item: Element, name: string) =>
    item.querySelector(`.tui-review-section[aria-label="${name}"]`);

  test('a ticked finding is one card: head, code, then the comment, with no section heads', async () => {
    await render(draftsGate());
    const item = itemFor('SQL built from unsanitized input');
    expect(item.tagName).toBe('ARTICLE');
    const head = item.querySelector('.tui-review-card-head')!;
    expect(head.tagName).toBe('LABEL');
    expect(head.classList.contains('tui-review-finding-row')).toBe(true);
    expect(head.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(head.querySelector('.tui-review-sev')!.textContent).toBe('Critical');
    expect(item.querySelector('.tui-review-section-name')).toBeNull();
    expect(sectionOf(item, 'Agent Finding')).toBeNull();
    expect(
      sectionOf(item, 'The Code')!.querySelector('.tui-review-code-path')!
        .textContent
    ).toBe('lib/db/query.ts:42');
    expect(
      sectionOf(item, 'The Code')!.querySelector('.tui-review-code-fold')
    ).not.toBeNull();
    expect(sectionOf(item, 'Comment')).not.toBeNull();
    expect(item.querySelector('.tui-review-finding-anchor')).toBeNull();
  });

  test('an unticked finding shows its header only', async () => {
    await render(draftsGate());
    await click(checkboxForTitle('Unused import'));
    const item = itemFor('Unused import');
    expect(item.hasAttribute('data-off')).toBe(true);
    expect(item.querySelector('.tui-review-section')).toBeNull();
    expect(item.querySelector('.tui-review-card-head')).not.toBeNull();
  });

  test('drafted cards form one flat list in severity order, with no tier heads', async () => {
    await render(draftsGate());
    const list = container.querySelector('.tui-review-find-list')!;
    expect(
      list.querySelectorAll('.tui-review-tier-items > .tui-review-card').length
    ).toBe(4);
    expect(container.querySelector('.tui-review-tier-head')).toBeNull();
    expect(container.querySelector('.tui-review-allnone')).toBeNull();
    expect(
      [...list.querySelectorAll('.tui-review-card-head .tui-review-sev')].map(
        n => n.textContent
      )
    ).toEqual(['Critical', 'Important', 'Important', 'Minor']);
    expect(container.querySelector('.tui-sheet-list-tally')!.textContent).toBe(
      'Posting 4 of 4'
    );
  });

  test('each ticked anchored finding reads its whole draft as the comment, with no fix line', async () => {
    await render(draftsGate());
    const box = sectionOf(
      itemFor('SQL built from unsanitized input'),
      'Comment'
    )!;
    expect(box.querySelector('.tui-cte-view')).not.toBeNull();
    expect(box.querySelector('textarea')).toBeNull();
    expect(box.querySelector('.tui-cte-hint')!.textContent).toBe(
      'Click to edit'
    );
    expect(valueOf(box)).toContain('Could we bind it as a parameter instead?');
    expect(valueOf(box)).toContain(
      'A test with a quote in the name would pin it.'
    );
    await React.act(async () => {
      box.querySelector<HTMLElement>('.tui-cte-view')!.click();
    });
    expect(box.querySelector('.tui-cte-hint')!.textContent).toBe(
      'Markdown supportedesc to finish'
    );
    expect(container.querySelector('.tui-review-finding-fix')).toBeNull();
  });

  test('unticking hides the comment, and re-ticking brings back the earlier edit', async () => {
    await render(draftsGate());
    await edit(itemFor('Unused import'), 'Drop this import, please.');
    await click(checkboxForTitle('Unused import'));
    expect(itemFor('Unused import').querySelector('.tui-cte')).toBeNull();
    expect(itemFor('Unused import').hasAttribute('data-off')).toBe(true);
    await click(checkboxForTitle('Unused import'));
    const item = itemFor('Unused import');
    expect(valueOf(sectionOf(item, 'Comment'))).toContain(
      'Drop this import, please.'
    );
    expect(sectionOf(item, 'Comment')!.hasAttribute('data-edited')).toBe(true);
  });

  test('an edited comment rides its chunk answer as texts', async () => {
    await render(draftsGate());
    await edit(itemFor('Unused import'), '\nDrop this import, please. ');
    await click(submitButton());
    expect(answers()).toEqual({
      'findings-1': {
        value: ['f1', 'f2', 'f3', 'f4'],
        texts: { f4: 'Drop this import, please.' },
      },
      outcome: 'approve',
    });
  });

  test('an edited summary line rides the outcome as text', async () => {
    await render(draftsGate());
    await edit(summaryLine(), 'New summary.');
    await click(submitButton());
    expect(answers().outcome).toEqual({
      value: 'approve',
      text: 'New summary.',
    });
  });

  const summaryLine = () =>
    container.querySelector('.tui-review-dock-summary')!;

  const pickVerdict = async (value: string) =>
    click(
      [...container.querySelectorAll('input[type=radio]')].find(
        i => (i as HTMLInputElement).value === value
      )!
    );

  test("the summary box shows the selected verdict's draft and swaps with the verdict", async () => {
    await render(draftsGate());
    expect(valueOf(summaryLine())).toContain(SUMMARY);
    await pickVerdict('comment');
    expect(valueOf(summaryLine())).toContain(SUMMARY_COMMENT);
    expect(valueOf(summaryLine())).not.toContain(SUMMARY);
  });

  test('each verdict keeps its own edit: switching away and back restores it', async () => {
    await render(draftsGate());
    await edit(summaryLine(), 'Approve, edited.');
    await pickVerdict('comment');
    expect(valueOf(summaryLine())).toContain(SUMMARY_COMMENT);
    expect(valueOf(summaryLine())).not.toContain('Approve, edited.');
    expect(
      container.querySelector('.tui-review-dock-summary[data-edited]')
    ).toBeNull();
    await pickVerdict('approve');
    expect(valueOf(summaryLine())).toContain('Approve, edited.');
    expect(
      container.querySelector('.tui-review-dock-summary[data-edited]')
    ).not.toBeNull();
  });

  test('submitting under comment sends no approve edit', async () => {
    await render(draftsGate());
    await edit(summaryLine(), 'Approve, edited.');
    await pickVerdict('comment');
    await click(submitButton());
    expect(answers().outcome).toBe('comment');
  });

  test("the comment verdict's edit rides as text only when it differs from the comment draft", async () => {
    await render(draftsGate());
    await pickVerdict('comment');
    await edit(summaryLine(), `\n${SUMMARY_COMMENT}\n`);
    await click(submitButton());
    expect(answers().outcome).toBe('comment');
  });

  test("the comment verdict's changed edit rides as text", async () => {
    await render(draftsGate());
    await edit(summaryLine(), 'Approve, edited.');
    await pickVerdict('comment');
    await edit(summaryLine(), '\nComment, edited. ');
    await click(submitButton());
    expect(answers().outcome).toEqual({
      value: 'comment',
      text: 'Comment, edited.',
    });
  });

  test('a blank summary edit blocks submit only while its verdict is selected', async () => {
    await render(draftsGate());
    await edit(summaryLine(), '   ');
    expect(submitButton().disabled).toBe(true);
    await pickVerdict('comment');
    expect(submitButton().disabled).toBe(false);
  });

  test('a three-verdict gate shows the request_changes draft and submits its edit', async () => {
    const REQUEST = 'Thanks! The SQL path needs a fix before this merges.';
    const gate = draftsGate({
      summaryComments: {
        approve: SUMMARY,
        comment: SUMMARY_COMMENT,
        request_changes: REQUEST,
      },
    });
    const outcome = gate.questions[1]!;
    gate.questions[1] = {
      ...outcome,
      options: [
        ...outcome.options,
        { value: 'request_changes', label: 'request changes' },
      ],
    };
    await render(gate);
    await pickVerdict('request_changes');
    expect(valueOf(summaryLine())).toContain(REQUEST);
    await edit(summaryLine(), '\nNeeds the SQL fix first. ');
    await click(submitButton());
    expect(answers().outcome).toEqual({
      value: 'request_changes',
      text: 'Needs the SQL fix first.',
    });
  });

  test('a verdict question not named outcome is still the verdict', async () => {
    const gate = draftsGate();
    gate.questions[1] = { ...gate.questions[1]!, id: 'verdict' };
    await render(gate);
    expect(valueOf(summaryLine())).toContain(SUMMARY);
    await edit(summaryLine(), 'Approve, edited.');
    await click(submitButton());
    expect(answers().verdict).toEqual({
      value: 'approve',
      text: 'Approve, edited.',
    });
  });

  test('a summary draft missing for a verdict leaves the sheet read-only', async () => {
    await render(draftsGate({ summaryComments: { approve: SUMMARY } }));
    expect(container.querySelector('.tui-review-dock-summary')).toBeNull();
    expect(container.querySelector('.tui-cte')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });

  test('a blank comment disables submit', async () => {
    await render(draftsGate());
    await edit(itemFor('Unused import'), '   ');
    expect(submitButton().disabled).toBe(true);
  });

  test('the summary lives in the verdict dock, above submit, and not in the main column', async () => {
    await render(draftsGate());
    const dock = container.querySelector('.tui-sheet-dock')!;
    const card = dock.querySelector('.tui-review-dock-summary')!;
    expect(card.tagName).toBe('SECTION');
    expect(card.getAttribute('aria-label')).toBe('Review comment');
    expect(
      card.querySelector('.tui-review-dock-summary-title')!.textContent
    ).toBe('Review comment');
    expect(card.querySelector('.tui-review-section-meta')!.textContent).toBe(
      'posts on !31'
    );
    expect(
      card.compareDocumentPosition(dock.querySelector('.tui-sheet-submit')!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      container.querySelector('.tui-sheet-main .tui-review-dock-summary')
    ).toBeNull();
    expect(
      container.querySelector('.tui-sheet-dock-heading')!.textContent
    ).toBe('Verdict on !31');
    expect(valueOf(card)).toBe(SUMMARY);
    expect(container.querySelector('.tui-review-summary')).toBeNull();
  });

  test('the heading leads, then the tabs, then the findings list', async () => {
    await render(draftsGate({ round: 2 }));
    const main = container.querySelector('.tui-sheet-main')!;
    expect(main.firstElementChild?.className).toBe('tui-sheet-round');
    expect(
      main.firstElementChild?.querySelector('.tui-tl-round-chip')?.textContent
    ).toBe('Round 2');
    expect(main.children[1]?.getAttribute('role')).toBe('tablist');
    expect(
      main.children[2]?.querySelector('.tui-sheet-list-title')?.textContent
    ).toBe('Post which findings to !31?');
  });

  test('with no MR the dock heading names no target and the summary has no posting target', async () => {
    await render(draftsGate(), { noMr: true });
    expect(
      container.querySelector('.tui-sheet-dock-heading')!.textContent
    ).toBe('Verdict');
    expect(
      container.querySelector(
        '.tui-review-dock-summary .tui-review-section-meta'
      )
    ).toBeNull();
  });

  test('a no-diff-line finding shows what it found in place of code, with a comment of its own and no in-summary chip', async () => {
    await render(draftsGate());
    const item = itemFor('Inconsistent error wording');
    expect(item.querySelector('[data-section="code"]')).toBeNull();
    expect(
      item.querySelector('[data-section="finding"] .tui-review-finding-said')!
        .textContent
    ).toBe(
      'Inconsistent error wording: the full finding text, never truncated.'
    );
    expect(item.querySelector('.tui-review-code-file')).toBeNull();
    expect(container.querySelector('.tui-review-in-summary')).toBeNull();
    expect(valueOf(sectionOf(item, 'Comment'))).toContain(COMMENT.f3);
    expect(
      container.querySelector('.tui-review-dock-summary')!.textContent
    ).not.toContain('Inconsistent error wording');
  });

  test('a no-diff-line finding has no Remove button; unticking drops its comment', async () => {
    await render(draftsGate());
    expect(
      container.querySelector('button[aria-label$=": remove"]')
    ).toBeNull();
    await click(checkboxForTitle('Inconsistent error wording'));
    const item = itemFor('Inconsistent error wording');
    expect(item.querySelector('.tui-cte')).toBeNull();
    expect(
      container.querySelectorAll('.tui-review-dock-summary .tui-cte').length
    ).toBe(1);
  });

  test('the submit label names the verdict alone, whatever is ticked', async () => {
    await render(draftsGate());
    expect(submitButton().textContent).toBe('approve');
    await click(checkboxForTitle('Unused import'));
    await click(checkboxForTitle('Missing null check on response'));
    expect(submitButton().textContent).toBe('approve');
  });

  const metaOf = (scope: Element) =>
    scope.querySelector('.tui-review-section-meta')?.textContent;

  test('every comment reads rendered at rest, a click-to-edit textbox named for what it edits', async () => {
    await render(draftsGate());
    expect(container.querySelector('textarea')).toBeNull();
    const labels = [
      ...container.querySelectorAll<HTMLElement>(
        '.tui-cte-view[role="textbox"]'
      ),
    ].map(t => t.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Comment on SQL built from unsanitized input',
      'Comment on Missing null check on response',
      'Comment on Inconsistent error wording',
      'Comment on Unused import',
      'Summary line',
    ]);
    expect(metaOf(itemFor('Unused import'))).toBeUndefined();
  });

  test('a click opens a comment as a textarea holding the raw draft; blur renders it again', async () => {
    await render(draftsGate());
    const section = sectionOf(itemFor('Unused import'), 'Comment')!;
    await React.act(async () => {
      section.querySelector<HTMLElement>('.tui-cte-view')!.click();
    });
    const box = section.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(box.value).toBe(COMMENT.f4);
    expect(box.getAttribute('aria-label')).toBe('Comment on Unused import');
    await React.act(async () => {
      box.blur();
    });
    expect(
      section.querySelector('.tui-cte')!.hasAttribute('data-editing')
    ).toBe(false);
    expect(section.querySelector('.tui-cte-view')).not.toBeNull();
  });

  test('closing a changed comment flashes "Comment updated"; an unchanged one does not', async () => {
    await render(draftsGate());
    const section = sectionOf(itemFor('Unused import'), 'Comment')!;
    const hint = () => section.querySelector('.tui-cte-hint')!;
    await React.act(async () => {
      section.querySelector<HTMLElement>('.tui-cte-view')!.click();
    });
    await React.act(async () => {
      section.querySelector('textarea')!.blur();
    });
    expect(hint().hasAttribute('data-flash')).toBe(false);
    expect(hint().textContent).toBe('Click to edit');

    const changed = sectionOf(
      itemFor('SQL built from unsanitized input'),
      'Comment'
    )!;
    await edit(changed, 'Bind q as a parameter.');
    await React.act(async () => {
      changed.querySelector('textarea')!.blur();
    });
    const flash = changed.querySelector('.tui-cte-hint')!;
    expect(flash.getAttribute('data-flash')).toBe('shown');
    expect(flash.textContent).toBe('Comment updated');
  });

  test('Tab onto a rendered comment opens it for typing', async () => {
    await render(draftsGate());
    const section = sectionOf(itemFor('Unused import'), 'Comment')!;
    await React.act(async () => {
      section.querySelector<HTMLElement>('.tui-cte-view')!.focus();
    });
    expect(section.querySelector('textarea')).not.toBeNull();
  });

  test('a changed comment offers a reset that restores the draft', async () => {
    await render(draftsGate());
    const item = () => itemFor('Unused import');
    await edit(item(), 'Drop this import, please.');
    expect(metaOf(item())).toBe('Reset to draft');
    await click(
      item().querySelector<HTMLButtonElement>('button.tui-composer-act')!
    );
    expect(valueOf(sectionOf(item(), 'Comment'))).toBe(COMMENT.f4);
    expect(metaOf(item())).toBeUndefined();
    expect(sectionOf(item(), 'Comment')!.hasAttribute('data-edited')).toBe(
      false
    );
  });

  test('an edited summary line offers a reset that restores the draft', async () => {
    await render(draftsGate());
    await edit(summaryLine(), 'Approve, edited.');
    expect(
      summaryLine().querySelector('.tui-review-section-meta')!.textContent
    ).toBe('Reset to draft');
    await click(
      summaryLine().querySelector<HTMLButtonElement>(
        'button[aria-label="Summary line: reset to draft"]'
      )!
    );
    expect(valueOf(summaryLine())).toBe(SUMMARY);
    expect(summaryLine().hasAttribute('data-edited')).toBe(false);
  });

  test('Escape in a field stays out of the sheet; a second Escape outside a field reaches it', async () => {
    await render(draftsGate());
    sheetCloses = 0;
    const section = sectionOf(itemFor('Unused import'), 'Comment')!;
    await React.act(async () => {
      section.querySelector<HTMLElement>('.tui-cte-view')!.click();
    });
    const box = section.querySelector<HTMLTextAreaElement>(
      'textarea.tui-composer-input'
    )!;
    const esc = (el: Element) =>
      React.act(async () => {
        el.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      });
    box.focus();
    // The sheet's Escape listener sits on the document; counting what reaches
    // it keeps the test free of the layer stack other files leave behind.
    let reached = 0;
    const onDoc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') reached++;
    };
    document.addEventListener('keydown', onDoc);
    try {
      await esc(box);
      expect(reached).toBe(0);
      expect(sheetCloses).toBe(0);
      await esc(document.body);
      expect(reached).toBe(1);
    } finally {
      document.removeEventListener('keydown', onDoc);
    }
  });

  test('Escape in a field returns it to rendered text with focus on it, not the sheet', async () => {
    await render(draftsGate());
    sheetCloses = 0;
    const section = sectionOf(itemFor('Unused import'), 'Comment')!;
    await React.act(async () => {
      section.querySelector<HTMLElement>('.tui-cte-view')!.click();
    });
    const box = section.querySelector<HTMLTextAreaElement>(
      'textarea.tui-composer-input'
    )!;
    const esc = (el: Element) =>
      React.act(async () => {
        el.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      });
    box.focus();
    await esc(box);
    expect(
      section.querySelector('.tui-cte')!.hasAttribute('data-editing')
    ).toBe(false);
    expect(document.activeElement).toBe(
      [...section.querySelectorAll('.tui-cte-view')].at(-1) ?? null
    );
  });

  test('without editable the sheet is the one it was: fix lines, no boxes, no summary card', async () => {
    await render(draftsGate({ editable: false }));
    expect(container.querySelector('.tui-review-dock-summary')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('.tui-review-card')).toBeNull();
    expect(
      container.querySelector('.tui-sheet-dock-heading')!.textContent
    ).toBe('Verdict on !31');
    expect(container.querySelectorAll('.tui-review-finding-fix').length).toBe(
      4
    );
    expect(submitButton().textContent).toBe('approve');
  });
});

async function press(
  target: Element,
  key: string,
  mods: { metaKey?: boolean; ctrlKey?: boolean } = {}
) {
  await React.act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, ...mods })
    );
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

const sheetEl = () => container.querySelector('.tui-gate-sheet')!;
const answerPosts = () => posts.filter(p => p.url === '/gate/answer');

describe('keyboard', () => {
  test('Cmd+Enter posts the review the submit button would', async () => {
    await render();
    await press(sheetEl(), 'Enter', { metaKey: true });
    const sent = answerPosts();
    expect(sent.length).toBe(1);
    const body = sent[0]!.body as { answers: Record<string, unknown> };
    expect(body.answers.outcome).toBe('approve');
    expect(body.answers['findings-1']).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  test('a number key picks that verdict, and the caps number each verdict', async () => {
    await render();
    const caps = [
      ...container.querySelectorAll(
        '.tui-sheet-rail .tui-gate-choice .tui-key-cap'
      ),
    ].map(c => c.getAttribute('data-keys'));
    expect(caps).toEqual(['1', '2']);

    await press(sheetEl(), '2');
    const radios = [
      ...container.querySelectorAll('.tui-sheet-rail input[type=radio]'),
    ] as HTMLInputElement[];
    expect(radios.find(r => r.value === 'comment')?.checked).toBe(true);
    expect(container.querySelector('.tui-sheet-submit')?.textContent).toBe(
      'comment'
    );
  });

  test('the submit button shows the chord without changing its label', async () => {
    await render();
    const submit = container.querySelector('.tui-sheet-submit')!;
    expect(
      submit.querySelector('.tui-key-cap')?.getAttribute('data-keys')
    ).toBe('⌘↵');
    expect(submit.textContent).toBe('approve');
  });

  test('Cmd+Enter does nothing once the gate was answered elsewhere', async () => {
    answeredElsewhere = true;
    await render();
    await click(buttonByText('approve'));
    const before = answerPosts().length;
    await press(sheetEl(), 'Enter', { metaKey: true });
    expect(answerPosts().length).toBe(before);
  });
});
