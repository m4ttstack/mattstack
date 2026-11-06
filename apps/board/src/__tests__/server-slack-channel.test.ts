import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { bootBoardServer } from './board-server.ts';

// Proves /slack/resolve and /slack/post reject a `channel` body value outside
// the configured set (the team's review channel + every tab's slackChannel, see
// configuredSlackChannels in data.ts) with a 400 before ever touching Slack
// or GitLab. Real (non-fixture) boot -- fixture mode always reports slack as
// unconfigured (server.ts's getSlackToken short-circuits to null under
// BOARD_FIXTURE), which would hit the earlier "slack not configured" 400
// before ever reaching the channel check this test targets. A fake $HOME
// with a team settings store (mirrors server-healthz-fast.test.ts) plus a
// non-empty SLACK_TOKEN gets past that gate without a real Slack workspace;
// the channel-validation 400 fires before either handler calls cache.get()
// or makes any Slack API call, so no live GitLab/Slack connectivity is
// needed for this assertion to hold.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-slack-channel-'));

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
    'mattstack.directory': {
      teams: {
        web: { slack: { channels: [{ name: 'code-review', kind: 'review' }] } },
      },
    },
  })
);
const webTeamDir = join(teamDir, '..', 'teams', 'web');
mkdirSync(webTeamDir, { recursive: true });
writeFileSync(join(webTeamDir, 'settings.team.jsonc'), '{}');
const userDir = join(fakeHome, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({ 'mattstack.activeTeam': 'web' })
);

const board = bootBoardServer({
  env: {
    HOME: fakeHome,
    // Keeps the booted server's state writes out of the repo.
    BOARD_APP_ROOT: fakeHome,
    GITLAB_TOKEN: '',
    // Truthy but fake: only needs to clear the `!slackToken` gate. Both
    // endpoints reject an unconfigured `channel` before making any real
    // Slack API call, so this token is never actually used over the wire.
    SLACK_TOKEN: 'fake-slack-token',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

test('/slack/resolve rejects a channel outside the configured set', async () => {
  const res = await fetch(`${board.origin}/slack/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mrUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
      iid: 1,
      channel: 'not-a-real-channel',
    }),
  });
  expect(res.status).toBe(400);
  // "code-review" is the only configured channel (the team's review channel
  // in the directory; no board.tabs override) -- named in the error body.
  expect(await res.text()).toContain('code-review');
}, 15_000);

test('/slack/post rejects a channel outside the configured set', async () => {
  const res = await fetch(`${board.origin}/slack/post`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mrUrls: ['https://gitlab.example.com/g/p/-/merge_requests/1'],
      channel: 'not-a-real-channel',
    }),
  });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain('code-review');
}, 15_000);
