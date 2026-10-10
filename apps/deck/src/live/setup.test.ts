import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, expect, test } from 'bun:test';

import { clearSetup, readyMarker, runSetup, setupFor } from './setup.ts';

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
    log: [
      '$ bun install',
      'error: lockfile had changes, but lockfile is frozen',
    ],
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

test('a clean install marks the tree ready', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-setup-'));
  await runSetup('chat', root, null, { run: async () => 0 });
  expect(existsSync(readyMarker(root))).toBe(true);
});

test('a failed install over a half-installed tree leaves no ready mark', async () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-setup-'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(readyMarker(root), '');
  let markedDuringRun = true;
  await runSetup('chat', root, null, {
    run: async () => {
      markedDuringRun = existsSync(readyMarker(root));
      return 1;
    },
  });
  expect(markedDuringRun).toBe(false);
  expect(existsSync(readyMarker(root))).toBe(false);
});
