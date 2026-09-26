import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { restoreMockedModulesAfterAll } from './module-restore.ts';
import type { Stack } from '../src/core/types.ts';

restoreMockedModulesAfterAll();

// Shared state the mock and tests both reference via globalThis. Keyed by
// path (not a single value) because OperationLog.save now takes a sidecar
// file lock (withFileLock) around its write, so the log data file and its
// `.lock` file must be tracked as distinct entries.
declare global {
  // eslint-disable-next-line no-var
  var __opLogMockStore: Map<string, string>;
}
globalThis.__opLogMockStore = new Map();

mock.module('node:fs/promises', () => ({
  mkdir: async () => {},
  readFile: async (path: string) => {
    if (!globalThis.__opLogMockStore.has(path)) {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }
    return globalThis.__opLogMockStore.get(path)!;
  },
  writeFile: async (path: string, data: string) => {
    globalThis.__opLogMockStore.set(path, data);
  },
  rename: async (oldPath: string, newPath: string) => {
    const data = globalThis.__opLogMockStore.get(oldPath);
    globalThis.__opLogMockStore.delete(oldPath);
    if (data !== undefined) globalThis.__opLogMockStore.set(newPath, data);
  },
  unlink: async (path: string) => {
    globalThis.__opLogMockStore.delete(path);
  },
}));

let uuidCounter = 0;
mock.module('node:crypto', () => ({
  randomUUID: () => `uuid-${++uuidCounter}`,
}));

import { OperationLog, type OperationType } from '../src/core/operation-log.ts';

function makeStack(id = 'test-stack'): Stack {
  return {
    id,
    stackName: 'test-stack',
    root: 'main',
    nodes: [
      {
        branch: 'feat/a',
        parent: 'main',
        mrIid: null,
        mrUrl: null,
        mrTitle: null,
        status: 'local-only',
        lastKnownHead: 'sha-a',
        forkPoint: null,
        diffStats: null,
        pipelineStatus: 'unknown',
        unresolvedThreads: 0,
      },
    ],
  };
}

beforeEach(() => {
  uuidCounter = 0;
  globalThis.__opLogMockStore = new Map();
});

describe('OperationLog.create', () => {
  test('captures branch snapshots and stack snapshot', () => {
    const stack = makeStack();
    const snapshots = { 'feat/a': 'sha-aaa', main: 'sha-main' };

    const entry = OperationLog.create('cascade-rebase', stack, snapshots);

    expect(entry.id).toBe('uuid-1');
    expect(entry.operation).toBe('cascade-rebase');
    expect(entry.branchSnapshots).toEqual(snapshots);
    expect(entry.stackSnapshot).toEqual(stack);
    expect(entry.commands).toEqual([]);
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  test('deep-clones the stack snapshot', () => {
    const stack = makeStack();
    const entry = OperationLog.create('absorb', stack, {});

    stack.nodes[0]!.branch = 'mutated';
    expect(entry.stackSnapshot.nodes[0]!.branch).toBe('feat/a');
  });
});

describe('OperationLog.addCommand', () => {
  test('appends command record to entry', () => {
    const stack = makeStack();
    const entry = OperationLog.create('cascade-rebase', stack, {});

    const updated = OperationLog.addCommand(entry, 'git', ['rebase', '--onto', 'main'], '/repo', 0, 150);

    expect(updated.commands).toHaveLength(1);
    expect(updated.commands[0]).toEqual({
      command: 'git',
      args: ['rebase', '--onto', 'main'],
      cwd: '/repo',
      exitCode: 0,
      duration: 150,
    });
    expect(entry.commands).toHaveLength(0);
  });
});

describe('OperationLog.commandHook', () => {
  test('mutates entry in-place for use during orchestration', () => {
    const stack = makeStack();
    const entry = OperationLog.create('sync', stack, {});
    const hook = OperationLog.commandHook(entry);

    hook('git', ['fetch', 'origin'], '/repo', 0, 200);
    hook('git', ['rebase', '--onto', 'origin/main'], '/repo', 0, 300);

    expect(entry.commands).toHaveLength(2);
    expect(entry.commands[0]!.args).toEqual(['fetch', 'origin']);
    expect(entry.commands[1]!.duration).toBe(300);
  });
});

describe('OperationLog.save + load round-trip', () => {
  test('persists and reads back entries', async () => {
    const stack = makeStack();
    const entry = OperationLog.create('reparent', stack, { 'feat/a': 'sha-111' });

    await OperationLog.save(entry);
    const loaded = await OperationLog.load();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe(entry.id);
    expect(loaded[0]!.branchSnapshots).toEqual({ 'feat/a': 'sha-111' });
    expect(loaded[0]!.stackSnapshot).toEqual(stack);
  });

  test('accumulates multiple entries', async () => {
    const stack = makeStack();
    await OperationLog.save(OperationLog.create('absorb', stack, {}));
    await OperationLog.save(OperationLog.create('fold', stack, {}));
    await OperationLog.save(OperationLog.create('split', stack, {}));

    const loaded = await OperationLog.load();
    expect(loaded).toHaveLength(3);
    expect(loaded.map((e) => e.operation)).toEqual(['absorb', 'fold', 'split']);
  });
});

describe('OperationLog FIFO cap', () => {
  test('caps log at 50 entries', async () => {
    const stack = makeStack();
    const operations: OperationType[] = ['cascade-rebase', 'absorb', 'fold', 'split', 'sync', 'reparent'];

    for (let i = 0; i < 55; i++) {
      const entry = OperationLog.create(operations[i % operations.length]!, stack, { branch: `sha-${i}` });
      await OperationLog.save(entry);
    }

    const loaded = await OperationLog.load();
    expect(loaded).toHaveLength(50);
    expect(loaded[0]!.branchSnapshots['branch']).toBe('sha-5');
    expect(loaded[49]!.branchSnapshots['branch']).toBe('sha-54');
  });
});

describe('OperationLog.getLastEntry', () => {
  test('returns most recent entry', async () => {
    const stack = makeStack();
    await OperationLog.save(OperationLog.create('absorb', stack, {}));
    await OperationLog.save(OperationLog.create('fold', stack, { x: 'last' }));

    const last = await OperationLog.getLastEntry();
    expect(last).not.toBeNull();
    expect(last!.operation).toBe('fold');
    expect(last!.branchSnapshots).toEqual({ x: 'last' });
  });

  test('returns null on empty log', async () => {
    const last = await OperationLog.getLastEntry();
    expect(last).toBeNull();
  });
});
