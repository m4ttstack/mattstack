import { expect, test } from 'bun:test';

import type { BoardMR } from '../../../data.ts';
import type { ActionResult } from '../../api.ts';
import { needsThreadLookup, startSlackPost } from '../slack-post-flow.ts';

const REPO = 'gitlab.example.com/acme/webapp';
const URL = 'https://gitlab.example.com/acme/webapp/-/merge_requests/7';
const mr = (over: Partial<BoardMR> = {}) =>
  ({ iid: 7, webUrl: URL, rtRepo: REPO, ...over }) as BoardMR;

const ok = (body: unknown): ActionResult =>
  ({ ok: true, status: 200, body, text: '' }) as ActionResult;
const fail = (status: number, text: string): ActionResult =>
  ({ ok: false, status, body: null, text }) as ActionResult;

const preview = (over: Record<string, unknown> = {}) => ({
  text: 'x',
  team: { channel: 'code-review', posted: false },
  direct: false,
  ownSections: [],
  unchecked: [],
  channels: [{ channel: 'pod-acme', sections: ['Acme - #pod-acme'] }],
  skipped: [],
  ...over,
});

function run(
  answers: Record<string, ActionResult>,
  target = mr(),
  ownerRepos = [REPO]
) {
  const events: string[] = [];
  const opened: unknown[] = [];
  const done = startSlackPost(target, {
    post: async (path, payload) => {
      events.push(`post ${path} ${JSON.stringify(payload)}`);
      return answers[path]!;
    },
    ownerRepos,
    startToast: text => {
      events.push(`toast ${text}`);
      return {
        done: t => events.push(`done ${t}`),
        fail: t => events.push(`fail ${t}`),
      };
    },
    openDialog: (_mr, p) => opened.push(p),
    reload: () => events.push('reload'),
  });
  return { done, events, opened };
}

test('a repo without code owner channels posts straight to the team channel', async () => {
  const { done, events, opened } = run(
    { '/slack/post': ok({ ok: true, posted: 1 }) },
    mr(),
    []
  );
  await done;
  expect(events).toEqual([
    'toast posting !7 to slack…',
    `post /slack/post {"mrUrls":["${URL}"]}`,
    'done posted !7 to slack',
    'reload',
  ]);
  expect(opened).toEqual([]);
});

test('a thread found while posting is linked, not posted again', async () => {
  const { done, events } = run(
    { '/slack/post': ok({ ok: true, linked: true }) },
    mr(),
    []
  );
  await done;
  expect(events).toContain('done !7 already in slack... linked');
});

test('only the team channel left: posts there without a dialog', async () => {
  const { done, events, opened } = run({
    '/slack/owners/preview': ok(preview({ direct: true, channels: [] })),
    '/slack/owners/post': ok({
      posted: [{ channel: 'code-review', permalink: 'p', team: true }],
      failed: [],
    }),
  });
  await done;
  expect(events).toEqual([
    'toast checking where !7 goes in slack…',
    `post /slack/owners/preview {"mrUrl":"${URL}"}`,
    `post /slack/owners/post {"mrUrl":"${URL}","team":true}`,
    'done posted !7 to #code-review',
    'reload',
  ]);
  expect(opened).toEqual([]);
});

test('other code owners to ask: opens the dialog with the preview', async () => {
  const p = preview();
  const { done, events, opened } = run({
    '/slack/owners/preview': ok(p),
  });
  await done;
  expect(opened).toEqual([p]);
  expect(events.filter(e => e.startsWith('post '))).toHaveLength(1);
  expect(events).toContain('done !7 needs code owners too, pick channels');
});

test('a failed preview says why and opens nothing', async () => {
  const { done, events, opened } = run({
    '/slack/owners/preview': fail(502, 'could not read approvals'),
  });
  await done;
  expect(events).toContain(
    'fail could not check slack for !7 (502): could not read approvals'
  );
  expect(opened).toEqual([]);
});

test('a failed direct post says why', async () => {
  const { done, events } = run({
    '/slack/owners/preview': ok(preview({ direct: true, channels: [] })),
    '/slack/owners/post': ok({
      posted: [],
      failed: [{ channel: 'code-review', error: 'not_in_channel' }],
    }),
  });
  await done;
  expect(events).toContain(
    'fail slack post failed for !7: #code-review failed: not_in_channel'
  );
});

const NOW = 1_000_000;
const on = { local: true, slackEnabled: true };
const withSlack = (status: 'found' | 'notfound', checkedAt?: number) =>
  ({
    ...mr(),
    slack: { status, reactions: [], posted: status === 'found', checkedAt },
  }) as BoardMR;

test('opening a menu looks for a thread the board has never checked', () => {
  expect(needsThreadLookup(mr(), NOW, on)).toBe(true);
});

test('a thread not found over a minute ago is looked for again', () => {
  expect(needsThreadLookup(withSlack('notfound', NOW - 61_000), NOW, on)).toBe(
    true
  );
});

test('a recent check, a found thread, or no slack here skips the lookup', () => {
  expect(needsThreadLookup(withSlack('notfound', NOW - 10_000), NOW, on)).toBe(
    false
  );
  expect(needsThreadLookup(withSlack('found', 0), NOW, on)).toBe(false);
  expect(needsThreadLookup(mr(), NOW, { ...on, local: false })).toBe(false);
  expect(needsThreadLookup(mr(), NOW, { ...on, slackEnabled: false })).toBe(
    false
  );
  expect(needsThreadLookup(mr({ webUrl: null }), NOW, on)).toBe(false);
});
