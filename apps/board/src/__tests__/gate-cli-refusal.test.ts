import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import {
  dbPathForRoot,
  insertAgentState,
  mintHandle,
  openStateDb,
} from '../state/index.ts';

const MR_URL = 'https://gitlab.com/acme/webapp/-/merge_requests/4821';
let dir: string;
let server: ReturnType<typeof Bun.serve> | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gate-cli-'));
});

afterEach(() => {
  server?.stop(true);
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

test('gate open against a daemon that answers 413 exits 1 with a clear error, not a TypeError', async () => {
  const sock = join(dir, 'fake.sock');
  server = Bun.serve({
    unix: sock,
    fetch: () => new Response('null', { status: 413 }),
  } as never);

  const db = openStateDb(dbPathForRoot(dir), 'cli');
  const statePath = mintHandle('review', MR_URL, dir);
  insertAgentState(
    'review',
    MR_URL,
    4821,
    {
      mrUrl: MR_URL,
      iid: 4821,
      status: 'reviewing',
      startedAt: 1,
      updatedAt: 1,
    },
    statePath,
    db
  );
  const openFile = join(dir, 'open.json');
  writeFileSync(
    openFile,
    JSON.stringify({
      questions: [{ id: 'q', label: 'Q?', multi: false, options: ['a'] }],
      context: 'x'.repeat(1024 * 1024),
    })
  );

  const proc = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, '../../bin/gate.ts'),
      'open',
      statePath,
      '--kind',
      'review-post',
      '--open-file',
      openFile,
    ],
    {
      env: { HOME: dir, PATH: process.env.PATH ?? '', RT_DAEMON_SOCK: sock },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const [stderr, code] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  expect(code).toBe(1);
  expect(stderr).toContain('request too large');
  expect(stderr).not.toContain('TypeError');
  expect(stderr).not.toContain('res.ok');
});
