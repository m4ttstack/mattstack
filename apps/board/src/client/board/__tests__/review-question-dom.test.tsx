/** DOM-level test for asking a question about a review finding from the
    review sheet: the "ask a question" link on each drafted finding card and
    the POST it sends, the "question open" pill a live question turns it
    into, and the revised strip a finding rebuilt from a question carries.
    Also `revisionSummary`, the strip's list of what changed. */

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
import { createRoot, type Root } from 'react-dom/client';

import type { GateQuestion, GateRow } from '../../../gates/store.ts';
import type { ReportFinding } from '../../../review-finding.ts';
import type { BoardMRWithReview, QuestionInfo } from '../../types.ts';
import type { FindingEntry } from '../gate-ctx.ts';
import { useGateForm } from '../GateForm.tsx';
import {
  findingEntryFromReport,
  revisionSummary,
} from '../ReviewDraftCard.tsx';
import { ReviewGateSheet } from '../ReviewGateSheet.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const j = (v: unknown) => JSON.stringify(v);
const MR_URL = 'https://gitlab.example.com/acme/widgets/-/merge_requests/31';

const FINDINGS = [
  { id: 'f1', severity: 'critical', title: 'First finding' },
  { id: 'f2', severity: 'important', title: 'Second finding' },
].map(f => ({
  ...f,
  body: `${f.title} body.`,
  file: `lib/${f.id}.ts:3`,
  fix: 'fix it',
  comment: `${f.title} draft.`,
}));

const SKIPPED_QUESTION: GateQuestion = {
  id: 'skipped-1',
  label: 'Bring back a finding you skipped earlier?',
  multi: true,
  context: j({
    'gate-ctx': 'skipped@1',
    skipped: [
      {
        id: 'r1-f7',
        round: 1,
        severity: 'minor',
        title: 'Skipped finding',
        file: 'lib/old.ts:9',
        changed: false,
      },
    ],
  }),
  options: [
    {
      value: 'restore:r1-f7',
      label: '[Minor] Skipped finding',
      description: 'lib/old.ts:9 · skipped in round 1',
    },
  ],
};

