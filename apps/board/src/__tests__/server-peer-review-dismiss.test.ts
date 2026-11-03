/** POST /peer-review/dismiss: the band's dismiss of a review a peer's board
    lost. Stamps that one reviewer state in a real state db, and nothing
    else. Minimal boot, same recipe as server-nudge-dismiss.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { readPeerReviews, writePeerReview } from '../peer/peer-reviews.ts';
import { openStateDb } from '../state/db.ts';

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

const PORT = 47963;
const proc = Bun.spawn(
  ['bun', 'run', join(import.meta.dir, '..', 'server.ts')],
  {
    env: {
      ...process.env,
      HOME: fakeHome,
      BOARD_APP_ROOT: fakeHome,
      BOARD_STATE_DB: dbPath,
      PORT: String(PORT),
      GITLAB_TOKEN: '',
      SLACK_TOKEN: '',
      SWITCHBOARD_TOKEN: '',
      SWITCHBOARD_ADMIN_TOKEN: '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  }
);

afterAll(() => proc.kill());

async function ready(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return;
    } catch {
      // server not listening yet
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server never came up');
}

function dismiss(body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${PORT}/peer-review/dismiss`, {
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
  await ready();
  const res = await dismiss({ mrUrl: MR, reviewer: 'grace' });
  expect(res.status).toBe(200);
  expect(typeof stored('grace')?.dismissedAt).toBe('number');
  expect(stored('ada')?.dismissedAt).toBeUndefined();
});

test('is fine on a reviewer with no state', async () => {
  await ready();
  expect((await dismiss({ mrUrl: MR, reviewer: 'nobody' })).status).toBe(200);
});

test('refuses a body without both an mrUrl and a reviewer', async () => {
  await ready();
  expect((await dismiss({ mrUrl: MR })).status).toBe(400);
  expect((await dismiss({ reviewer: 'ada' })).status).toBe(400);
});

test('refuses a body that is not json, and stamps nothing', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/peer-review/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ mrUrl: MR, reviewer: 'ada' }),
  });
  expect(res.ok).toBe(false);
  expect(stored('ada')?.dismissedAt).toBeUndefined();
});

test('refuses a non-POST', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/peer-review/dismiss`);
  expect(res.status).toBe(405);
});
