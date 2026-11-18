import { expect, test, afterAll } from 'bun:test';

import { bootBoardServer } from './board-server.ts';
import { slackHealthHome } from './slack-health-home.ts';

// No SLACK_TOKEN in the env, and the daemon refuses secrets:read: the board
// cannot read its Slack token. The team has a review channel, so the board
// says so instead of quietly hiding its Slack features.
const { home, stopDaemon } = slackHealthHome('board-slack-unreadable-');

const board = bootBoardServer({
  env: {
    HOME: home,
    BOARD_APP_ROOT: home,
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

afterAll(() => stopDaemon());

test('an unreadable Slack token is reported in /data.json', async () => {
  const data = (await (await fetch(`${board.origin}/data.json`)).json()) as {
    slackEnabled: boolean;
    slackIssue?: { kind: string; detail: string };
  };
  expect(data.slackEnabled).toBe(false);
  expect(data.slackIssue?.kind).toBe('unreadable');
  expect(data.slackIssue?.detail).toContain('not implemented');
}, 15_000);
