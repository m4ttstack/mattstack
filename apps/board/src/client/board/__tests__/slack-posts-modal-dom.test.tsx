import React from 'react';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { createRoot, type Root } from 'react-dom/client';

import type { BoardMRWithReview } from '../../types.ts';
import { SlackPostsModal } from '../SlackPostsModal.tsx';

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

const POSTS = [
  { channel: 'pod-acme', permalink: 'https://slack.example.com/a/p1' },
  { channel: 'pod-billing', permalink: 'https://slack.example.com/b/p2' },
];

async function render(mr: BoardMRWithReview) {
  await React.act(async () => {
    root.render(
      <SlackPostsModal
        mr={mr}
        posts={POSTS}
        onOpen={() => {}}
        onClose={() => {}}
      />
    );
  });
  return document.body.textContent ?? '';
}

test('a GitHub row names its PR the GitHub way, with no MR in sight', async () => {
  const text = await render({
    iid: 9,
    title: 'Tidy the cache',
    webUrl: 'https://github.com/acme/webapp/pull/9',
    provider: 'github',
  } as unknown as BoardMRWithReview);
  expect(text).toContain('#9');
  expect(text).not.toMatch(/\bMR\b|!9/);
  expect(document.querySelector('[aria-label="open #9 in slack"]')).not.toBe(
    null
  );
});
