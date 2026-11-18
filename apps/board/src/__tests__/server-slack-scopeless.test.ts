import { join } from 'path';
import { afterAll, expect, test } from 'bun:test';

import { bootBoardServer } from './board-server.ts';
import { slackHealthHome } from './slack-health-home.ts';

// A token Slack accepts that lacks a scope: auth.test passes, every channel call
// answers missing_scope (the mock keys on the bearer). A reconnect fixes it, so the sweep reports it.
const { home, stopDaemon } = slackHealthHome('board-slack-scopeless-');

const board = bootBoardServer({
  preload: join(import.meta.dir, 'slack-api-mock-preload.ts'),
  env: {
    HOME: home,
    BOARD_APP_ROOT: home,
    GITLAB_TOKEN: '',
    SLACK_TOKEN: 'scopeless-token',
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

test('a sweep with a token missing a scope reports it in /data.json', async () => {
  const res = await fetch(`${board.origin}/slack/refresh`, { method: 'POST' });
  expect(res.status).toBe(200);
  expect(await slackIssue()).toEqual({
    kind: 'rejected',
    error: 'missing_scope',
  });
}, 15_000);
