/**
 * Persistence stress tests: atomic write safety, corruption recovery,
 * concurrent access patterns, and large store handling.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { StackManager } from '../../src/core/stack-manager.ts';
import { loadStore, saveStore, getStorePath } from '../../src/core/persistence.ts';
import { readJson, writeJsonAtomic } from '../../src/core/json-store.ts';
import type { StackStore } from '../../src/core/types.ts';

let tempDirs: string[] = [];

afterEach(async () => {
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  tempDirs = [];
});

async function makeTempDir(): Promise<string> {
  const rawDir = await mkdtemp(join(tmpdir(), 'gitq-persist-'));
  const dir = realpathSync(rawDir);
  tempDirs.push(dir);
  return dir;
}

// ── Atomic write safety ──────────────────────────────────────────────────────

describe('writeJsonAtomic', () => {
  test('write produces valid JSON that can be read back', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'data.json');

    const data = { key: 'value', nested: { count: 42 } };
    await writeJsonAtomic(filePath, data);

    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual(data);
  });

  test('temp file is cleaned up after successful write', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'clean.json');

    await writeJsonAtomic(filePath, { test: true });

    // No .tmp files should remain
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(dir);
    const tmpFiles = files.filter((f: string) => f.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });

  test('creates parent directories if they do not exist', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'deep', 'nested', 'dir', 'data.json');

    await writeJsonAtomic(filePath, { deep: true });

    const raw = await readFile(filePath, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ deep: true });
  });

  test('overwrites existing file atomically', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'overwrite.json');

    await writeJsonAtomic(filePath, { version: 1 });
    await writeJsonAtomic(filePath, { version: 2 });

    const raw = await readFile(filePath, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ version: 2 });
  });

  test('concurrent writes do not corrupt the file', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'concurrent.json');

    // Fire 10 truly concurrent writes
    const writes = Array.from({ length: 10 }, (_, i) =>
      writeJsonAtomic(filePath, { iteration: i }),
    );
    await Promise.all(writes);

    // The file should contain valid JSON from one of the writes
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(typeof parsed.iteration).toBe('number');
    expect(parsed.iteration).toBeGreaterThanOrEqual(0);
    expect(parsed.iteration).toBeLessThan(10);
  });

  test('rapid sequential writes produce correct final state', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'sequential.json');

    for (let i = 0; i < 20; i++) {
      await writeJsonAtomic(filePath, { count: i });
    }

    const raw = await readFile(filePath, 'utf-8');
    expect(JSON.parse(raw)).toEqual({ count: 19 });
  });
});

// ── readJson fallback and corruption ─────────────────────────────────────────

describe('readJson', () => {
  test('returns fallback when file does not exist', async () => {
    const dir = await makeTempDir();
    const result = await readJson(join(dir, 'nonexistent.json'), { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  test('throws on corrupt JSON (truncated)', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'corrupt.json');
    await writeFile(filePath, '{"key": "val', 'utf-8');

    await expect(readJson(filePath, {})).rejects.toThrow();
  });

  test('throws on corrupt JSON (binary garbage)', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'garbage.json');
    await writeFile(filePath, Buffer.from([0xff, 0xfe, 0x00, 0x01]));

    await expect(readJson(filePath, {})).rejects.toThrow();
  });

  test('throws on corrupt JSON (empty file)', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'empty.json');
    await writeFile(filePath, '', 'utf-8');

    await expect(readJson(filePath, {})).rejects.toThrow();
  });

  test('reads valid JSON successfully', async () => {
    const dir = await makeTempDir();
    const filePath = join(dir, 'valid.json');
    await writeFile(filePath, '{"valid": true}', 'utf-8');

    const result = await readJson(filePath, {});
    expect(result).toEqual({ valid: true });
  });
});

// ── Store persistence round-trip ─────────────────────────────────────────────

describe('loadStore / saveStore round-trip', () => {
  test('empty store round-trips correctly', async () => {
    const dir = await makeTempDir();
    const repoPath = dir;

    const store: StackStore = { repoPath, remoteUrl: '', stacks: [] };
    await saveStore(repoPath, store);

    const loaded = await loadStore(repoPath);
    expect(loaded.repoPath).toBe(repoPath);
    expect(loaded.stacks).toEqual([]);
  });

  test('store with complex stacks round-trips correctly', async () => {
    const dir = await makeTempDir();
    const repoPath = dir;

    let stack = StackManager.createStack('test', 'main');
    stack = StackManager.addNode(stack, 'feat/a', 'main');
    stack = StackManager.updateNode(stack, 'feat/a', {
      lastKnownHead: 'sha-a',
      mrIid: 42,
      mrUrl: 'https://gitlab.com/mr/42',
      mrTitle: null,
      status: 'synced',
      pipelineStatus: 'success',
      diffStats: { additions: 10, deletions: 5, filesChanged: 3 },
      unresolvedThreads: 2,
    });
    stack = StackManager.addNode(stack, 'feat/b', 'feat/a');
    stack = StackManager.updateNode(stack, 'feat/b', { lastKnownHead: 'sha-b' });

    const store: StackStore = {
      repoPath,
      remoteUrl: 'https://github.com/owner/repo',
      stacks: [stack],
    };
    await saveStore(repoPath, store);

    const loaded = await loadStore(repoPath);
    expect(loaded.remoteUrl).toBe('https://github.com/owner/repo');
    expect(loaded.stacks).toHaveLength(1);

    const loadedNode = StackManager.findNode(loaded.stacks[0]!, 'feat/a');
    expect(loadedNode!.mrIid).toBe(42);
    expect(loadedNode!.pipelineStatus).toBe('success');
    expect(loadedNode!.diffStats).toEqual({ additions: 10, deletions: 5, filesChanged: 3 });
    expect(loadedNode!.unresolvedThreads).toBe(2);
  });

  test('loadStore returns empty store for non-existent repo', async () => {
    const dir = await makeTempDir();
    const loaded = await loadStore(join(dir, 'nonexistent-repo'));
    expect(loaded.stacks).toEqual([]);
  });

  test('multiple repos do not collide (different hash paths)', async () => {
    const dir1 = await makeTempDir();
    const dir2 = await makeTempDir();

    const store1: StackStore = {
      repoPath: dir1,
      remoteUrl: '',
      stacks: [StackManager.createStack('stack-1', 'main')],
    };
    const store2: StackStore = {
      repoPath: dir2,
      remoteUrl: '',
      stacks: [StackManager.createStack('stack-2', 'develop')],
    };

    await saveStore(dir1, store1);
    await saveStore(dir2, store2);

    const loaded1 = await loadStore(dir1);
    const loaded2 = await loadStore(dir2);

    expect(loaded1.stacks[0]!.stackName).toBe('stack-1');
    expect(loaded2.stacks[0]!.stackName).toBe('stack-2');
  });

  test('getStorePath is deterministic for the same repo path', () => {
    const path1 = getStorePath('/some/repo');
    const path2 = getStorePath('/some/repo');
    expect(path1).toBe(path2);
  });

  test('getStorePath differs for different repo paths', () => {
    const path1 = getStorePath('/repo/a');
    const path2 = getStorePath('/repo/b');
    expect(path1).not.toBe(path2);
  });
});

// ── Corruption recovery ──────────────────────────────────────────────────────

describe('Store corruption recovery', () => {
  test('loadStore throws on corrupted store file (not valid JSON)', async () => {
    const dir = await makeTempDir();
    const repoPath = dir;

    // Save valid first
    await saveStore(repoPath, { repoPath, remoteUrl: '', stacks: [] });

    // Corrupt the file
    const storePath = getStorePath(repoPath);
    await writeFile(storePath, 'NOT VALID JSON {{{{', 'utf-8');

    // loadStore should throw (not return garbage)
    await expect(loadStore(repoPath)).rejects.toThrow();
  });

  test('saveStore after corruption overwrites with valid data', async () => {
    const dir = await makeTempDir();
    const repoPath = dir;

    // Write corrupt data
    const storePath = getStorePath(repoPath);
    await mkdir(dirname(storePath), { recursive: true });
    await writeFile(storePath, 'CORRUPT', 'utf-8');

    // Save fresh data
    const fresh: StackStore = { repoPath, remoteUrl: '', stacks: [] };
    await saveStore(repoPath, fresh);

    // Should now load correctly
    const loaded = await loadStore(repoPath);
    expect(loaded.stacks).toEqual([]);
  });

  test('truncated JSON file throws on load', async () => {
    const dir = await makeTempDir();
    const repoPath = dir;

    const storePath = getStorePath(repoPath);
    await mkdir(dirname(storePath), { recursive: true });
    // Simulate crash mid-write: valid start, truncated
    await writeFile(storePath, '{"repoPath":"/x","remoteUrl":"","stacks":[{"id":"t', 'utf-8');

    await expect(loadStore(repoPath)).rejects.toThrow();
  });
});

// ── Large store ──────────────────────────────────────────────────────────────

describe('Large store handling', () => {
  test('store with 50 stacks, 20 nodes each, round-trips correctly', async () => {
    const dir = await makeTempDir();
    const repoPath = dir;

    const stacks = Array.from({ length: 50 }, (_, si) => {
      let stack = StackManager.createStack(`stack-${si}`, 'main');
      let parent = 'main';
      for (let ni = 0; ni < 20; ni++) {
        const branch = `feat/s${si}-b${ni}`;
        stack = StackManager.addNode(stack, branch, parent);
        stack = StackManager.updateNode(stack, branch, {
          lastKnownHead: `sha-s${si}-b${ni}`,
          mrIid: si * 100 + ni,
        });
        parent = branch;
      }
      return stack;
    });

    const store: StackStore = { repoPath, remoteUrl: '', stacks };
    await saveStore(repoPath, store);

    const loaded = await loadStore(repoPath);
    expect(loaded.stacks).toHaveLength(50);
    expect(loaded.stacks[0]!.nodes).toHaveLength(20);
    expect(loaded.stacks[49]!.nodes).toHaveLength(20);

    const deepNode = StackManager.findNode(loaded.stacks[49]!, 'feat/s49-b19');
    expect(deepNode!.lastKnownHead).toBe('sha-s49-b19');
    expect(deepNode!.mrIid).toBe(4919);
  });

  test('large store file size is reasonable', async () => {
    const dir = await makeTempDir();
    const repoPath = dir;

    const stacks = Array.from({ length: 10 }, (_, si) => {
      let stack = StackManager.createStack(`stack-${si}`, 'main');
      let parent = 'main';
      for (let ni = 0; ni < 50; ni++) {
        const branch = `feat/s${si}-branch-${ni}`;
        stack = StackManager.addNode(stack, branch, parent);
        stack = StackManager.updateNode(stack, branch, { lastKnownHead: `sha-${si}-${ni}` });
        parent = branch;
      }
      return stack;
    });

    const store: StackStore = { repoPath, remoteUrl: '', stacks };
    await saveStore(repoPath, store);

    const storePath = getStorePath(repoPath);
    const fileStat = await stat(storePath);

    // 10 stacks × 50 nodes should be well under 1MB
    expect(fileStat.size).toBeLessThan(1_000_000);
    expect(fileStat.size).toBeGreaterThan(0);
  });
});
