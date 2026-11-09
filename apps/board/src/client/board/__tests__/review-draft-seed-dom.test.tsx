/** DOM-level test for a re-raised review gate starting from the reviewer's
    draft: the queue modal (keyed by gate id, as Board mounts it) saves the
    first gate's ticks and edits as gate-kit's per-gate draft, and a second
    gate the MR's row names as its successor in the same run seeds from that
    draft. Only a revision the second gate carries takes the agent's new
    comment instead of the saved edit. */

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
import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { DecisionQueueModal } from '../DecisionQueueModal.tsx';

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
  { id: 'f3', severity: 'important', title: 'Third finding' },
  { id: 'f4', severity: 'important', title: 'Fourth finding' },
].map(f => ({
  ...f,
  body: `${f.title} body.`,
  file: `lib/${f.id}.ts:3`,
  fix: 'fix it',
}));

/** One gate for the MR; `drafts` are the agent's comment texts, and name
    the findings the gate carries. */
function gateFor(gateId: string, drafts: Record<string, string>): GateRow {
  const findings = FINDINGS.filter(f => f.id in drafts);
  return {
    gateId,
    subject: `mr:${MR_URL}`,
    kind: 'review-post',
    label: 'review',
    status: 'open',
    openedAt: 1,
    context: j({
      'gate-ctx': 'review@1',
      reviewer: 'renee',
      readiness: 'with-fixes',
      summary: 'Three findings.',
      findings: { critical: 1, important: findings.length - 1 },
      editable: true,
      summaryComments: { approve: 'Looks fine.', comment: 'Some notes.' },
    }),
    questions: [
      {
        id: 'findings-1',
        label: 'Post which findings to !31?',
        multi: true,
        context: j({
          'gate-ctx': 'findings@1',
          findings: findings.map(f => ({ ...f, comment: drafts[f.id] })),
        }),
        options: findings.map(f => ({
          value: f.id,
          label: `[${f.severity}] ${f.title}`,
          description: `lib/${f.id}.ts:3 · fix it`,
        })),
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
}

/** The MR row. `revision` is what the server reports for the open gate:
    the gate it superseded in this run, that gate's findings, and the
    findings it revised. */
const mrWith = (revision?: {
  gateId: string;
  previousGateId: string;
  previousFindingIds?: string[];
  revisedIds?: string[];
}): BoardMRWithReview =>
  ({
    iid: 31,
    title: 'a change',
    webUrl: MR_URL,
    author: { username: 'paul', name: 'Paul' },
    sourceBranch: 'feature',
    targetBranch: 'main',
    createdAt: '2026-09-17T00:00:00.000Z',
    diff: { additions: 4, deletions: 1, filesChanged: 1 },
    ...(revision
      ? {
          reviewRevision: {
            gateId: revision.gateId,
            previousGateId: revision.previousGateId,
            previousFindingIds: revision.previousFindingIds ?? [
              'f1',
              'f2',
              'f3',
            ],
            changedIds: revision.revisedIds ?? [],
            revised: Object.fromEntries(
              (revision.revisedIds ?? []).map(id => [
                id,
                {
                  original: {
                    id,
                    severity: 'minor',
                    title: 'before',
                    body: 'before',
                  },
                },
              ])
            ),
          },
        }
      : {}),
  }) as unknown as BoardMRWithReview;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  localStorage.clear();
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

/** Mirrors Board: the queue modal is keyed by gate id, so a rebuilt gate
    mounts a fresh form. */
async function show(gate: GateRow, mr: BoardMRWithReview) {
  await React.act(async () => {
    root.render(
      <DecisionQueueModal
        key={gate.gateId}
        gate={gate}
        mr={mr}
        position={1}
        states={['active']}
        onClose={() => {}}
        onNext={() => {}}
        onBack={() => {}}
        onFocusPane={() => {}}
        onAnswered={() => {}}
        onContinue={() => {}}
      />
    );
  });
  await settle();
}

const card = (title: string) =>
  [...document.body.querySelectorAll('.tui-review-finding')].find(
    r => r.querySelector('.tui-review-finding-title')?.textContent === title
  )!;

const checkbox = (title: string) =>
  card(title).querySelector('input[type="checkbox"]') as HTMLInputElement;

/** A finding's comment as the field shows it: the raw text while it is open,
    the rendered text at rest (the field is click-to-edit). */
const comment = (title: string) => {
  const field = card(title).querySelector('.tui-cte');
  return (
    field?.querySelector('textarea')?.value ??
    field?.querySelector('.tui-cte-view')?.textContent ??
    ''
  );
};

async function edit(title: string, text: string) {
  const scope = card(title);
  if (!scope.querySelector('textarea.tui-composer-input'))
    await React.act(async () => {
      scope.querySelector<HTMLElement>('.tui-cte-view')!.click();
    });
  const box = scope.querySelector<HTMLTextAreaElement>(
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

const savedDraft = (gateId: string) => {
  const raw = localStorage.getItem(gateDraftKey(gateId));
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
};

const DRAFTS_A = { f1: 'draft one', f2: 'draft two', f3: 'draft three' };
const DRAFTS_B = { f1: 'draft one', f2: 'draft two', f3: 'REVISED three' };

/** Sheet A: untick f2 and edit f3's comment. */
async function userEditsGateA() {
  await show(gateFor('g-a', DRAFTS_A), mrWith());
  await React.act(async () => checkbox('Second finding').click());
  await edit('Third finding', 'my own wording');
  await settle();
}

describe('a re-raised review gate', () => {
  test('starts from the unticked finding and the comment edit', async () => {
    await userEditsGateA();
    await show(
      gateFor('g-b', DRAFTS_A),
      mrWith({ gateId: 'g-b', previousGateId: 'g-a' })
    );
    expect(checkbox('First finding').checked).toBe(true);
    expect(checkbox('Second finding').checked).toBe(false);
    expect(checkbox('Third finding').checked).toBe(true);
    expect(comment('Third finding')).toBe('my own wording');
    expect(comment('First finding')).toBe('draft one');
  });

  test("saves its own draft and drops the superseded gate's", async () => {
    await userEditsGateA();
    expect(savedDraft('g-a')).not.toBeNull();
    await show(
      gateFor('g-b', DRAFTS_A),
      mrWith({ gateId: 'g-b', previousGateId: 'g-a' })
    );
    expect(savedDraft('g-a')).toBeNull();
    expect(
      (savedDraft('g-b')!.texts as Record<string, string>)['comment:f3']
    ).toBe('my own wording');
  });

  test('a finding revised in this gate keeps its tick and takes the new draft', async () => {
    await userEditsGateA();
    await show(
      gateFor('g-b', DRAFTS_B),
      mrWith({ gateId: 'g-b', previousGateId: 'g-a', revisedIds: ['f3'] })
    );
    expect(checkbox('Second finding').checked).toBe(false);
    expect(checkbox('Third finding').checked).toBe(true);
    expect(comment('Third finding')).toBe('REVISED three');
  });

  test('a finding new to the re-raised gate keeps its default tick and draft', async () => {
    await userEditsGateA();
    await show(
      gateFor('g-b', { ...DRAFTS_A, f4: 'draft four' }),
      mrWith({ gateId: 'g-b', previousGateId: 'g-a' })
    );
    expect(checkbox('Second finding').checked).toBe(false);
    expect(checkbox('Fourth finding').checked).toBe(true);
    expect(comment('Fourth finding')).toBe('draft four');
  });

  test('the verdict and its note carry over too', async () => {
    localStorage.setItem(
      gateDraftKey('g-a'),
      JSON.stringify({
        selections: { findings: ['f1', 'f3'], outcome: 'comment' },
        notes: { outcome: 'one more pass' },
        texts: {},
        item: null,
      })
    );
    await show(
      gateFor('g-b', DRAFTS_A),
      mrWith({ gateId: 'g-b', previousGateId: 'g-a' })
    );
    const draft = savedDraft('g-b')!;
    expect((draft.selections as Record<string, unknown>).outcome).toBe(
      'comment'
    );
    expect(draft.notes).toEqual({ outcome: 'one more pass' });
  });

  test('a later re-raise keeps the revised draft, not the edit it replaced', async () => {
    await userEditsGateA();
    await show(
      gateFor('g-b', DRAFTS_B),
      mrWith({ gateId: 'g-b', previousGateId: 'g-a', revisedIds: ['f3'] })
    );
    expect(comment('Third finding')).toBe('REVISED three');
    await show(
      gateFor('g-c', { ...DRAFTS_B, f1: 'REVISED one' }),
      mrWith({ gateId: 'g-c', previousGateId: 'g-b', revisedIds: ['f1'] })
    );
    expect(comment('Third finding')).toBe('REVISED three');
    expect(comment('First finding')).toBe('REVISED one');
    expect(checkbox('Second finding').checked).toBe(false);
  });

  test('a gate the row names no predecessor for starts fresh', async () => {
    await userEditsGateA();
    await show(gateFor('g-other-run', DRAFTS_A), mrWith());
    expect(checkbox('Second finding').checked).toBe(true);
    expect(comment('Third finding')).toBe('draft three');
    expect(savedDraft('g-a')).not.toBeNull();
  });

  test('a revision of another gate seeds nothing', async () => {
    await userEditsGateA();
    await show(
      gateFor('g-b', DRAFTS_A),
      mrWith({ gateId: 'g-elsewhere', previousGateId: 'g-a' })
    );
    expect(checkbox('Second finding').checked).toBe(true);
    expect(comment('Third finding')).toBe('draft three');
  });

  test("a gate with a draft of its own keeps it over the predecessor's", async () => {
    await userEditsGateA();
    localStorage.setItem(
      gateDraftKey('g-b'),
      JSON.stringify({
        selections: { findings: ['f2'] },
        notes: {},
        texts: {},
        item: null,
      })
    );
    await show(
      gateFor('g-b', DRAFTS_A),
      mrWith({ gateId: 'g-b', previousGateId: 'g-a' })
    );
    expect(checkbox('First finding').checked).toBe(false);
    expect(checkbox('Second finding').checked).toBe(true);
  });
});
