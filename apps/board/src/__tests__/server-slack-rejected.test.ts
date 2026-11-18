import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { bootBoardServer } from './board-server.ts';
import { slackHealthHome } from './slack-health-home.ts';

// A token Slack revoked: every call answers token_revoked (the mock keys on
// the bearer). A sweep must say so in /data.json instead of a silent zero.
const { home, stopDaemon } = slackHealthHome('board-slack-rejected-');

const board = bootBoardServer({
  preload: join(import.meta.dir, 'slack-api-mock-preload.ts'),
  env: {
    HOME: home,
    BOARD_APP_ROOT: home,
    GITLAB_TOKEN: '',
    SLACK_TOKEN: 'revoked-token',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

afterAll(() => stopDaemon());

async function slackIssue(): Promise<unknown> {
  const data = (await (await fetch(`${board.origin}/data.json`)).json()) as {
    slackIssue?: unknown;
  };
  return data.slackIssue;
}

test('a sweep with a revoked token reports the rejection in /data.json', async () => {
  const res = await fetch(`${board.origin}/slack/refresh`, { method: 'POST' });
  expect(res.status).toBe(200);
  expect(await slackIssue()).toEqual({
    kind: 'rejected',
    error: 'token_revoked',
  });
}, 15_000);
