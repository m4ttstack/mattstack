/** POST /peer-review/dismiss: the band's dismiss of a review a peer's board
    lost. Stamps that one reviewer state in a real state db, and nothing
    else. Minimal boot, same recipe as server-nudge-dismiss.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { readPeerReviews, writePeerReview } from '../peer/peer-reviews.ts';
import { openStateDb } from '../state/db.ts';
import { bootBoardServer } from './board-server.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-peer-review-dismiss-'));

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

const MR = 'https://gitlab.example.com/g/p/-/merge_requests/7';
const dbPath = join(fakeHome, 'state.db');
const db = openStateDb(dbPath);
for (const reviewer of ['grace', 'ada'])
  writePeerReview(
    {
      mrUrl: MR,
      iid: 7,
      reviewer,
      status: 'error',
      reason: 'pane closed',
      updatedAt: 1000,
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
  return fetch(`${board.origin}/peer-review/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const stored = (reviewer: string) =>
  readPeerReviews(db)
    .get(MR)
    ?.find(p => p.reviewer === reviewer);

test('stamps one reviewer state dismissed and leaves the other', async () => {
  const res = await dismiss({ mrUrl: MR, reviewer: 'grace' });
  expect(res.status).toBe(200);
  expect(typeof stored('grace')?.dismissedAt).toBe('number');
  expect(stored('ada')?.dismissedAt).toBeUndefined();
});

test('is fine on a reviewer with no state', async () => {
  expect((await dismiss({ mrUrl: MR, reviewer: 'nobody' })).status).toBe(200);
});

test('refuses a body without both an mrUrl and a reviewer', async () => {
  expect((await dismiss({ mrUrl: MR })).status).toBe(400);
  expect((await dismiss({ reviewer: 'ada' })).status).toBe(400);
});

test('refuses a body that is not json, and stamps nothing', async () => {
  const res = await fetch(`${board.origin}/peer-review/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ mrUrl: MR, reviewer: 'ada' }),
  });
  expect(res.ok).toBe(false);
  expect(stored('ada')?.dismissedAt).toBeUndefined();
});

test('refuses a non-POST', async () => {
  const res = await fetch(`${board.origin}/peer-review/dismiss`);
  expect(res.status).toBe(405);
});
