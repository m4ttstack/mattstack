import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';

const BIN = join(import.meta.dir, '..', 'bin', 'gitq-status.ts');

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-status-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('bun', ['run', BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: '', ...env },
  });
}

describe('gitq-status', () => {
  test('writes status, detail, and the env session id', () => {
    const state = join(dir, 'job.json');
    const res = run([state, 'conflict', '2 conflicts on api'], { CLAUDE_CODE_SESSION_ID: 'sess-1' });
    expect(res.status).toBe(0);
    const json = JSON.parse(readFileSync(state, 'utf8'));
    expect(json.status).toBe('conflict');
    expect(json.detail).toBe('2 conflicts on api');
    expect(json.sessionId).toBe('sess-1');
    expect(json.startedAt).toBeGreaterThan(0);
  });

  test('merges onto a prior write without losing fields', () => {
    const state = join(dir, 'job.json');
    run([state, 'working', 'first pass']);
    const first = JSON.parse(readFileSync(state, 'utf8'));
    const res = run([state, 'done']);
    expect(res.status).toBe(0);
    const json = JSON.parse(readFileSync(state, 'utf8'));
    expect(json.status).toBe('done');
    expect(json.detail).toBe('first pass');
    expect(json.startedAt).toBe(first.startedAt);
    expect(json.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  test('--session flag beats the env var', () => {
    const state = join(dir, 'job.json');
    run([state, 'working', '--session', 'flag-sess'], { CLAUDE_CODE_SESSION_ID: 'env-sess' });
    const json = JSON.parse(readFileSync(state, 'utf8'));
    expect(json.sessionId).toBe('flag-sess');
  });

  test('rejects an unknown status with exit 1 and usage on stderr', () => {
    const res = run([join(dir, 'j.json'), 'bogus']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('usage:');
  });

  test('rejects missing args with exit 1', () => {
    const res = run([]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('usage:');
  });
});
