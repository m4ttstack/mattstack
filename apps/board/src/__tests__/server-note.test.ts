/** POST /note: the row's own note (B10). Writes through to the state db the
    server booted with, clears on an empty body, and refuses anything that is
    not a local POST with an MR and a string. Same minimal boot as
    server-dismiss.test.ts. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { MAX_NOTE_LEN, readNotes } from '../row-note.ts';
import { openStateDb } from '../state/db.ts';
import { bootBoardServer } from './board-server.ts';

const fakeHome = mkdtempSync(join(tmpdir(), 'board-note-route-'));

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

function note(body: unknown): Promise<Response> {
  return fetch(`${board.origin}/note`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('writes the note, then clears it on an empty save', async () => {
  const res = await note({ mrUrl: MR, text: '  rebase after !8 lands ' });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    ok: true,
    note: 'rebase after !8 lands',
  });
  expect(readNotes(db).get(MR)).toBe('rebase after !8 lands');

  const cleared = await note({ mrUrl: MR, text: '' });
  expect(cleared.status).toBe(200);
  expect(await cleared.json()).toEqual({ ok: true, note: null });
  expect(readNotes(db).has(MR)).toBe(false);
}, 15_000);

test('is POST-only and validates its body', async () => {
  expect((await fetch(`${board.origin}/note`)).status).toBe(405);
  expect((await note({ mrUrl: MR })).status).toBe(400);
  expect((await note({ text: 'orphan' })).status).toBe(400);
  expect((await note({ mrUrl: MR, text: 42 })).status).toBe(400);
  expect(
    (await note({ mrUrl: MR, text: 'x'.repeat(MAX_NOTE_LEN + 1) })).status
  ).toBe(400);
}, 15_000);
