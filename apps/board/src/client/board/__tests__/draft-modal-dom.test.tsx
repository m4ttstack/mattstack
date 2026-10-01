/** A held doctor note posts only from its MR author's board; anyone else
    can read it and dismiss the local copy. */

import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { BoardMRWithReview, DraftInfo } from '../../types.ts';
import { DraftModal } from '../DraftModal.tsx';

GlobalRegistrator.register({ url: 'http://localhost/' });

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await React.act(async () => root.unmount());
  container.remove();
});

const mr = {
  iid: 1418,
  title: 'Port the flows',
  webUrl: 'https://gitlab.example.com/acme/webapp/-/merge_requests/1418',
} as unknown as BoardMRWithReview;
const draft = { kind: 'ci-note', body: 'the cache key changed' } as DraftInfo;

async function render(canPost: boolean): Promise<string[]> {
  await React.act(async () => {
    root.render(
      <DraftModal
        mr={mr}
        draft={draft}
        local
        canPost={canPost}
        onResolved={() => {}}
        onClose={() => {}}
      />
    );
  });
  return [...document.querySelectorAll('.tui-draft-actions button')].map(
    b => b.textContent?.trim() ?? ''
  );
}

test("the author's board can post the held note or dismiss it", async () => {
  expect(await render(true)).toEqual(['dismiss', 'post']);
});

test("someone else's board can only dismiss it", async () => {
  expect(await render(false)).toEqual(['dismiss']);
  expect(document.body.textContent).toContain('only the author posts');
});
