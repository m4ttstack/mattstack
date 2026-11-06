import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { bootBoardServer } from './board-server.ts';

// Boots the real server against a fake $HOME whose org store owns
// mattstack.roster and names dev1 its only admin, while this Mac is dev2.
// Every roster write must come back as a plain 403 refusal, and the org
// store must stay as it was.
const fakeHome = mkdtempSync(join(tmpdir(), 'board-roster-refusal-'));

const orgDir = join(fakeHome, '.mattstack', 'orgs', 'acme', 'mattstack', 'org');
mkdirSync(orgDir, { recursive: true });
const storePath = join(orgDir, 'settings.org.jsonc');
const original = JSON.stringify({
  'board.gitlabHost': 'https://gitlab.example.com',
  'board.projects': ['acme/widgets'],
  'mattstack.org': { admins: ['dev1'], teams: {} },
  'mattstack.roster': [{ username: 'dev1' }, { username: 'dev2' }],
});
writeFileSync(storePath, original);

const userDir = join(fakeHome, '.mattstack', 'user');
mkdirSync(userDir, { recursive: true });
writeFileSync(
  join(userDir, 'settings.user.jsonc'),
  JSON.stringify({ 'board.defaultMember': 'dev2' })
);

const rtDir = join(fakeHome, '.mattstack', 'rt');
mkdirSync(join(rtDir, 'teams'), { recursive: true });
writeFileSync(join(rtDir, 'api-token'), 'fake-token\n');
writeFileSync(
  join(rtDir, 'teams', 'acme.json'),
  JSON.stringify({ forgeUsername: 'dev2' })
);

const board = bootBoardServer({
  env: {
    HOME: fakeHome,
    BOARD_APP_ROOT: fakeHome,
    // A token inherited from the developer's shell would make the server
    // reach real hosts.
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

async function roster(body: unknown): Promise<Response> {
  return fetch(`${board.origin}/roster`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const REFUSAL =
  "The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change.";

test.each([
  ['add', { action: 'add', username: 'dev3' }],
  ['rename', { action: 'rename', username: 'dev1', name: 'Dev One' }],
  ['remove', { action: 'remove', username: 'dev1' }],
])(
  'a member who is not an org admin is refused a roster %s with a plain 403',
  async (_label, body) => {
    const res = await roster(body);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe(REFUSAL);
    expect(readFileSync(storePath, 'utf8')).toBe(original);
  }
);
