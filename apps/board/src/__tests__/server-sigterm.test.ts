import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { startBoardServer } from './board-server.ts';

// Sparkle replaces the whole bundle on update (this process's inode vanishes
// mid-run) and launchd sends SIGTERM before its grace period expires either
// way -- proves the board exits promptly and cleanly on both, rather than
// leaking past its grace period into a SIGKILL. Real (non-fixture) boot, same
// isolation as server-healthz-fast.test.ts.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-sigterm-'));

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

// Started inside the test, not in beforeAll: this test owns the signal and
// the exit code.
const board = startBoardServer({
  env: {
    HOME: fakeHome,
    // Keeps the booted server's state writes out of the repo.
    BOARD_APP_ROOT: fakeHome,
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

afterAll(() => board.stop());

test('SIGTERM exits promptly with code 0, not leaked past the grace period', async () => {
  await board.ready();
  const signalled = Date.now();
  expect(await board.terminate('SIGTERM')).toBe(0);
  // launchd's grace period is short; a shutdown that blocks past it is the bug.
  expect(Date.now() - signalled).toBeLessThan(5_000);

  // The port is actually released, not just the process reaping -- a lingering
  // listener would mean shutdown() returned before httpServer.stop() took effect.
  await expect(
    fetch(`${board.origin}/healthz`, {
      signal: AbortSignal.timeout(500),
    })
  ).rejects.toThrow();
}, 70_000);
