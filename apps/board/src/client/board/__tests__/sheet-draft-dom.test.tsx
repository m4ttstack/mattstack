/** DOM-level test for the review sheet keeping its ticks and edits across a
    rebuilt gate: the first sheet saves through `/review/sheet-draft`, a
    second gate for the same MR (same finding ids, a new gate id) restores
    them, and only a revision the second gate itself carries takes the
    agent's new comment instead of the saved edit. The server is an
    in-memory stand-in for the route. */

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

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { useGateForm } from '../GateForm.tsx';
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
    subject: `mr:${MR_URL.replace('https://', '')}`,
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

const mrWith = (
  revised: Record<string, { newGate: string }> = {}
): BoardMRWithReview =>
  ({
    iid: 31,
    title: 'a change',
    webUrl: MR_URL,
    author: { username: 'paul', name: 'Paul' },
    sourceBranch: 'feature',
    targetBranch: 'main',
    createdAt: '2026-09-17T00:00:00.000Z',
    diff: { additions: 4, deletions: 1, filesChanged: 1 },
    questions: {
      live: {},
      failed: {},
      rebuilding: false,
      revised: Object.fromEntries(
        Object.entries(revised).map(([id, r]) => [
          id,
          { original: {}, revised: null, newGate: r.newGate },
        ])
      ),
    },
  }) as unknown as BoardMRWithReview;

