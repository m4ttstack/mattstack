import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createLifecycle } from '../lifecycle';
import { DOCUMENT_PATTERNS, serverCommand, serverOptions } from '../server';

const pkgDir = join(import.meta.dir, '..', '..');
const home = '/home/me';
const fallback = '/home/me/.local/bin/rt';

describe('serverCommand', () => {
  test('an explicit setting wins', () => {
    expect(serverCommand('/opt/rt', { PATH: '/usr/bin' }, home, () => true)).toBe('/opt/rt');
  });

  test('the default with rt on PATH stays rt', () => {
    const exists = (p: string) => p === '/usr/bin/rt';
    expect(serverCommand('rt', { PATH: '/bin:/usr/bin' }, home, exists)).toBe('rt');
  });

  test('the default with rt off PATH falls back to ~/.local/bin/rt when it exists', () => {
    const exists = (p: string) => p === fallback;
    expect(serverCommand('rt', { PATH: '/usr/bin' }, home, exists)).toBe(fallback);
  });

  test('the default with neither stays rt so the client reports the failure', () => {
    expect(serverCommand('rt', { PATH: '/usr/bin' }, home, () => false)).toBe('rt');
  });

  test('an empty setting counts as the default', () => {
    const exists = (p: string) => p === fallback;
    expect(serverCommand('', {}, home, exists)).toBe(fallback);
  });
});

describe('serverOptions', () => {
  test('launches rt skills lsp over stdio with the resolved command', () => {
    const opts = serverOptions('/opt/rt');
    expect(opts.command).toBe('/opt/rt');
    expect(opts.args).toEqual(['skills', 'lsp']);
    expect(opts.transport).toBe(0);
  });
});

describe('createLifecycle', () => {
  function stub(opts: { startFails?: boolean } = {}) {
    const calls: string[] = [];
    let running = false;
    return {
      calls,
      client: {
        async start() {
          calls.push('start');
          if (opts.startFails) throw new Error('spawn rt ENOENT');
          running = true;
        },
        async stop() {
          calls.push('stop');
          if (!running) throw new Error("Client is not running and can't be stopped. It's current state is: startFailed");
          running = false;
        },
        isRunning: () => running,
      },
    };
  }

  test('a failed start is logged, not thrown', async () => {
    const logs: string[] = [];
    const bad = stub({ startFails: true });
    await createLifecycle(() => bad.client, (m) => logs.push(m)).start();
    expect(logs).toHaveLength(1);
  });

  test('restart after a failed start skips stop and reaches start', async () => {
    const clients = [stub({ startFails: true }), stub()];
    const lifecycle = createLifecycle(() => clients.shift()!.client, () => {});
    await lifecycle.start();
    const good = clients[0]!;
    await lifecycle.restart();
    expect(good.calls).toEqual(['start']);
  });

  test('restart stops a running client before starting the next', async () => {
    const first = stub();
    const second = stub();
    const queue = [first, second];
    const lifecycle = createLifecycle(() => queue.shift()!.client, () => {});
    await lifecycle.start();
    await lifecycle.restart();
    expect(first.calls).toEqual(['start', 'stop']);
    expect(second.calls).toEqual(['start']);
  });

  test('stop on a failed client does not throw', async () => {
    const bad = stub({ startFails: true });
    const lifecycle = createLifecycle(() => bad.client, () => {});
    await lifecycle.start();
    await lifecycle.stop();
    expect(bad.calls).toEqual(['start']);
  });
});

describe('document patterns', () => {
  test('cover block files, manifests, and fill markdown', () => {
    expect(DOCUMENT_PATTERNS).toEqual(['**/*.block.md', '**/skills.jsonc', '**/attachments/**/*.md', '**/skills/**/*.md']);
  });
});

describe('built extension bundle', () => {
  test('loads in plain node with only vscode external', () => {
    const build = spawnSync('bun', ['run', 'build'], { cwd: pkgDir, encoding: 'utf8' });
    expect(build.status).toBe(0);
    const smoke = spawnSync('node', ['scripts/load-smoke.mjs'], { cwd: pkgDir, encoding: 'utf8' });
    expect(smoke.status).toBe(0);
    expect(smoke.stdout).toContain('load smoke ok');
  }, 120_000);
});
