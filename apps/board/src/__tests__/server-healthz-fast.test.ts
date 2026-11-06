import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { startBoardServer } from './board-server.ts';

// Proves src/server.ts:452ish's hoist: /healthz, /events, and the static
// shell/assets must answer even when the rt daemon is wedged (accepts the
// connection, never responds) -- the exact condition /healthz exists to let
// an operator detect. Real (non-fixture) boot, fully isolated: a fake $HOME
// with a team settings store (no config.json needed, and none written --
// see config.ts's storeOwnsRequiredFields) and a fake daemon socket that
// never answers, so this never touches the real ~/.mattstack or a real
// daemon.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-healthz-fast-'));

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

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(rtDir, { recursive: true });
writeFileSync(join(rtDir, 'api-token'), 'fake-token\n');

// Accepts the unix-socket connection but never answers -- board-secrets.ts's
// rtCommand call only gives up after its own 15s AbortSignal.timeout.
const wedgedDaemon = Bun.serve({
  unix: join(rtDir, 'rt.sock'),
  fetch: () => new Promise<Response>(() => {}),
});

// Started inside the test, not in beforeAll: the timed span is spawn to the
// first healthy /healthz.
const board = startBoardServer({
  env: {
    HOME: fakeHome,
    // Keeps the booted server's state writes out of the repo.
    BOARD_APP_ROOT: fakeHome,
    // Force every token through the (wedged) daemon path -- a token
    // inherited from the developer's own shell env would skip it and let
    // this test pass for the wrong reason.
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

afterAll(async () => {
  await board.stop();
  wedgedDaemon.stop(true);
});

test('/healthz responds fast even with a wedged rt daemon blocking every board-secret round trip', async () => {
  const start = Date.now();
  await board.ready();
  const elapsed = Date.now() - start;
  const res = await fetch(`${board.origin}/healthz`);
  expect(await res.text()).toBe('ok');
  // The wedged daemon never answers; the pre-fix code awaited it (15s
  // timeout, per token getter) before even reaching the /healthz case. The
  // span includes a cold boot, which has passed 10s on a loaded runner, so
  // the bar sits just under that 15s wait rather than near a boot time.
  expect(elapsed).toBeLessThan(14_000);
}, 30_000);
