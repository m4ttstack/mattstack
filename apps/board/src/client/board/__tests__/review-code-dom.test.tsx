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

function Host({
  diffs,
  mr = MR,
}: {
  diffs?: DiffSource;
  mr?: BoardMRWithReview;
}) {
  const form = useGateForm(GATE);
  const sheet = (
    <ReviewGateSheet
      gate={GATE}
      mr={mr}
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

async function render(diffs?: DiffSource, mr?: BoardMRWithReview) {
  await React.act(async () => {
    root.render(<Host diffs={diffs} mr={mr} />);
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
  await render({ fetchFileDiff: source.fetchFileDiff });
  expect(asked).toEqual([{ mr: MR.webUrl!, file: 'lib/retry.ts' }]);
  expect(fullDiffLink('Retry loop lacks backoff')).toBeUndefined();
  expect(
    codeOf('Retry loop lacks backoff')
      .querySelector('.tui-review-code')!
      .hasAttribute('data-openable')
  ).toBe(false);
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

test('a diff the forge holds back shows the header, why, and the file on the forge', async () => {
  await render({
    fetchFileDiff: async () => ({ ...RETRY, patch: '', tooLarge: true }),
    loadView: () => import('../DiffView.tsx'),
  });
  const code = codeOf('Retry loop lacks backoff');
  expect(code.querySelector('.tui-review-code-path')!.textContent).toBe(
    'lib/retry.ts:12'
  );
  expect(code.querySelector('.tui-review-code-held')!.textContent).toBe(
    'Too large to show here.'
  );
  const open = code.querySelector<HTMLAnchorElement>('a[href]')!;
  expect(open.textContent).toContain('open on GitLab');
  expect(open.getAttribute('href')).toBe(RETRY.webUrl!);
  expect(fullDiffLink('Retry loop lacks backoff')).toBeUndefined();
  expect(
    code.querySelector('.tui-review-code')!.hasAttribute('data-openable')
  ).toBe(false);
});

test('a GitHub file links to GitHub', async () => {
  await render({
    fetchFileDiff: async () => ({
      ...RETRY,
      forge: 'github',
      webUrl: 'https://github.com/acme/widgets/pull/31/files#diff-1',
      patch: '',
      binary: true,
    }),
    loadView: () => import('../DiffView.tsx'),
  });
  const code = codeOf('Retry loop lacks backoff');
  expect(code.querySelector('a[href]')!.textContent).toContain(
    'open on GitHub'
  );
  expect(code.querySelector('.tui-review-code-held')!.textContent).toBe(
    'A binary file, with no diff to show here.'
  );
});

test("a diff that fails to load keeps the header, says why, and links to the MR's changes", async () => {
  await render({
    fetchFileDiff: async () => {
      throw new Error('GitLab answered 500 for this diff.');
    },
    loadView: () => import('../DiffView.tsx'),
  });
  const code = codeOf('Retry loop lacks backoff');
  expect(code.querySelector('.tui-review-code-path')!.textContent).toBe(
    'lib/retry.ts:12'
  );
  const alert = code.querySelector('[role="status"]')!;
  expect(alert.textContent).toBe('GitLab answered 500 for this diff.');
  expect(alert.getAttribute('data-tone')).toBe('error');
  const open = code.querySelector<HTMLAnchorElement>('a[href]')!;
  expect(open.textContent).toContain('open on GitLab');
  expect(open.getAttribute('href')).toBe(`${MR.webUrl}/diffs`);
  expect(fullDiffLink('Retry loop lacks backoff')).toBeUndefined();
  expect(code.querySelector('.tui-review-code-hint')).toBeNull();
  expect(
    code.querySelector('.tui-review-code')!.hasAttribute('data-openable')
  ).toBe(false);
});

test('the same MR and file at a new revision is fetched again', async () => {
  const calls: string[] = [];
  const fresh: DiffSource = {
    fetchFileDiff: async req => {
      calls.push(req.file);
      return req.file === RETRY.path ? RETRY : null;
    },
    loadView: () => import('../DiffView.tsx'),
  };
  const at = (updatedAt: string) =>
    ({ ...MR, updatedAt }) as unknown as BoardMRWithReview;
  await render(fresh, at('2026-09-17T01:00:00.000Z'));
  expect(calls).toHaveLength(1);
  await render(fresh, at('2026-09-17T01:00:00.000Z'));
  expect(calls).toHaveLength(1);
  await render(fresh, at('2026-09-17T02:00:00.000Z'));
  expect(calls).toHaveLength(2);
});

test('a file with no diff is asked about again on the next mount', async () => {
  let n = 0;
  const none: DiffSource = {
    fetchFileDiff: async () => {
      n++;
      return null;
    },
    loadView: () => import('../DiffView.tsx'),
  };
  await render(none);
  await React.act(async () => root.unmount());
  root = createRoot(container);
  await render(none);
  expect(n).toBe(2);
});

test('a new revision keeps the snippet and an open modal mounted, then shows the new patch', async () => {
  let patch = RETRY.patch;
  let fetches = 0;
  const live: DiffSource = {
    fetchFileDiff: async req => {
      fetches++;
      return req.file === RETRY.path ? { ...RETRY, patch } : null;
    },
    loadView: () => import('../DiffView.tsx'),
  };
  const at = (updatedAt: string) =>
    ({ ...MR, updatedAt }) as unknown as BoardMRWithReview;
  await render(live, at('2026-09-17T01:00:00.000Z'));
  await React.act(async () =>
    fullDiffLink('Retry loop lacks backoff')!.click()
  );
  const modal = dialog()!;
  expect(modal).not.toBeNull();
  patch = RETRY.patch.replace('tries++;', 'attempts++;');
  const link = fullDiffLink('Retry loop lacks backoff');
  await React.act(async () => {
    root.render(<Host diffs={live} mr={at('2026-09-17T02:00:00.000Z')} />);
    expect(dialog()).toBe(modal);
    expect(fullDiffLink('Retry loop lacks backoff')).toBe(link);
    await new Promise(r => setTimeout(r, 0));
  });
  expect(fetches).toBe(2);
  expect(dialog()).toBe(modal);
  expect(fullDiffLink('Retry loop lacks backoff')).toBe(link);
});

test('under StrictMode a first-load failure ends at the inline error and forge link', async () => {
  const failing: DiffSource = {
    fetchFileDiff: async () => {
      throw new Error('GitLab answered 500 for this diff.');
    },
    loadView: () => import('../DiffView.tsx'),
  };
  await React.act(async () => {
    root.render(
      <React.StrictMode>
        <Host diffs={failing} />
      </React.StrictMode>
    );
    await new Promise(r => setTimeout(r, 0));
  });
  const code = codeOf('Retry loop lacks backoff');
  expect(code.querySelector('[role="status"]')!.textContent).toBe(
    'GitLab answered 500 for this diff.'
  );
  expect(
    code.querySelector<HTMLAnchorElement>('a[href]')!.textContent
  ).toContain('open on GitLab');
});

test('under StrictMode a revision change during the first fetch still settles', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>(r => (release = r));
  const slow: DiffSource = {
    fetchFileDiff: async req => {
      await gate;
      return req.file === RETRY.path ? RETRY : null;
    },
    loadView: () => import('../DiffView.tsx'),
  };
  const at = (updatedAt: string) =>
    ({ ...MR, updatedAt }) as unknown as BoardMRWithReview;
  const draw = (mr: BoardMRWithReview) =>
    React.act(async () => {
      root.render(
        <React.StrictMode>
          <Host diffs={slow} mr={mr} />
        </React.StrictMode>
      );
    });
  await draw(at('2026-09-17T01:00:00.000Z'));
  await draw(at('2026-09-17T02:00:00.000Z'));
  await React.act(async () => {
    release!();
    await new Promise(r => setTimeout(r, 0));
  });
  expect(fullDiffLink('Retry loop lacks backoff')).toBeDefined();
});

test('selecting text inside the snippet does not open the full diff', async () => {
  await render({ ...source, fetchFileDiff: async () => RETRY });
  const snippet = codeOf('Retry loop lacks backoff').querySelector<HTMLElement>(
    '.tui-review-code'
  )!;
  const range = document.createRange();
  range.selectNodeContents(snippet.querySelector('.tui-review-code-path')!);
  const picked = window.getSelection()!;
  picked.removeAllRanges();
  picked.addRange(range);
  await React.act(async () => snippet.click());
  expect(dialog()).toBeNull();
  picked.removeAllRanges();
  await React.act(async () => snippet.click());
  expect(dialog()).not.toBeNull();
});