function Host({ gate, mr }: { gate: GateRow; mr: BoardMRWithReview }) {
  const form = useGateForm(gate);
  return (
    <ReviewGateSheet
      gate={gate}
      mr={mr}
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
/** The route's stand-in: the saved draft and every request it saw. */
let saved: unknown;
let requests: Array<{ method: string; url: string }>;
let readFails: boolean;

beforeEach(() => {
  localStorage.clear();
  saved = null;
  requests = [];
  readFails = false;
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL,
    init?: { method?: string; body?: string }
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    if (url.startsWith('/review/sheet-draft')) {
      requests.push({ method, url });
      if (method === 'PUT') {
        saved = (JSON.parse(init!.body!) as { draft: unknown }).draft;
        return new Response('{"ok":true}');
      }
      if (readFails) return new Response('boom', { status: 500 });
      return new Response(JSON.stringify(saved));
    }
    if (url === '/gate/answer') {
      // A real answer takes a round trip, long enough for `busy` to render.
      await new Promise(resolve => setTimeout(resolve, 30));
      return new Response('{"ok":true}');
    }
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
    root.render(<Host key={gate.gateId} gate={gate} mr={mr} />);
  });
  await settle();
}

const checkbox = (title: string) =>
  [...container.querySelectorAll('.tui-review-finding-row')]
    .find(
      r => r.querySelector('.tui-review-finding-title')?.textContent === title
    )!
    .querySelector('input[type="checkbox"]') as HTMLInputElement;

const commentBox = (title: string) =>
  [...container.querySelectorAll('.tui-review-finding')]
    .find(
      r => r.querySelector('.tui-review-finding-title')?.textContent === title
    )
    ?.querySelector<HTMLTextAreaElement>('textarea.tui-composer-input');

async function edit(box: HTMLTextAreaElement, text: string) {
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const DRAFTS_A = { f1: 'draft one', f2: 'draft two', f3: 'draft three' };
const DRAFTS_B = { f1: 'draft one', f2: 'draft two', f3: 'REVISED three' };

/** Sheet A: untick f2, edit f3's comment, and let the debounce save. */
async function userEditsGateA() {
  await show(gateFor('g-a', DRAFTS_A), mrWith());
  await React.act(async () => checkbox('Second finding').click());
  await edit(commentBox('Third finding')!, 'my own wording');
  await settle(700);
}

describe('a rebuilt review gate', () => {
  test('restores the unticked finding and the comment edit', async () => {
    await userEditsGateA();
    expect(requests.filter(r => r.method === 'PUT').length).toBe(1);

    await show(gateFor('g-b', DRAFTS_A), mrWith());
    expect(checkbox('First finding').checked).toBe(true);
    expect(checkbox('Second finding').checked).toBe(false);
    expect(checkbox('Third finding').checked).toBe(true);
    expect(commentBox('Third finding')!.value).toBe('my own wording');
    expect(commentBox('First finding')!.value).toBe('draft one');
  });

  test('a finding revised in this gate keeps its tick and takes the new draft', async () => {
    await userEditsGateA();
    await show(gateFor('g-b', DRAFTS_B), mrWith({ f3: { newGate: 'g-b' } }));
    expect(checkbox('Second finding').checked).toBe(false);
    expect(checkbox('Third finding').checked).toBe(true);
    expect(commentBox('Third finding')!.value).toBe('REVISED three');
  });

  test('a revision an earlier gate carried does not discard later edits', async () => {
    await userEditsGateA();
    await show(
      gateFor('g-b', DRAFTS_B),
      mrWith({ f3: { newGate: 'g-earlier' } })
    );
    expect(commentBox('Third finding')!.value).toBe('my own wording');
  });

  test('a finding new to the rebuilt gate keeps its default tick and draft', async () => {
    await userEditsGateA();
    await show(gateFor('g-b', { ...DRAFTS_A, f4: 'draft four' }), mrWith());
    expect(checkbox('Second finding').checked).toBe(false);
    expect(checkbox('Fourth finding').checked).toBe(true);
    expect(commentBox('Fourth finding')!.value).toBe('draft four');
  });

  test('a draft saved before known existed restores nothing', async () => {
    saved = {
      ticked: ['f1'],
      texts: { 'comment:f3': 'old edit' },
      notes: {},
    };
    await show(gateFor('g-b', DRAFTS_A), mrWith());
    expect(checkbox('Second finding').checked).toBe(true);
    expect(commentBox('Third finding')!.value).toBe('draft three');
  });

  test('a dropped revised comment is saved, so a later gate does not bring the old edit back', async () => {
    await userEditsGateA();
    // Gate B revises f3: the edit is dropped for the new draft.
    await show(gateFor('g-b', DRAFTS_B), mrWith({ f3: { newGate: 'g-b' } }));
    expect(commentBox('Third finding')!.value).toBe('REVISED three');
    await settle(700);
    // Gate C revises f1; f3's revised text from B must stand, not A's edit.
    await show(
      gateFor('g-c', { ...DRAFTS_B, f1: 'REVISED one' }),
      mrWith({ f1: { newGate: 'g-c' }, f3: { newGate: 'g-b' } })
    );
    expect(commentBox('Third finding')!.value).toBe('REVISED three');
    expect(commentBox('First finding')!.value).toBe('REVISED one');
    expect(checkbox('Second finding').checked).toBe(false);
  });

  test('opening a gate with nothing saved writes nothing', async () => {
    await show(gateFor('g-a', DRAFTS_A), mrWith());
    await settle(700);
    expect(requests.map(r => r.method)).toEqual(['GET']);
  });

  test('the new gate does not overwrite the saved draft before restoring it', async () => {
    await userEditsGateA();
    const before = JSON.stringify(saved);
    await show(gateFor('g-b', DRAFTS_A), mrWith());
    await settle(700);
    // Restored state equals the draft, so nothing differs to send.
    expect(JSON.stringify(saved)).toBe(before);
    expect(requests.filter(r => r.method === 'PUT').length).toBe(1);
  });

  test('submitting stops saving, so a late write cannot revive the deleted draft', async () => {
    await show(gateFor('g-a', DRAFTS_A), mrWith());
    await edit(commentBox('Third finding')!, 'typed just before submit');
    await React.act(async () => {
      container.querySelector<HTMLButtonElement>('.tui-sheet-submit')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await settle(700);
    expect(requests.filter(r => r.method === 'PUT').length).toBe(0);
  });

  test('a failed read leaves the saved draft alone', async () => {
    await userEditsGateA();
    const before = JSON.stringify(saved);
    readFails = true;
    await show(gateFor('g-b', DRAFTS_A), mrWith());
    await React.act(async () => checkbox('First finding').click());
    await settle(700);
    expect(JSON.stringify(saved)).toBe(before);
  });
});
