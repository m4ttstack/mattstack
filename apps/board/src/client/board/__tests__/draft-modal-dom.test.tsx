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

async function render(
  canPost: boolean,
  on: BoardMRWithReview = mr
): Promise<string[]> {
  await React.act(async () => {
    root.render(
      <DraftModal
        mr={on}
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

test('a held draft on a GitHub row follows the same author rule', async () => {
  const pr = {
    ...mr,
    iid: 7,
    webUrl: 'https://github.com/acme/webapp/pull/7',
    provider: 'github',
  } as unknown as BoardMRWithReview;
  expect(await render(true, pr)).toEqual(['dismiss', 'post']);
  expect(await render(false, pr)).toEqual(['dismiss']);
  expect(document.body.textContent).toContain('only the author posts');
});

async function postWith(
  reply: Response,
  on: BoardMRWithReview = mr
): Promise<string> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => reply) as unknown as typeof fetch;
  try {
    await render(true, on);
    const click = async (label: string) =>
      React.act(async () => {
        const b = [...document.querySelectorAll('button')].find(
          x => x.textContent?.trim() === label
        );
        b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    await click('post');
    await click('confirm post');
    return document.querySelector('.tui-draft-actions')?.textContent ?? '';
  } finally {
    globalThis.fetch = real;
  }
}

test('a note with no answer says to check the PR and keeps post offered', async () => {
  const text = await postWith(
    Response.json({ reason: 'the note may have posted' }, { status: 504 })
  );
  expect(text).toContain('no answer; the note may have posted, check the PR');
  expect(text).not.toContain('nothing was sent');
  expect(
    document.querySelector('.tui-draft-actions .tui-draft-note')
  ).not.toBeNull();
  expect(document.querySelector('.tui-draft-error')).toBeNull();
  expect(
    [...document.querySelectorAll('.tui-draft-actions button')].map(b =>
      b.textContent?.trim()
    )
  ).toEqual(['dismiss', 'post']);
});

test('any other failed post keeps the nothing-was-sent message', async () => {
  const text = await postWith(Response.json({}, { status: 502 }));
  expect(text).toContain('nothing was sent');
  expect(document.querySelector('.tui-draft-error')).not.toBeNull();
  expect(document.querySelector('.tui-draft-note')).toBeNull();
});

test('a refused post says why instead of nothing-was-sent', async () => {
  const text = await postWith(
    Response.json({ reason: 'the PR is closed' }, { status: 409 })
  );
  expect(text).toContain("couldn't post: the PR is closed");
  expect(text).not.toContain('nothing was sent');
  expect(document.querySelector('.tui-draft-error')).not.toBeNull();
  expect(document.querySelector('.tui-draft-note')).toBeNull();
});

test('a reasonless failure keeps the semicolon wording', async () => {
  const text = await postWith(Response.json({}, { status: 502 }));
  expect(text).toContain('action failed; nothing was sent, try again');
});

test('a GitHub row with no answer says to check the PR', async () => {
  const pr = {
    ...mr,
    iid: 7,
    webUrl: 'https://github.com/acme/webapp/pull/7',
    provider: 'github',
  } as unknown as BoardMRWithReview;
  const text = await postWith(
    Response.json({ reason: 'the note may have posted' }, { status: 504 }),
    pr
  );
  expect(text).toContain('no answer; the note may have posted, check the PR');
});
