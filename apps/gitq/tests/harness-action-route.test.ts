import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// The /action route under the integrations switch: the seed clears the last
// run's binding, a pending { harness } is on file while rt launches, the
// bound session lands after, a refocus keeps the running pane's binding, and
// a selection failure is a 502 with the binding cleared.
test('the action route records the launch binding in order', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-harness-route-')));
  try {
    mkdirSync(join(root, 'home'));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(root, 'home'), GITQ_APP_ROOT: join(root, 'app'), GITQ_CONFIG_DIR: join(root, 'config') };
    delete env.RT_DAEMON_SOCK;
    env.HERDR_SOCKET_PATH = join(root, 'absent-herdr.sock');
    env.HERDR_BIN = join(root, 'no-herdr-executable');
    const result = spawnSync(process.execPath, [join(import.meta.dir, 'fixtures', 'harness-action-route.ts'), root], {
      cwd: root, env, encoding: 'utf8', timeout: 20_000,
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const actual = JSON.parse(result.stdout.trim().split('\n').at(-1)!);
    const STALE = { harness: 'codex', agentId: 'agent-0', sessionId: 'thread-0' };
    const BOUND = { harness: 'codex', agentId: 'agent-1', sessionId: 'thread-1' };

    expect(actual.seenAtStart).toEqual([
      { action: 'sync', launch: { harness: 'codex' } },
      { action: 'publish', launch: { harness: 'codex' } },
    ]);
    expect(actual.started).toEqual({ status: 200, body: '{"ok":true,"focused":false}' });
    expect(actual.startedJob).toMatchObject({ status: 'starting', tabId: 'tab-1', workspaceId: 'ws-1', launch: BOUND });

    expect(actual.focused).toEqual({ status: 200, body: '{"ok":true,"focused":true}' });
    expect(actual.focusedJob.launch).toEqual(STALE);

    expect(actual.refused).toEqual({ status: 502, body: 'No agent is turned on, so gitq cannot start one. Turn one on in setup.' });
    expect(actual.refusedJob).toMatchObject({ status: 'error', detail: 'launch failed: No agent is turned on, so gitq cannot start one. Turn one on in setup.' });
    expect(actual.refusedJob.launch).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 25_000);
