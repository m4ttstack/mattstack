import { cpSync, existsSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { bootBoardServer } from './board-server.ts';

// Boots the real server with BOARD_FIXTURE pointing at a temp fixture dir and
// asserts the canned endpoints answer. Spawned as a subprocess because
// server.ts runs at module top level.
const dir = mkdtempSync(join(tmpdir(), 'board-fixture-'));
cpSync(
  join(import.meta.dir, '..', '..', 'tests', 'fixture', 'config.json'),
  join(dir, 'config.json')
);
writeFileSync(
  join(dir, 'data.json'),
  JSON.stringify({
    title: 'MRs ready for review',
    defaultMember: 'all',
    members: [{ username: 'matt', name: 'Matthew Goodwin', count: 1 }],
    allMembers: [
      { username: 'matt', name: 'Matthew Goodwin', hidden: false, count: 1 },
    ],
    mrs: [
      {
        iid: 1,
        title: 't',
        webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
        author: { username: 'matt', name: 'Matthew Goodwin' },
        sourceBranch: 'b',
        targetBranch: 'main',
        updatedAt: '2026-08-19T00:00:00Z',
        reviews: { given: 0, required: 0, isApproved: false, reviewers: [] },
        blockers: { any: false },
        reviewerComments: 0,
        unresolvedThreads: 0,
        isDraft: false,
      },
    ],
    fetchedAt: 1755600000000,
    fetchError: null,
    local: true,
    slackEnabled: false,
    slackTemplates: {
      single: '{title}: {url}',
      multiHeader: '{count} ready',
      multiItem: '- {title}',
    },
    dataSyncedAt: 1755600000000,
    scopeUncovered: [],
    scopeWindowDays: null,
    staleAfterDays: 90,
    canInvite: false,
    peering: null,
  })
);
writeFileSync(
  join(dir, 'discussions.json'),
  JSON.stringify({ threads: [], comments: [] })
);
writeFileSync(join(dir, 'review-report.md'), '# canned review\n');
writeFileSync(join(dir, 'respond-report.md'), '# canned respond report\n');

// A sandboxed HOME: proves containment lands state.db in the fixture dir
// even though real-HOME resolution (boardStateRoot()'s default) is what
// every store's getStateDb() would fall back to without the BOARD_STATE_DB
// override server.ts sets for fixture mode.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-fixture-home-'));

// BOARD_APP_ROOT keeps the booted server's state writes out of the repo.
const board = bootBoardServer({
  env: {
    HOME: fakeHome,
    BOARD_FIXTURE: dir,
    BOARD_APP_ROOT: dir,
  },
});

test('fixture mode serves canned endpoints and refuses POSTs', async () => {
  const data = (await (await fetch(`${board.origin}/data.json`)).json()) as {
    mrs: unknown[];
    fetchedAt: number;
    seatUnverified: boolean;
  };
  expect(data.fetchedAt).toBe(1755600000000);
  expect(data.seatUnverified).toBe(false);
  expect(data.mrs.length).toBe(1);
  const disc = await fetch(
    `${board.origin}/discussions?repo=x&iid=1&author=matt`
  );
  expect(((await disc.json()) as { threads: unknown[] }).threads).toEqual([]);
  const report = await fetch(`${board.origin}/review/report?mr=x`);
  expect(await report.text()).toContain('canned review');
  const respondReport = await fetch(`${board.origin}/respond/report?mr=x`);
  expect(await respondReport.text()).toContain('canned respond report');
  const boards = await fetch(`${board.origin}/peer/boards`);
  expect(await boards.json()).toEqual({ boards: [] });
  const member = await fetch(`${board.origin}/member?u=matt`);
  expect(((await member.json()) as { mrs: unknown[] }).mrs.length).toBe(1);
  const post = await fetch(`${board.origin}/review`, {
    method: 'POST',
    body: '{}',
  });
  expect(post.status).toBe(501);
  const shell = await (await fetch(`${board.origin}/`)).text();
  expect(shell).toContain('<div id="root">');
}, 30_000);

test('fixture mode never opens state.db under HOME', async () => {
  // The boot-time getStateDb('server') call (server.ts) runs unconditionally
  // and is the very first thing that could open a db in this process, so its
  // location alone proves containment holds regardless of which route (if
  // any) later touches state -- not just the routes the fixture switch
  // happens to shadow today.
  expect(existsSync(join(dir, 'state.db'))).toBe(true);
  expect(existsSync(join(fakeHome, '.mattstack', 'board', 'state.db'))).toBe(
    false
  );
});