function gate({ skipped = false }: { skipped?: boolean } = {}): GateRow {
  return {
    gateId: 'g-review',
    subject: `mr:${MR_URL.replace('https://', '')}`,
    kind: 'review-post',
    label: 'review',
    status: 'open',
    openedAt: 1,
    context: j({
      'gate-ctx': 'review@1',
      reviewer: 'renee',
      readiness: 'with-fixes',
      summary: 'Two findings.',
      findings: { critical: 1, important: 1, minor: 0 },
      editable: true,
      summaryComments: { approve: 'Looks fine.', comment: 'Some notes.' },
    }),
    questions: [
      {
        id: 'findings-1',
        label: 'Post which findings to !31?',
        multi: true,
        context: j({ 'gate-ctx': 'findings@1', findings: FINDINGS }),
        options: FINDINGS.map(f => ({
          value: f.id,
          label: `[${f.severity}] ${f.title}`,
          description: `${f.file} · fix it`,
        })),
      },
      ...(skipped ? [SKIPPED_QUESTION] : []),
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
}

const NO_QUESTIONS: QuestionInfo = {
  live: {},
  failed: {},
  revised: {},
  rebuilding: false,
};

const mrWith = (questions: QuestionInfo = NO_QUESTIONS): BoardMRWithReview =>
  ({
    iid: 31,
    title: 'a change',
    webUrl: MR_URL,
    author: { username: 'paul', name: 'Paul' },
    sourceBranch: 'feature',
    targetBranch: 'main',
    createdAt: '2026-09-17T00:00:00.000Z',
    diff: { additions: 4, deletions: 1, filesChanged: 1 },
    questions,
  }) as unknown as BoardMRWithReview;

const report = (id: string, extra: Partial<ReportFinding> = {}) => ({
  id,
  tier: 'Important' as const,
  title: `Report ${id}`,
  body: `Report ${id} body.`,
  file: `lib/${id}.ts`,
  line: 3,
  comment: `Report ${id} comment.`,
  ...extra,
});

function Host({ g, mr }: { g: GateRow; mr: BoardMRWithReview }) {
  const form = useGateForm(g);
  return (
    <ReviewGateSheet
      gate={g}
      mr={mr}
      onAskQuestion={(m, gateId, findingId, focus) =>
        asks.push({ iid: m.iid, gateId, findingId, focus })
      }
      form={form}
      queue={{
        index: 0,
        total: 1,
        states: ['active'],
        canNext: false,
        canPrev: false,
        onPrev: () => {},
        onNext: () => {},
      }}
      onClose={() => {}}
      onContinue={() => {}}
      onFocusPane={() => {}}
    />
  );
}

let root: Root;
let container: HTMLElement;
/** Every onAskQuestion call the sheet made. */
let asks: Array<{
  iid: number;
  gateId: string;
  findingId: string;
  focus: boolean;
}>;
/** What `/review/report.json` answers: its findings, or null for a 404. */
let reportFindings: unknown[] | null;

beforeEach(() => {
  localStorage.clear();
  asks = [];
  reportFindings = [report('f1'), report('f2')];
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json'))
      return reportFindings === null
        ? new Response('none', { status: 404 })
        : new Response(j({ findings: reportFindings }));
    if (url.startsWith('/review/sheet-draft')) return new Response('null');
    return new Response('{"ok":true}');
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

const settle = (ms = 0) =>
  React.act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });

async function show(g: GateRow, mr: BoardMRWithReview) {
  await React.act(async () => {
    root.render(<Host g={g} mr={mr} />);
  });
  await settle();
}

const card = (title: string) =>
  [...container.querySelectorAll<HTMLElement>('.tui-review-finding')].find(
    c => c.querySelector('.tui-review-finding-title')?.textContent === title
  )!;

const askLink = (title: string) =>
  card(title).querySelector<HTMLButtonElement>(
    '[data-section="finding"] .tui-review-section-link'
  );

describe('revisionSummary', () => {
  const entry = (extra: Partial<FindingEntry>): FindingEntry => ({
    id: 'f2',
    severity: 'important',
    title: 'Same title',
    body: 'Same body.',
    file: 'lib/a.ts:117–119',
    ...extra,
  });

  test('names severity, anchor and wording changes in order', () => {
    expect(
      revisionSummary(
        entry({}),
        entry({
          severity: 'minor',
          file: 'lib/a.ts:121–123',
          body: 'New body.',
        })
      )
    ).toEqual([
      'Important → Minor',
      'lines 117–119 → 121–123',
      'finding reworded',
    ]);
  });

  test('an unchanged finding has nothing to say', () => {
    expect(revisionSummary(entry({}), entry({}))).toEqual([]);
  });

  test('a title change alone reads as reworded', () => {
    expect(revisionSummary(entry({}), entry({ title: 'Other' }))).toEqual([
      'finding reworded',
    ]);
  });
});

describe('findingEntryFromReport', () => {
  test('maps tier to severity and file plus line to file:line', () => {
    expect(
      findingEntryFromReport(report('f9', { tier: 'Minor', line: '4–6' }))
    ).toMatchObject({
      id: 'f9',
      severity: 'minor',
      title: 'Report f9',
      body: 'Report f9 body.',
      file: 'lib/f9.ts:4–6',
      comment: 'Report f9 comment.',
    });
  });

  test('a file with no line keeps the bare path', () => {
    const { line: _, ...noLine } = report('f9');
    expect(findingEntryFromReport(noLine).file).toBe('lib/f9.ts');
  });
});

describe('asking a question from the review sheet', () => {
  test('each drafted finding offers an ask link that asks about the finding', async () => {
    await show(gate(), mrWith());
    const first = askLink('First finding')!;
    expect(first.textContent).toBe('ask a question');
    expect(first.getAttribute('aria-label')).toBe(
      'First finding: ask a question'
    );
    expect(askLink('Second finding')).not.toBeNull();
    await React.act(async () => first.click());
    await settle();
    expect(asks).toEqual([
      { iid: 31, gateId: 'g-review', findingId: 'f1', focus: false },
    ]);
  });

  test('a skipped finding has no ask link', async () => {
    await show(gate({ skipped: true }), mrWith());
    const skipped = container.querySelector('.tui-review-skipped')!;
    expect(skipped).not.toBeNull();
    expect(skipped.textContent).not.toContain('ask a question');
    expect(
      container.querySelectorAll('[aria-label$=": ask a question"]').length
    ).toBe(2);
  });

  test('no ask link when the review has no report json', async () => {
    reportFindings = null;
    await show(gate(), mrWith());
    expect(container.textContent).not.toContain('ask a question');
  });

  test('no ask link on a finding the report json does not list', async () => {
    reportFindings = [report('f1')];
    await show(gate(), mrWith());
    expect(askLink('First finding')).not.toBeNull();
    expect(askLink('Second finding')).toBeNull();
  });

  test('a live question shows the open pill, which focuses its pane', async () => {
    await show(
      gate(),
      mrWith({
        ...NO_QUESTIONS,
        live: { f2: { paneId: 'p1', tabId: 't1', status: 'live' } },
      })
    );
    const pill = askLink('Second finding')!;
    expect(pill.textContent).toBe('question open · Q f2');
    expect(askLink('First finding')!.textContent).toBe('ask a question');
    await React.act(async () => pill.click());
    await settle();
    expect(asks).toEqual([
      { iid: 31, gateId: 'g-review', findingId: 'f2', focus: true },
    ]);
  });

  test('a launch still coming up reads as opening and takes no click', async () => {
    await show(
      gate(),
      mrWith({ ...NO_QUESTIONS, live: { f2: { status: 'queued' } } })
    );
    const opening = askLink('Second finding')!;
    expect(opening.textContent).toBe('opening a question…');
    expect(opening.getAttribute('aria-label')).toBe(
      'Second finding: opening a question'
    );
    expect(opening.disabled).toBe(true);
    await React.act(async () => opening.click());
    await settle();
    expect(asks).toEqual([]);
  });

  test('a queued question that already has its tab is the open pill', async () => {
    await show(
      gate(),
      mrWith({
        ...NO_QUESTIONS,
        live: { f2: { status: 'queued', tabId: 't1' } },
      })
    );
    expect(askLink('Second finding')!.textContent).toBe('question open · Q f2');
  });

  test('a failed launch shows why beside the ask link, which asks again', async () => {
    await show(
      gate(),
      mrWith({
        ...NO_QUESTIONS,
        failed: { f2: { message: 'no such workspace' } },
      })
    );
    const failed = card('Second finding').querySelector(
      '[data-section="finding"] .tui-review-ask-failed'
    )!;
    expect(failed.textContent).toBe(
      "couldn't open the question: no such workspace"
    );
    expect(
      card('First finding').querySelector('.tui-review-ask-failed')
    ).toBeNull();
    const again = askLink('Second finding')!;
    expect(again.textContent).toBe('ask a question');
    await React.act(async () => again.click());
    await settle();
    expect(asks).toEqual([
      { iid: 31, gateId: 'g-review', findingId: 'f2', focus: false },
    ]);
  });

  test('a revised finding carries the strip and shows its original on demand', async () => {
    await show(
      gate(),
      mrWith({
        ...NO_QUESTIONS,
        revised: {
          f2: {
            original: report('f2', {
              title: 'Second finding',
              body: 'The original wording.',
              line: 2,
            }),
            revised: report('f2', {
              tier: 'Minor',
              title: 'Second finding',
              body: 'Second finding body.',
            }),
            newGate: 'g-older',
          },
        },
      })
    );
    const revised = card('Second finding');
    expect(revised.hasAttribute('data-revised')).toBe(true);
    expect(card('First finding').hasAttribute('data-revised')).toBe(false);
    const strip = revised.querySelector('.tui-review-revised')!;
    expect(strip.querySelector('.tui-review-revised-text')!.textContent).toBe(
      'Revised from your question in Q f2 · Important → Minor · lines 2 → 3 · finding reworded'
    );
    expect(strip.textContent).not.toContain('The original wording.');
    const toggle = [...strip.querySelectorAll('button')].find(
      b => b.textContent === 'show original'
    )!;
    await React.act(async () => toggle.click());
    expect(strip.textContent).toContain('The original wording.');
    expect(toggle.textContent).toBe('hide original');
  });

  test('a dropped finding renders nothing and the sheet stands', async () => {
    await show(
      gate(),
      mrWith({
        ...NO_QUESTIONS,
        revised: {
          f9: { original: report('f9'), revised: null, newGate: 'g-review' },
        },
      })
    );
    expect(container.querySelector('.tui-review-revised')).toBeNull();
    expect(container.querySelectorAll('.tui-review-finding').length).toBe(2);
  });
});
