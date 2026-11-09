/** DOM-level test for asking about a review finding from the review sheet:
    the "ask a question" link on each drafted finding card, the area it opens
    and the question it sends to the review pane, the one-at-a-time rule, and
    the revised strip a finding the review pane revised carries. Also
    `revisionChanges`, the strip's list of what changed. */

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

import type { GateQuestion, GateRow } from '../../../gates/store.ts';
import type { ReviewRevision } from '../../../review-revision.ts';
import type { BoardMRWithReview } from '../../types.ts';
import type { FindingEntry } from '../gate-ctx.ts';
import { useGateForm } from '../GateForm.tsx';
import { ASK_PLACEHOLDER, revisionChanges } from '../ReviewDraftCard.tsx';
import { ASK_PANE_GONE, ReviewGateSheet } from '../ReviewGateSheet.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });
// happy-dom's Web Animations stub rejects a cancelled animation, which motion
// raises as an unhandled error; without `animate` motion uses its own frame
// loop, and skipAnimations settles every card fold at once.
delete (Element.prototype as { animate?: unknown }).animate;
MotionGlobalConfig.skipAnimations = true;

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
})) as FindingEntry[];

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

function gate({
  skipped = false,
  status = 'open',
}: { skipped?: boolean; status?: GateRow['status'] } = {}): GateRow {
  return {
    gateId: 'g-review',
    subject: `mr:${MR_URL}`,
    kind: 'review-post',
    label: 'review',
    status,
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

const mrWith = (reviewRevision?: ReviewRevision): BoardMRWithReview =>
  ({
    iid: 31,
    title: 'a change',
    webUrl: MR_URL,
    author: { username: 'paul', name: 'Paul' },
    sourceBranch: 'feature',
    targetBranch: 'main',
    createdAt: '2026-09-17T00:00:00.000Z',
    diff: { additions: 4, deletions: 1, filesChanged: 1 },
    ...(reviewRevision ? { reviewRevision } : {}),
  }) as unknown as BoardMRWithReview;

/** One onAskQuestion call, settled by the test through `resolve`. */
interface Ask {
  iid: number;
  gateId: string;
  findingId: string;
  question: string;
  resolve: (ok: boolean) => void;
}

function Host({
  g,
  mr,
  paneGone,
}: {
  g: GateRow;
  mr: BoardMRWithReview;
  paneGone?: boolean;
}) {
  const form = useGateForm(g);
  return (
    <ReviewGateSheet
      gate={g}
      mr={mr}
      paneGone={paneGone}
      onAskQuestion={(m, gateId, findingId, question) =>
        new Promise<boolean>(resolve =>
          asks.push({ iid: m.iid, gateId, findingId, question, resolve })
        )
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
      onClose={() => closes++}
      onContinue={() => {}}
      onFocusPane={(m, domain) => focuses.push(`${m.iid}:${domain}`)}
    />
  );
}

let root: Root;
let container: HTMLElement;
let asks: Ask[];
let focuses: string[];
let closes: number;

beforeEach(() => {
  localStorage.clear();
  asks = [];
  focuses = [];
  closes = 0;
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/review/report.json'))
      return new Response('none', { status: 404 });
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

async function show(g: GateRow, mr: BoardMRWithReview, paneGone?: boolean) {
  await React.act(async () => {
    root.render(<Host g={g} mr={mr} paneGone={paneGone} />);
  });
  await settle();
}

const card = (title: string) =>
  [...container.querySelectorAll<HTMLElement>('.tui-review-finding')].find(
    c => c.querySelector('.tui-review-finding-title')?.textContent === title
  )!;

const askLink = (title: string) =>
  card(title).querySelector<HTMLButtonElement>(
    `[aria-label="${title}: ask a question"]`
  );

const field = (title: string) =>
  card(title).querySelector<HTMLTextAreaElement>(
    `[aria-label="${title}: your question"]`
  );

const button = (title: string, text: string) =>
  [...card(title).querySelectorAll<HTMLButtonElement>('button')].find(
    b => b.textContent === text
  );

/** Types into a React-controlled textarea the way a keystroke would. */
async function type(el: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )!.set!;
  await React.act(async () => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function openAndType(title: string, text: string) {
  await React.act(async () => askLink(title)!.click());
  await type(field(title)!, text);
}

describe('revisionChanges', () => {
  const entry = (extra: Partial<FindingEntry>): FindingEntry => ({
    id: 'f2',
    severity: 'important',
    title: 'Same title',
    body: 'Same body.',
    file: 'lib/a.ts:117–119',
    ...extra,
  });
  const rows = (a: FindingEntry, b: FindingEntry) =>
    revisionChanges(a, b).map(c => `${c.label}: ${c.value}`);

  test('names severity, anchor and wording changes in order', () => {
    expect(
      rows(
        entry({}),
        entry({
          severity: 'minor',
          file: 'lib/a.ts:121–123',
          body: 'New body.',
        })
      )
    ).toEqual([
      'Severity: Important → Minor',
      'Lines: 117–119 → 121–123',
      'Finding: Reworded',
    ]);
  });

  test('an unchanged finding has nothing to say', () => {
    expect(rows(entry({}), entry({}))).toEqual([]);
  });

  test('a title change alone reads as reworded and carries the original', () => {
    const [change] = revisionChanges(entry({}), entry({ title: 'Other' }));
    expect(change).toEqual({
      label: 'Finding',
      value: 'Reworded',
      originalTitle: 'Same title',
      original: 'Same body.',
    });
  });

  test('names a changed fix and a rewritten comment last', () => {
    expect(
      rows(
        entry({ fix: 'Old fix.', comment: 'Old comment.' }),
        entry({ fix: 'New fix.', comment: 'New comment.' })
      )
    ).toEqual(['Fix: Changed', 'Comment: Rewritten']);
  });

  test('a fix or comment with no earlier text has no original to show', () => {
    const changes = revisionChanges(
      entry({}),
      entry({ fix: 'New fix.', comment: 'New comment.' })
    );
    expect(changes.map(c => c.value)).toEqual(['Added', 'Added']);
    expect(changes.every(c => c.original === undefined)).toBe(true);
  });
});

describe('asking a question from the review sheet', () => {
  test('each drafted finding offers an ask link that opens an area', async () => {
    await show(gate(), mrWith());
    const first = askLink('First finding')!;
    expect(first.textContent).toBe('');
    expect(askLink('Second finding')).not.toBeNull();
    expect(field('First finding')).toBeNull();
    await React.act(async () => first.click());
    const area = field('First finding')!;
    expect(area.placeholder).toBe(ASK_PLACEHOLDER);
    expect(button('First finding', 'Send to the agent')).toBeDefined();
    expect(button('First finding', 'Cancel')).toBeDefined();
    expect(field('Second finding')).toBeNull();
    expect(asks).toEqual([]);
  });

  test('cancel closes the area without asking', async () => {
    await show(gate(), mrWith());
    await openAndType('First finding', 'Is this real?');
    await React.act(async () => button('First finding', 'Cancel')!.click());
    expect(field('First finding')).toBeNull();
    expect(asks).toEqual([]);
  });

  test('send asks about the finding, holds the field, then says the pane took it', async () => {
    await show(gate(), mrWith());
    await openAndType('Second finding', 'Is this\nreally Important?');
    await React.act(async () =>
      button('Second finding', 'Send to the agent')!.click()
    );
    expect(asks.map(({ resolve: _, ...a }) => a)).toEqual([
      {
        iid: 31,
        gateId: 'g-review',
        findingId: 'f2',
        question: 'Is this\nreally Important?',
      },
    ]);
    expect(field('Second finding')!.disabled).toBe(true);

    await React.act(async () => asks[0]!.resolve(true));
    await settle();
    expect(field('Second finding')).toBeNull();
    const done = card('Second finding').querySelector('.tui-review-ask-done')!;
    expect(done.textContent).toBe('Sent a question to the reviewing agent');
    await React.act(async () =>
      button('Second finding', 'Focus the review pane')!.click()
    );
    expect(focuses).toEqual(['31:review']);
  });

  test('a second open question cannot send while the first is sending', async () => {
    await show(gate(), mrWith());
    await openAndType('First finding', 'Why critical?');
    await openAndType('Second finding', 'Why important?');
    await React.act(async () =>
      button('First finding', 'Send to the agent')!.click()
    );
    const blocked = button('Second finding', 'Send to the agent')!;
    expect(blocked.disabled).toBe(true);
    expect(blocked.title).toBe('Wait for the other question to send');
    await React.act(async () => {
      field('Second finding')!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          bubbles: true,
        })
      );
    });
    expect(asks.length).toBe(1);
    await React.act(async () => asks[0]!.resolve(true));
    await settle();
  });

  test('a half-written question survives a trip to the Report tab', async () => {
    await show(gate(), mrWith());
    await openAndType('First finding', 'Why critical?');
    const tab = (label: string) =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
        b => b.textContent?.startsWith(label)
      )!;
    await React.act(async () => tab('Report').click());
    await React.act(async () => tab('Findings').click());
    expect(field('First finding')!.value).toBe('Why critical?');
  });

  test('a cancelled question starts empty next time', async () => {
    await show(gate(), mrWith());
    await openAndType('First finding', 'Why critical?');
    await React.act(async () => button('First finding', 'Cancel')!.click());
    await settle();
    await React.act(async () => askLink('First finding')!.click());
    expect(field('First finding')!.value).toBe('');
  });

  test('a refused question keeps the area and its text to try again', async () => {
    await show(gate(), mrWith());
    await openAndType('First finding', 'Why critical?');
    await React.act(async () =>
      button('First finding', 'Send to the agent')!.click()
    );
    await React.act(async () => asks[0]!.resolve(false));
    await settle();
    const area = field('First finding')!;
    expect(area.disabled).toBe(false);
    expect(area.value).toBe('Why critical?');
    expect(card('First finding').querySelector('.tui-review-ask-done')).toBe(
      null
    );
  });

  test('one question at a time: other ask links wait while one sends', async () => {
    await show(gate(), mrWith());
    await openAndType('First finding', 'Why critical?');
    await React.act(async () =>
      button('First finding', 'Send to the agent')!.click()
    );
    expect(askLink('Second finding')!.disabled).toBe(true);
    await React.act(async () => asks[0]!.resolve(true));
    await settle();
    expect(askLink('Second finding')!.disabled).toBe(false);
  });

  test('an empty question cannot be sent', async () => {
    await show(gate(), mrWith());
    await openAndType('First finding', '   ');
    expect(button('First finding', 'Send to the agent')!.disabled).toBe(true);
  });

  test('a skipped finding has no ask link', async () => {
    await show(gate({ skipped: true }), mrWith());
    const skipped = container.querySelector('.tui-review-skipped')!;
    expect(skipped).not.toBeNull();
    expect(
      skipped.querySelector('[aria-label$=": ask a question"]')
    ).toBeNull();
    expect(
      container.querySelectorAll('[aria-label$=": ask a question"]').length
    ).toBe(2);
  });

  test('an unticked finding offers the link in its head, without toggling the tick', async () => {
    await show(gate(), mrWith());
    const tick = () =>
      card('First finding').querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      )!;
    await React.act(async () => tick().click());
    expect(tick().checked).toBe(false);
    const link = askLink('First finding')!;
    expect(link.closest('.tui-review-card-head-bar')).not.toBeNull();
    expect(link.closest('label')).toBeNull();
    await React.act(async () => link.click());
    expect(tick().checked).toBe(false);
    await type(field('First finding')!, 'Why skip this?');
    await React.act(async () =>
      button('First finding', 'Send to the agent')!.click()
    );
    expect(asks.map(a => a.findingId)).toEqual(['f1']);
  });

  test('Escape in the question cancels it and leaves the sheet open', async () => {
    await show(gate(), mrWith());
    await openAndType('First finding', 'Is this real?');
    const area = field('First finding')!;
    area.focus();
    await React.act(async () => {
      area.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(field('First finding')).toBeNull();
    expect(closes).toBe(0);
  });

  test.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
  ])(
    '%s+Enter in the question sends it, and never posts the review',
    async (_name, mod) => {
      let submits = 0;
      const onSheetKey = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submits++;
      };
      document.addEventListener('keydown', onSheetKey);
      try {
        await show(gate(), mrWith());
        await openAndType('First finding', 'Is this real?');
        const area = field('First finding')!;
        area.focus();
        await React.act(async () => {
          area.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Enter',
              bubbles: true,
              ...mod,
            })
          );
        });
        expect(asks.map(a => [a.findingId, a.question])).toEqual([
          ['f1', 'Is this real?'],
        ]);
        expect(submits).toBe(0);
      } finally {
        document.removeEventListener('keydown', onSheetKey);
      }
    }
  );

  test('Cmd+Enter on an empty question sends nothing', async () => {
    await show(gate(), mrWith());
    await openAndType('First finding', '  ');
    const area = field('First finding')!;
    await React.act(async () => {
      area.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          metaKey: true,
          bubbles: true,
        })
      );
    });
    expect(asks).toEqual([]);
  });

  test('a gone review pane disables the ask links and says why', async () => {
    await show(gate(), mrWith(), true);
    const link = askLink('First finding')!;
    expect(link.disabled).toBe(true);
    expect(link.title).toBe(ASK_PANE_GONE);
    expect(ASK_PANE_GONE).toBe('Resume the review from its row first');
  });

  test('a parked gate still asks: the question resumes its session', async () => {
    await show(gate({ status: 'parked' }), mrWith(), true);
    const link = askLink('First finding')!;
    expect(link.disabled).toBe(false);
    await openAndType('First finding', 'Still real?');
    await React.act(async () =>
      button('First finding', 'Send to the agent')!.click()
    );
    expect(asks.map(a => a.findingId)).toEqual(['f1']);
  });

  test('an answered gate offers no ask link: nothing waits on it', async () => {
    await show(gate({ status: 'answered' }), mrWith());
    expect(
      container.querySelector('[aria-label$=": ask a question"]')
    ).toBeNull();
  });
});

