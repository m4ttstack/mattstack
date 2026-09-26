import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { realpathSync } from 'node:fs';
import { withFileLock } from '../src/core/lockfile.ts';

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-lock-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withFileLock', () => {
  test('serializes concurrent read-modify-write cycles', async () => {
    const target = join(dir, 'counter.json');
    writeFileSync(target, '0');
    const bump = () =>
      withFileLock(target, async () => {
        const n = Number(readFileSync(target, 'utf-8'));
        await sleep(20);
        writeFileSync(target, String(n + 1));
      });
    await Promise.all([bump(), bump(), bump(), bump(), bump()]);
    expect(readFileSync(target, 'utf-8')).toBe('5');
  });

  test('releases the lock even when fn throws', async () => {
    const target = join(dir, 'x.json');
    await expect(withFileLock(target, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(existsSync(target + '.lock')).toBe(false);
    await withFileLock(target, async () => {});
  });

  test('breaks a stale lock held by a dead pid', async () => {
    const target = join(dir, 'y.json');
    writeFileSync(target + '.lock', JSON.stringify({ pid: 999999, acquiredAt: Date.now() - 60_000 }));
    let ran = false;
    await withFileLock(target, async () => { ran = true; }, { isPidAlive: () => false, staleMs: 10_000 });
    expect(ran).toBe(true);
  });

  test('times out instead of breaking a live lock', async () => {
    const target = join(dir, 'z.json');
    writeFileSync(target + '.lock', JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));
    await expect(
      withFileLock(target, async () => {}, { timeoutMs: 200, retryMs: 25 }),
    ).rejects.toThrow('could not acquire lock');
  });
});
