import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { jobFilePath, writeJobState, readJobStates, pruneJobStates } from '../src/server/job-state.ts';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-job-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('jobFilePath', () => {
  test('slugs the triple deterministically', () => {
    const a = jobFilePath('/Users/x/repo', 'my-stack', 'sync', dir);
    const b = jobFilePath('/Users/x/repo', 'my-stack', 'sync', dir);
    expect(a).toBe(b);
    expect(a).toBe(join(dir, 'Users-x-repo-my-stack-sync.json'));
  });

  test('different actions resolve different files', () => {
    const a = jobFilePath('/Users/x/repo', 'my-stack', 'sync', dir);
    const b = jobFilePath('/Users/x/repo', 'my-stack', 'publish', dir);
    expect(a).not.toBe(b);
  });
});

describe('writeJobState', () => {
  test('first write stamps startedAt = updatedAt and creates parent dirs', () => {
    const path = join(dir, 'sub', 'job.json');
    const state = writeJobState(path, { status: 'working' }, 1000);
    expect(state.startedAt).toBe(1000);
    expect(state.updatedAt).toBe(1000);
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect(onDisk.status).toBe('working');
    expect(onDisk.repoPath).toBe('');
  });

  test('merge preserves seeded fields, startedAt, and prior detail', () => {
    const path = join(dir, 'job.json');
    writeJobState(
      path,
      { status: 'starting', repoPath: '/r', stack: 's', action: 'sync', tabId: 't1', detail: 'spawned' },
      1000,
    );
    const state = writeJobState(path, { status: 'conflict' }, 2000);
    expect(state.repoPath).toBe('/r');
    expect(state.stack).toBe('s');
    expect(state.action).toBe('sync');
    expect(state.tabId).toBe('t1');
    expect(state.detail).toBe('spawned');
    expect(state.startedAt).toBe(1000);
    expect(state.updatedAt).toBe(2000);
    expect(state.status).toBe('conflict');
  });

  test('patch detail replaces prior detail', () => {
    const path = join(dir, 'job.json');
    writeJobState(path, { status: 'working', detail: 'old' }, 1000);
    const state = writeJobState(path, { status: 'working', detail: 'new' }, 2000);
    expect(state.detail).toBe('new');
  });

  test('leaves no tmp file behind', () => {
    const path = join(dir, 'job.json');
    writeJobState(path, { status: 'working' });
    expect(existsSync(path + '.tmp')).toBe(false);
  });
});

describe('readJobStates', () => {
  test('returns parsed states and skips junk', () => {
    writeJobState(join(dir, 'a.json'), { status: 'working', repoPath: '/r' });
    writeFileSync(join(dir, 'b.json'), 'not json');
    writeFileSync(join(dir, 'c.txt'), '{}');
    const states = readJobStates(dir);
    expect(states.length).toBe(1);
    expect(states[0]!.repoPath).toBe('/r');
  });

  test('missing dir returns empty', () => {
    expect(readJobStates(join(dir, 'nope'))).toEqual([]);
  });
});

describe('pruneJobStates', () => {
  test('removes only files older than maxAge', () => {
    writeJobState(join(dir, 'old.json'), { status: 'done' }, 1_000);
    writeJobState(join(dir, 'fresh.json'), { status: 'working' }, 90_000);
    pruneJobStates(50_000, dir, 100_000);
    expect(existsSync(join(dir, 'old.json'))).toBe(false);
    expect(existsSync(join(dir, 'fresh.json'))).toBe(true);
  });

  test('keeps an old non-terminal job (parked at a gate)', () => {
    writeJobState(join(dir, 'gated.json'), { status: 'working' }, 1_000);
    pruneJobStates(50_000, dir, 100_000);
    expect(existsSync(join(dir, 'gated.json'))).toBe(true);
  });
});