describe('the revised strip', () => {
  const revision = (gateId: string): ReviewRevision => ({
    gateId,
    previousGateId: 'g-before',
    previousFindingIds: ['f1', 'f2'],
    changedIds: ['f2'],
    revised: {
      f2: {
        original: {
          ...FINDINGS[1]!,
          severity: 'critical',
          file: 'lib/f2.ts:2',
          body: 'The original wording.',
        },
      },
    },
  });

  test('a revised finding carries one quiet line and opens what changed', async () => {
    await show(gate(), mrWith(revision('g-review')));
    const revised = card('Second finding');
    expect(revised.hasAttribute('data-revised')).toBe(true);
    expect(card('First finding').hasAttribute('data-revised')).toBe(false);
    const strip = revised.querySelector('.tui-review-revised')!;
    expect(strip.querySelector('.tui-review-revised-text')!.textContent).toBe(
      'Revised by the agent'
    );
    expect(strip.querySelector('.tui-review-revised-count')!.textContent).toBe(
      '3 changes'
    );
    const panel = strip.querySelector('.tui-disclosure')!;
    const toggle = strip.querySelector<HTMLButtonElement>(
      '.tui-review-revised-toggle'
    )!;
    expect(toggle.textContent).toBe('Show changes');
    expect(panel.classList.contains('open')).toBe(false);
    await React.act(async () => toggle.click());
    expect(panel.classList.contains('open')).toBe(true);
    expect(toggle.textContent).toBe('Hide changes');
    expect(
      [...strip.querySelectorAll('.tui-review-revised-change')].map(
        row =>
          `${row.querySelector('dt')!.textContent}: ${row.querySelector('dd')!.textContent}`
      )
    ).toEqual([
      'Severity: Critical → Important',
      'Lines: 2 → 3',
      'Finding: Reworded',
    ]);
  });

  test('each original opens on its own toggle', async () => {
    await show(gate(), mrWith(revision('g-review')));
    const strip = card('Second finding').querySelector('.tui-review-revised')!;
    const row = [...strip.querySelectorAll('.tui-review-revised-change')].find(
      r => r.querySelector('dt')!.textContent === 'Finding'
    )!;
    const original = row.querySelector('.tui-disclosure')!;
    const toggle = row.querySelector('button')!;
    expect(toggle.textContent).toBe('Show original');
    expect(original.classList.contains('open')).toBe(false);
    await React.act(async () => toggle.click());
    expect(original.classList.contains('open')).toBe(true);
    expect(toggle.textContent).toBe('Hide original');
    expect(original.textContent).toContain('The original wording.');
    expect(row.querySelector('.tui-review-revised-title')!.textContent).toBe(
      'Second finding'
    );
  });

  test('a revision of another gate puts no strip on this one', async () => {
    await show(gate(), mrWith(revision('g-older')));
    expect(container.querySelector('.tui-review-revised')).toBeNull();
  });

  test('no revision, no strip', async () => {
    await show(gate(), mrWith());
    expect(container.querySelector('.tui-review-revised')).toBeNull();
  });
});
