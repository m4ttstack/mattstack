/** A drafted finding's The Code section: the file header from the
    finding's anchor, the "view full diff" link once the sheet's DiffSource
    has the file, and the full-diff modal it opens (Escape closes it back to
    the link; the sheet stays open). */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { GateRow } from '../../../gates/store.ts';
import type { BoardMRWithReview } from '../../types.ts';
import {
  DiffSourceContext,
  type DiffSource,
  type FileDiff,
} from '../diff-source.ts';
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

const FINDINGS = [
  {
    id: 'f1',
    severity: 'important',
    title: 'Retry loop lacks backoff',
    body: 'The loop retries at once.',
    file: 'lib/retry.ts:12',
    comment: 'Could this back off between tries?',
  },
  {
    id: 'f2',
    severity: 'minor',
    title: 'Magic number',
    body: 'Five is unexplained.',
    file: 'lib/retry.ts:10',
    comment: 'Maybe name the five?',
  },
];

const GATE: GateRow = {
  gateId: 'g-review-code',
  subject: 'mr:gitlab.example.com/acme/widgets/-/merge_requests/31',
  kind: 'review-post',
  label: 'review',
  status: 'open',
  openedAt: 1,
  context: j({
    'gate-ctx': 'review@1',
    readiness: 'with-fixes',
    summary: 'Two small things.',
    findings: { important: 1, minor: 1 },
    editable: true,
    summaryComments: { approve: 'Looks good.', comment: 'Two notes inline.' },
  }),
  questions: [
    {
      id: 'findings-1',
      label: 'Post which findings to !31?',
      multi: true,
      context: j({ 'gate-ctx': 'findings@1', findings: FINDINGS }),
      options: [
        { value: 'f1', label: '[Important] Retry loop lacks backoff' },
        { value: 'f2', label: '[Minor] Magic number' },
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
  title: 'retry with backoff',
  webUrl: 'https://gitlab.example.com/acme/widgets/-/merge_requests/31',
  author: { username: 'paul', name: 'Paul' },
  sourceBranch: 'retry-backoff',
  targetBranch: 'main',
  createdAt: '2026-09-17T00:00:00.000Z',
  diff: { additions: 4, deletions: 1, filesChanged: 1 },
} as unknown as BoardMRWithReview;

const RETRY: FileDiff = {
  path: 'lib/retry.ts',
  forge: 'gitlab',
  webUrl: `${MR.webUrl}/diffs#retry.ts`,
  patch: [
    '@@ -8,5 +8,6 @@ export async function retry(fn) {',
    ' export async function retry(fn) {',
    '   let tries = 0;',
    '-  while (tries < 5) {',
    '+  while (tries < 5) {',
    '+    tries++;',
    '     await fn();',
    '   }',
    '',
  ].join('\n'),
};

let asked: Array<{ mr: string; file: string }>;
const source: DiffSource = {
  fetchFileDiff: async req => {
    asked.push(req);
    return req.file === RETRY.path ? RETRY : null;
  },
  loadView: () => import('../DiffView.tsx'),
};

let root: Root;
let container: HTMLElement;
let sheetCloses: number;

beforeEach(() => {
  localStorage.clear();
  asked = [];
  sheetCloses = 0;
  (globalThis as { fetch: unknown }).fetch = async () =>
    new Response('none', { status: 404 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

function Host({ diffs }: { diffs?: DiffSource }) {
  const form = useGateForm(GATE);
  const sheet = (
    <ReviewGateSheet
      gate={GATE}
      mr={MR}
      form={form}
      queue={{
        index: 0,
        total: 1,
        states: ['active'],
        canPrev: false,
        canNext: false,
        onPrev: () => {},
        onNext: () => {},
      }}
      onClose={() => sheetCloses++}
      onContinue={() => {}}
      onFocusPane={() => {}}
    />
  );
  return diffs ? (
    <DiffSourceContext.Provider value={diffs}>
      {sheet}
    </DiffSourceContext.Provider>
  ) : (
    sheet
  );
}

async function render(diffs?: DiffSource) {
  await React.act(async () => {
    root.render(<Host diffs={diffs} />);
    await new Promise(r => setTimeout(r, 0));
  });
}

const codeOf = (title: string) => {
  const card = [...container.querySelectorAll('.tui-review-card')].find(
    c => c.querySelector('.tui-review-finding-title')?.textContent === title
  )!;
  return card.querySelector<HTMLElement>('[data-section="code"]')!;
};
const fullDiffLink = (title: string) =>
  [...codeOf(title).querySelectorAll('button')].find(b =>
    b.textContent?.includes('view full diff')
  );
const dialog = () =>
  document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label^="Full diff"]'
  );

test('without a diff source the code section is the file header alone', async () => {
  await render();
  const code = codeOf('Retry loop lacks backoff');
  expect(code.querySelector('.tui-review-code-path')!.textContent).toBe(
    'lib/retry.ts:12'
  );
  expect(code.querySelector('.tui-review-code-line')!.textContent).toBe(':12');
  expect(fullDiffLink('Retry loop lacks backoff')).toBeUndefined();
  expect(
    code.querySelector('.tui-review-code')!.hasAttribute('data-openable')
  ).toBe(false);
});

test('a source with diffs but no renderer leaves the file header alone', async () => {
  await render({ fetchFileDiff: async () => RETRY });
  expect(fullDiffLink('Retry loop lacks backoff')).toBeUndefined();
});

test('the source is asked once per file, with the MR and the path', async () => {
  await render(source);
  expect(asked).toEqual([{ mr: MR.webUrl!, file: 'lib/retry.ts' }]);
});

test('once the diff is in, view full diff opens the whole file with every finding on it', async () => {
  await render(source);
  const link = fullDiffLink('Retry loop lacks backoff')!;
  expect(link).toBeDefined();
  await React.act(async () => link.click());
  const modal = dialog()!;
  expect(modal.getAttribute('aria-label')).toBe('Full diff of lib/retry.ts');
  expect(modal.textContent).toContain('!31 · +2 −1 · 2 findings on this file');
  expect(modal.textContent).toContain('fetched from GitLab');
  const open = modal.querySelector<HTMLAnchorElement>('a[href]')!;
  expect(open.textContent).toContain('open on GitLab');
  expect(open.getAttribute('href')).toBe(RETRY.webUrl!);
  expect(open.getAttribute('target')).toBe('_blank');
  expect(document.activeElement).toBe(modal);
});

test('clicking the snippet opens the full diff too', async () => {
  await render(source);
  await React.act(async () =>
    codeOf('Magic number')
      .querySelector<HTMLElement>('.tui-review-code')!
      .click()
  );
  expect(dialog()).not.toBeNull();
});

test('Escape closes the full diff back to the link, and the sheet stays open', async () => {
  await render(source);
  const link = fullDiffLink('Retry loop lacks backoff')!;
  await React.act(async () => link.click());
  await React.act(async () => {
    dialog()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
  });
  expect(dialog()).toBeNull();
  expect(sheetCloses).toBe(0);
  expect(document.activeElement).toBe(
    fullDiffLink('Retry loop lacks backoff')!
  );
});

test('Tab stays inside the full diff', async () => {
  await render(source);
  await React.act(async () =>
    fullDiffLink('Retry loop lacks backoff')!.click()
  );
  const modal = dialog()!;
  const focusable = [...modal.querySelectorAll<HTMLElement>('button, [href]')];
  focusable[focusable.length - 1]!.focus();
  const ev = new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
  });
  await React.act(async () => {
    document.activeElement!.dispatchEvent(ev);
  });
  expect(ev.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(focusable[0]!);
});
