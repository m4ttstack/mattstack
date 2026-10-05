import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Catches losing job identity between the actual /action handler and the
// status CLI, accidentally relaunching a live job, and reporting a failed
// native launch as a successful starting job.
test('agent actions retain job identity through status reporting, deduplication and launch failure', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-action-lifecycle-')));
  try {
    mkdirSync(join(root, 'home'));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(root, 'home'), GITQ_APP_ROOT: join(root, 'app'), GITQ_CONFIG_DIR: join(root, 'config') };
    delete env.RT_DAEMON_SOCK;
    delete env.HERDR_SOCKET;
    env.HERDR_SOCKET_PATH = join(root, 'absent-herdr.sock');
    env.HERDR_BIN = join(root, 'no-herdr-executable');
    const result = spawnSync(process.execPath, [join(import.meta.dir, 'fixtures', 'agent-action-lifecycle.ts'), root], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const actual = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
    expect(actual.started).toEqual({ status: 200, body: '{"ok":true,"focused":false}' });
    const identity = { repoPath: join(root, 'repo'), stack: 'fixture-stack', action: 'sync', tabId: 'fixture-tab', workspaceId: 'fixture-workspace' };
    expect(actual.initial).toMatchObject({ ...identity, status: 'starting' });
    expect(actual.launchesObserved[0].seeded).toEqual([expect.objectContaining({ repoPath: identity.repoPath, stack: 'fixture-stack', action: 'sync', status: 'starting' })]);
    expect(actual.launchesObserved[0].options.paneCommand).toContain("claude '/gitq:sync ");
    expect(actual.launchesObserved[0].options.paneCommand).toContain('--state ');
    expect(actual.working).toMatchObject({ ...identity, status: 'working', sessionId: 'fixture-claude-session', detail: 'reviewing changes' });
    expect(actual.dedup).toEqual({ status: 200, body: '{"ok":true,"focused":true}' });
    expect(actual.focused).toEqual(['fixture-tab']);
    expect(actual.afterDedup).toEqual(actual.working);
    expect(actual.done).toMatchObject({ ...identity, status: 'done', sessionId: 'fixture-claude-session', detail: 'reviewing changes', startedAt: actual.initial.startedAt });
    expect(actual.failed).toEqual({ status: 502, body: 'fixture launch refused' });
    expect(actual.failedJob).toMatchObject({ repoPath: identity.repoPath, stack: 'fixture-stack', action: 'publish', status: 'error', detail: 'launch failed: fixture launch refused' });
    expect(actual.failedJob.tabId).toBeUndefined();
    expect(actual.launches).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 25_000);
