/** A respond or doctor gate on someone else's MR opens read-only in the
    decision queue: the questions show, nothing can be picked or submitted,
    and the dock says whose decision it is. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import { gateReadOnlyReason } from '../decision-queue.ts';
import { DecisionQueueModal } from '../DecisionQueueModal.tsx';
import { installFakeResizeObserver } from './fake-resize-observer.ts';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const theirs = {
  iid: 1271,
  title: 'fix the separator',
  webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1271',
  sourceBranch: 'separator',
  targetBranch: 'main',
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  author: { username: 'pquist', name: 'Pia Quist' },
  pipelineState: 'passed',
  blockers: { any: false, hasConflicts: false },
  reviews: { isApproved: false, given: 0, required: 1, remaining: 1 },
} as unknown as BoardMRWithReview;
const mine = {
  ...theirs,
  author: { username: 'rmarlow', name: 'Rae Marlow' },
} as BoardMRWithReview;

function gate(kind: string): GateRow {
  return {
    gateId: `g-${kind}`,
    subject: `mr:${theirs.webUrl}`,
    kind,
    label: kind,
    status: 'open',
    openedAt: Date.now() - 60_000,
    origin: { paneId: 'pane-9', worktree: '/work/demo' },
    questions: [
      {
        id: 'go',
        label: 'Rebase onto main and push?',
        multi: false,
        options: ['yes', 'no'],
      },
    ],
  };
}

let root: Root;
let container: HTMLElement;
let posts: string[];

beforeEach(() => {
  installFakeResizeObserver();
  posts = [];
  (globalThis as { fetch: unknown }).fetch = async (
    input: RequestInfo | URL
  ) => {
    posts.push(typeof input === 'string' ? input : input.toString());
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

test('respond and doctor gates are read-only on someone else\'s MR and on an "all" board', () => {
  for (const kind of ['respond-plan', 'respond-post', 'doctor-escalation']) {
    expect(gateReadOnlyReason(gate(kind), theirs, 'rmarlow')).toBe(
      "Only !1271's author can answer this. You're viewing it read-only."
    );
    expect(gateReadOnlyReason(gate(kind), mine, null)).toBe(
      'Set your seat in board settings to answer gates on your own MRs.'
    );
    expect(gateReadOnlyReason(gate(kind), mine, 'rmarlow')).toBeNull();
  }
});

test("a review or stage gate stays answerable on someone else's MR", () => {
  expect(gateReadOnlyReason(gate('review-post'), theirs, 'rmarlow')).toBeNull();
  expect(gateReadOnlyReason(gate('ship'), theirs, 'rmarlow')).toBeNull();
});

test('the read-only face shows the questions but nothing to pick, submit or focus', async () => {
  await React.act(async () => {
    root.render(
      <DecisionQueueModal
        gate={gate('doctor-escalation')}
        mr={theirs}
        position={1}
        states={['active']}
        readOnly="Only !1271's author can answer this. You're viewing it read-only."
        onClose={() => {}}
        onNext={() => {}}
        onBack={() => {}}
        onFocusPane={() => {}}
        onAnswered={() => {}}
        onContinue={() => {}}
      />
    );
  });
  const sheet = document.body;
  expect(sheet.textContent).toContain('Rebase onto main and push?');
  const notice = sheet.querySelector('.tui-sheet-main [role="note"]');
  expect(notice?.textContent).toBe(
    "Only !1271's author can answer this. You're viewing it read-only."
  );
  expect(sheet.querySelector('.tui-gate-question[data-locked]')).not.toBeNull();
  const labels = [...sheet.querySelectorAll('button')].map(b =>
    b.textContent?.trim()
  );
  expect(labels).not.toContain('submit');
  expect(labels).not.toContain('focus pane');
  expect(labels).not.toContain('reset');
  const choices = sheet.querySelectorAll(
    '.tui-gate-question input:not([disabled]), .tui-gate-question button:not([disabled])'
  );
  expect(choices.length).toBe(0);
  expect(posts).toEqual([]);
});
