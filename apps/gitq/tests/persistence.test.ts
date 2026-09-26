import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStore, saveStore, getStorePath } from '../src/core/persistence.ts';
import type { StackStore } from '../src/core/types.ts';

// ── Test setup ───────────────────────────────────────────────────────────────

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'gitq-persistence-test-'));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('persistence', () => {
  test('getStorePath returns a deterministic path', () => {
    const p1 = getStorePath('/path/to/repo');
    const p2 = getStorePath('/path/to/repo');
    const p3 = getStorePath('/different/repo');

    expect(p1).toBe(p2);
    expect(p1).not.toBe(p3);
    expect(p1).toMatch(/\.json$/);
  });

  test('loadStore returns empty store for non-existent path', async () => {
    const fakePath = join(tempDir, 'non-existent-repo');
    const store = await loadStore(fakePath);

    expect(store.repoPath).toBe(fakePath);
    expect(store.remoteUrl).toBe('');
    expect(store.stacks).toEqual([]);
  });

  test('save and load round-trip preserves data', async () => {
    const repoPath = join(tempDir, 'round-trip-repo');
    const store: StackStore = {
      repoPath,
      remoteUrl: 'git@github.com:user/repo.git',
      stacks: [
        {
          id: 'test-stack',
          stackName: 'test-stack',
          root: 'main',
          nodes: [
            {
              branch: 'feat/a',
              parent: 'main',
              forkPoint: null,
              mrIid: 42,
              mrUrl: 'https://github.com/user/repo/pull/42',
              mrTitle: null,
              status: 'synced',
              lastKnownHead: 'abc123',
              diffStats: { additions: 10, deletions: 5, filesChanged: 3 },
              pipelineStatus: 'success',
              unresolvedThreads: 0,
            },
          ],
        },
      ],
    };

    await saveStore(repoPath, store);
    const loaded = await loadStore(repoPath);

    expect(loaded).toEqual(store);
  });

  test('loadStore throws on corrupt JSON', async () => {
    const repoPath = join(tempDir, 'corrupt-repo');
    const filePath = getStorePath(repoPath);

    // Manually write corrupt JSON to the store path
    const { mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '{invalid json!!!', 'utf-8');

    expect(loadStore(repoPath)).rejects.toThrow();
  });
});
