/** POST /nudge/dismiss: the sent-ask band's dismiss. Deletes the board's own
    sent ask for one MR from a real state db, and nothing else. Minimal boot,
    same recipe as server-dismiss.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { readSentNudges, writeSentNudge } from '../peer/nudges.ts';
import { openStateDb } from '../state/db.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-nudge-dismiss-'));

const teamDir = join(fakeHome, '.mattstack', 'teams', 'testteam', 'mattstack');
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, 'settings.team.jsonc'),
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'board.members': [{ username: 'alice' }],
  })
);

const MR_A = 'https://gitlab.example.com/g/p/-/merge_requests/7';
const MR_B = 'https://gitlab.example.com/g/p/-/merge_requests/8';
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

const PORT = 47962;
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
  return fetch(`http://127.0.0.1:${PORT}/nudge/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('dismisses one MR sent ask and leaves the rest', async () => {
  await ready();
  const res = await dismiss({ mrUrl: MR_A });
  expect(res.status).toBe(200);
  const rows = readSentNudges(db);
  expect(rows.has(MR_A)).toBe(false);
  expect(rows.has(MR_B)).toBe(true);
});

test('is fine on an MR with no sent ask', async () => {
  await ready();
  expect((await dismiss({ mrUrl: MR_A })).status).toBe(200);
});

test('refuses a body without an mrUrl', async () => {
  await ready();
  expect((await dismiss({})).status).toBe(400);
});

test('refuses a body that is not json, and deletes nothing', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/nudge/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ mrUrl: MR_B }),
  });
  expect(res.ok).toBe(false);
  expect(readSentNudges(db).has(MR_B)).toBe(true);
});

test('refuses a non-POST', async () => {
  await ready();
  const res = await fetch(`http://127.0.0.1:${PORT}/nudge/dismiss`);
  expect(res.status).toBe(405);
});
