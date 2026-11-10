/** POST /nudge/dismiss: the sent-ask band's dismiss. Deletes the board's own
    sent ask for one MR from a real state db and stamps that reviewer's peer
    state dismissed. Minimal boot,
    same recipe as server-dismiss.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { bandSource } from '../client/board/ask-band.ts';
import type { BoardMRWithReview } from '../client/types.ts';
import { readSentNudges, writeSentNudge } from '../peer/nudges.ts';
import { readPeerReviews, writePeerReview } from '../peer/peer-reviews.ts';
import { openStateDb } from '../state/db.ts';
import { bootBoardServer } from './board-server.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-nudge-dismiss-'));

const teamDir = join(
  fakeHome,
  '.mattstack',
  'orgs',
  'testteam',
  'mattstack',
  'org'
);
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, 'settings.org.jsonc'),
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'mattstack.roster': [{ username: 'alice' }],
  })
);

const MR_A = 'https://gitlab.example.com/g/p/-/merge_requests/7';
const MR_B = 'https://gitlab.example.com/g/p/-/merge_requests/8';
const MR_C = 'https://gitlab.example.com/g/p/-/merge_requests/9';
const dbPath = join(fakeHome, 'state.db');
const db = openStateDb(dbPath);
for (const [i, mrUrl] of [MR_A, MR_B].entries())
  writeSentNudge(
    {
      nudgeId: `n${i}`,
      mrUrl,
      iid: 7 + i,
      reviewer: 'grace',
      sentAt: 1000,
      resolution: { result: 'done', at: 2000 },
    },
    db
  );

const PARKED_AT = Date.now() - 60_000;
writeSentNudge(
  {
    nudgeId: 'n-parked',
    mrUrl: MR_C,
    iid: 9,
    reviewer: 'grace',
    sentAt: PARKED_AT - 60_000,
    resolution: { result: 'parked', at: PARKED_AT },
  },
  db
);
writePeerReview(
  {
    mrUrl: MR_C,
    iid: 9,
    reviewer: 'grace',
    status: 'parked',
    parkedAt: PARKED_AT,
    updatedAt: PARKED_AT,
    receivedAt: PARKED_AT,
  },
  db
);

const board = bootBoardServer({
  env: {
    HOME: fakeHome,
    BOARD_APP_ROOT: fakeHome,
    BOARD_STATE_DB: dbPath,
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

function dismiss(body: unknown): Promise<Response> {
  return fetch(`${board.origin}/nudge/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('dismisses one MR sent ask and leaves the rest', async () => {
  const res = await dismiss({ mrUrl: MR_A });
  expect(res.status).toBe(200);
  const rows = readSentNudges(db);
  expect(rows.has(MR_A)).toBe(false);
  expect(rows.has(MR_B)).toBe(true);
});

test("dismissing a parked sent ask also dismisses the reviewer's parked state, so no band comes back", async () => {
  expect((await dismiss({ mrUrl: MR_C })).status).toBe(200);
  expect(readSentNudges(db).has(MR_C)).toBe(false);
  const peerReviews = readPeerReviews(db).get(MR_C) ?? [];
  expect(peerReviews[0]?.dismissedAt).toBeNumber();
  const mr = {
    iid: 9,
    webUrl: MR_C,
    author: { username: 'me', name: 'Me' },
    peerReviews,
  } as unknown as BoardMRWithReview;
  expect(bandSource(mr, 'me')).toBeNull();
});

test('is fine on an MR with no sent ask', async () => {
  expect((await dismiss({ mrUrl: MR_A })).status).toBe(200);
});

test('refuses a body without an mrUrl', async () => {
  expect((await dismiss({})).status).toBe(400);
});

test('refuses a body that is not json, and deletes nothing', async () => {
  const res = await fetch(`${board.origin}/nudge/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ mrUrl: MR_B }),
  });
  expect(res.ok).toBe(false);
  expect(readSentNudges(db).has(MR_B)).toBe(true);
});

test('refuses a non-POST', async () => {
  const res = await fetch(`${board.origin}/nudge/dismiss`);
  expect(res.status).toBe(405);
});
