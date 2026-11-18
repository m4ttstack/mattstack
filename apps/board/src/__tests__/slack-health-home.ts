/** A throwaway HOME for one Slack health test: a team with a review channel,
    and a fake rt daemon whose socket answers project-mrs with no MRs and
    refuses every other verb (secrets:read included). */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export function slackHealthHome(prefix: string): {
  home: string;
  stopDaemon: () => void;
} {
  const home = mkdtempSync(join(tmpdir(), prefix));
  const orgDir = join(
    home,
    '.mattstack',
    'orgs',
    'testteam',
    'mattstack',
    'org'
  );
  mkdirSync(orgDir, { recursive: true });
  writeFileSync(
    join(orgDir, 'settings.org.jsonc'),
    JSON.stringify({
      'board.gitlabHost': 'https://gitlab.example.com',
      'board.projects': ['g/p'],
      'mattstack.roster': [{ username: 'alice' }],
      'board.slack': { autoResolveIntervalMinutes: 0 },
      'mattstack.directory': {
        teams: {
          web: {
            slack: { channels: [{ name: 'code-review', kind: 'review' }] },
          },
        },
      },
    })
  );
  const webTeamDir = join(orgDir, '..', 'teams', 'web');
  mkdirSync(webTeamDir, { recursive: true });
  writeFileSync(join(webTeamDir, 'settings.team.jsonc'), '{}');
  const userDir = join(home, '.mattstack', 'user');
  mkdirSync(userDir, { recursive: true });
  writeFileSync(
    join(userDir, 'settings.user.jsonc'),
    JSON.stringify({ 'mattstack.activeTeam': 'web' })
  );
  writeFileSync(join(home, '.mattstack', 'machine-key'), 'testmachine');
  const machineDir = join(userDir, 'local', 'testmachine');
  mkdirSync(machineDir, { recursive: true });
  writeFileSync(
    join(machineDir, 'settings.local.jsonc'),
    JSON.stringify({
      'board.rtRepos': [{ project: 'g/p', repo: 'gitlab.example.com/g/p' }],
    })
  );

  const rtDir = join(home, '.mattstack', 'rt');
  mkdirSync(rtDir, { recursive: true });
  writeFileSync(join(rtDir, 'api-token'), 'test-api-token');
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    });
  const daemon = Bun.serve({
    unix: join(rtDir, 'rt.sock'),
    fetch(req) {
      if (new URL(req.url).pathname === '/project-mrs:read')
        return json({
          ok: true,
          data: {
            mrs: {},
            listSyncedAt: Date.now(),
            source: 'poll',
            syncedAt: Date.now(),
          },
        });
      return json({ ok: false, error: 'not implemented' });
    },
  });
  return { home, stopDaemon: () => daemon.stop(true) };
}
