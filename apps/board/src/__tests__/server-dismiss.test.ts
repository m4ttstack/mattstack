/** POST /dismiss: the status line's "dismiss" on a failed lane. Stamps the
    lane dismissed against a real state db (BOARD_APP_ROOT points at the fake
    home), changing nothing else, and refuses a lane it does not own. Minimal
    boot, same recipe as server-reconciler-clear.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { readDoctorStates, writeDoctorState } from '../doctor-state.ts';
import { mintHandle } from '../state/agent-states.ts';
import { openStateDb } from '../state/db.ts';
import { bootBoardServer } from './board-server.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-dismiss-'));

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
// The server mints its handles off BOARD_APP_ROOT; this row has to land
// under the same one or the route would look at a different handle.
const handle = mintHandle('doctor', MR, fakeHome);
writeDoctorState(
  handle,
  { mrUrl: MR, iid: 7, status: 'error', message: 'registry push flake' },
  1000,
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
  return fetch(`${board.origin}/dismiss`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('stamps the lane dismissed, keeping its status and message', async () => {
  const res = await dismiss({ mrUrl: MR, lane: 'doctor' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; dismissedAt: number };
  expect(body.ok).toBe(true);

  const after = readDoctorStates(db).get(MR)!;
  expect(after.status).toBe('error');
  expect(after.message).toBe('registry push flake');
  expect(after.dismissedAt).toBe(body.dismissedAt);
  // The stamp is never older than the write it dismissed, which is what
  // makes the row skip the lane.
  expect(after.dismissedAt!).toBeGreaterThanOrEqual(after.updatedAt);
}, 15_000);

test('is POST-only and validates the lane and the MR', async () => {
  expect((await fetch(`${board.origin}/dismiss`)).status).toBe(405);
  expect((await dismiss({ mrUrl: MR, lane: 'gitlab' })).status).toBe(400);
  expect((await dismiss({ lane: 'doctor' })).status).toBe(400);
  expect((await dismiss({ mrUrl: `${MR}00`, lane: 'doctor' })).status).toBe(
    404
  );
}, 15_000);
