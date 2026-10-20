import { expect, test } from 'bun:test';

import { slackPosts } from '../slack-posts.ts';

const team = 'https://acme.slack.com/archives/C1/p1760000000123456';

test('the team thread leads, then code owner channels oldest first', () => {
  expect(
    slackPosts({
      slack: {
        status: 'found',
        permalink: team,
        reactions: [],
        posted: true,
      },
      slackChannel: 'code-review',
      ownerPosts: [
        { channel: 'pod-acme', permalink: 'https://a', postedAt: 5 },
        { channel: 'pod-billing', permalink: 'https://b', postedAt: 9 },
      ],
    })
  ).toEqual([
    {
      channel: 'code-review',
      permalink: team,
      team: true,
      postedAt: 1760000000123,
      reactions: [],
    },
    { channel: 'pod-acme', permalink: 'https://a', postedAt: 5 },
    { channel: 'pod-billing', permalink: 'https://b', postedAt: 9 },
  ]);
});

test('a thread not found counts for nothing, and a repeat link is dropped', () => {
  expect(
    slackPosts({
      slack: { status: 'notfound', reactions: [], posted: false },
      ownerPosts: [
        { channel: 'pod-acme', permalink: 'https://a', postedAt: 5 },
      ],
    })
  ).toEqual([{ channel: 'pod-acme', permalink: 'https://a', postedAt: 5 }]);
  expect(
    slackPosts({
      slack: { status: 'found', permalink: team, reactions: [], posted: true },
      ownerPosts: [{ channel: 'code-review', permalink: team, postedAt: 5 }],
    })
  ).toHaveLength(1);
});
