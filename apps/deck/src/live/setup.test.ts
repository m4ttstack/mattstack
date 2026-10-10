import { afterEach, expect, test } from 'bun:test';

import { clearSetup, runSetup, setupFor } from './setup.ts';

afterEach(() => clearSetup('chat'));

test('a clean install leaves no run behind', async () => {
  const seen: string[][] = [];
  const ok = await runSetup('chat', '/wt/a', 'a', {
    run: async (cmd, cwd, onLine) => {
      seen.push([...cmd, cwd]);
      onLine('installed 812 packages');
      return 0;
    },
  });
  expect(ok).toBe(true);
  expect(seen).toEqual([['bun', 'install', '/wt/a']]);
  expect(setupFor('chat')).toBeUndefined();
});

test('a failed install keeps its log for the board', async () => {
  const ok = await runSetup('chat', '/wt/a', 'a', {
    run: async (_cmd, _cwd, onLine) => {
      onLine('error: lockfile had changes, but lockfile is frozen');
      return 1;
    },
    now: () => new Date('2026-10-09T21:00:00Z'),
  });
  expect(ok).toBe(false);
  expect(setupFor('chat')).toEqual({
    source: '/wt/a',
    branch: 'a',
    state: 'failed',
    log: ['$ bun install', 'error: lockfile had changes, but lockfile is frozen'],
    at: '2026-10-09T21:00:00.000Z',
  });
});

test('a thrown runner counts as a failure', async () => {
  const ok = await runSetup('chat', '/wt/a', null, {
    run: async () => {
      throw new Error('bun not found');
    },
  });
  expect(ok).toBe(false);
  expect(setupFor('chat')?.log.at(-1)).toBe('Error: bun not found');
});

test('the log keeps only the last 200 lines', async () => {
  await runSetup('chat', '/wt/a', null, {
    run: async (_c, _d, onLine) => {
      for (let i = 0; i < 300; i++) onLine(`line ${i}`);
      return 1;
    },
  });
  const log = setupFor('chat')!.log;
  expect(log.length).toBe(200);
  expect(log.at(-1)).toBe('line 299');
});
