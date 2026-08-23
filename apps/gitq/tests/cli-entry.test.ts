import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import { main } from '../src/cli/main.ts';

let dir: string;
let logged: string[];
const realLog = console.log;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gitq-cli-entry-'));
  logged = [];
  console.log = (...args: unknown[]) => {
    logged.push(args.join(' '));
  };
});

afterEach(() => {
  console.log = realLog;
  rmSync(dir, { recursive: true, force: true });
});

describe('cli entry verbs', () => {
  // The mattstack bundle gate compares this output against the deps.lock row
  // verbatim, so it is a bare semver and nothing else.
  test('--version prints bare semver', async () => {
    expect(await main(['--version'])).toBe(0);
    expect(logged).toEqual([pkg.version]);
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('job-status writes the state file without resolving a repo', async () => {
    const statePath = join(dir, 'job.json');
    expect(await main(['job-status', statePath, 'working', 'syncing demo'])).toBe(0);
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { status: string; detail: string };
    expect(state.status).toBe('working');
    expect(state.detail).toBe('syncing demo');
  });

  // --session is not in main()'s shared option table; routing job-status ahead
  // of parseArgs is what keeps its value out of the positionals.
  test('job-status keeps its --session value', async () => {
    const statePath = join(dir, 'session.json');
    expect(await main(['job-status', statePath, 'done', 'all rebased', '--session', 'sess-1'])).toBe(0);
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { sessionId: string; detail: string };
    expect(state.sessionId).toBe('sess-1');
    expect(state.detail).toBe('all rebased');
  });

  test('an unknown job status is rejected without writing', async () => {
    const statePath = join(dir, 'never.json');
    expect(await main(['job-status', statePath, 'bogus'])).toBe(1);
    expect(() => readFileSync(statePath, 'utf8')).toThrow();
  });

  test('help lists the board verbs alongside the command table', async () => {
    expect(await main(['--help'])).toBe(0);
    const text = logged.join('\n');
    expect(text).toContain('gitq board');
    expect(text).toContain('gitq job-status');
  });
});
