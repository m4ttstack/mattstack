import { expect, test } from 'bun:test';

import { rowActions } from '../row-actions.ts';
import { actionEnvOf, mrx, ownEnv, type ownIdle } from './menu-fixtures.ts';

const found = {
  status: 'found',
  reactions: [],
  permalink: 'https://x',
  posted: true,
};
const notFound = { status: 'notfound', reactions: [], posted: false };

const openPost = (mr: typeof ownIdle) =>
  rowActions(mr, actionEnvOf(ownEnv, mr)).find(
    a => a.key === 'open-slack-post'
  )!;
const ownerPost = (channel: string, postedAt: number) => ({
  channel,
  permalink: `https://slack.example.com/archives/${channel}/p${postedAt}`,
  postedAt,
});

test('one post opens it straight away, from either channel', () => {
  expect(openPost(mrx(270, { slack: found })).request).toEqual({
    kind: 'open',
    url: 'https://x',
  });
  const ownerOnly = mrx(271, {
    slack: notFound,
    ownerPosts: [ownerPost('pod-acme', 1)],
  });
  expect(openPost(ownerOnly).request).toEqual({
    kind: 'open',
    url: 'https://slack.example.com/archives/pod-acme/p1',
  });
  expect(openPost(ownerOnly).blocked).toBeUndefined();
});

test('several posts open the chooser and say how many', () => {
  const action = openPost(
    mrx(272, {
      slack: found,
      ownerPosts: [ownerPost('pod-acme', 1), ownerPost('pod-billing', 2)],
    })
  );
  expect(action.request).toEqual({ kind: 'slack-posts' });
  expect(action.label).toBe('open MR post in slack…');
  expect(action.hint).toBe('3 posts');
  expect(action.blocked).toBeUndefined();
});

test('a found thread with no link and no other post says so', () => {
  expect(
    openPost(mrx(273, { slack: { ...found, permalink: undefined } })).blocked
  ).toBe('no link yet');
});
