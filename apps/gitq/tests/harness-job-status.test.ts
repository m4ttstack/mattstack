import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { setSetting } from '@mattstack/rt-client';
import { runJobStatus, type JobStatusDeps } from '../src/cli/job-status.ts';
import { writeJobState, type JobState } from '../src/server/job-state.ts';

let dir: string;
let statePath: string;
let errors: string[];

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-harness-status-')));
  statePath = join(dir, 'job.json');
  errors = [];
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const read = (): JobState => JSON.parse(readFileSync(statePath, 'utf8')) as JobState;

function seed(launch?: JobState['launch']): string {
  writeJobState(statePath, { status: 'starting', repoPath: '/repo', stack: 's', action: 'sync', tabId: 'tab1', launch }, 1000);
  return readFileSync(statePath, 'utf8');
}

function deps(env: Record<string, string | undefined>, over: Partial<JobStatusDeps> = {}): JobStatusDeps {
  return { env, switchOn: () => true, sleep: () => {}, stderr: (line) => errors.push(line), ...over };
}

const BOUND = { harness: 'codex', agentId: 'agent-1', sessionId: 'thread-1' };

describe('job status binds actual caller', () => {
  test('the session the board launched reports its own job', () => {
    seed(BOUND);
    expect(runJobStatus([statePath, 'working', 'syncing s'], deps({ CODEX_THREAD_ID: 'thread-1' }))).toBe(0);
    expect(read()).toMatchObject({ status: 'working', detail: 'syncing s', sessionId: 'thread-1', launch: BOUND });
    expect(errors).toEqual([]);
  });

  test("a foreign worker cannot report another job's result", () => {
    const before = seed(BOUND);
    expect(runJobStatus([statePath, 'done', 'all good'], deps({ CODEX_THREAD_ID: 'thread-2' }))).toBe(1);
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(errors).toEqual(['Another agent session runs this job, so gitq did not save this status.']);
  });

  test('the same id under another harness is still foreign', () => {
    const before = seed(BOUND);
    expect(runJobStatus([statePath, 'done'], deps({ CLAUDE_CODE_SESSION_ID: 'thread-1' }))).toBe(1);
    expect(readFileSync(statePath, 'utf8')).toBe(before);
  });

  test('a --session argument is not the caller', () => {
    const before = seed(BOUND);
    expect(runJobStatus([statePath, 'done', '--session', 'thread-1'], deps({ CODEX_THREAD_ID: 'thread-2' }))).toBe(1);
    expect(runJobStatus([statePath, 'done', '--session', 'thread-1'], deps({}))).toBe(1);
    expect(readFileSync(statePath, 'utf8')).toBe(before);
  });

  test('a caller naming no session cannot report a bound job', () => {
    const before = seed(BOUND);
    expect(runJobStatus([statePath, 'done'], deps({}))).toBe(1);
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(errors).toEqual(['This command names no agent session, so gitq cannot tell it runs this job and did not save this status.']);
  });

  test("an environment naming both sessions is settled by the job's harness", () => {
    seed(BOUND);
    expect(runJobStatus([statePath, 'done'], deps({ CODEX_THREAD_ID: 'thread-1', CLAUDE_CODE_SESSION_ID: 'claude-9' }))).toBe(0);
    expect(read()).toMatchObject({ status: 'done', sessionId: 'thread-1' });
  });

  test('a Claude launch binds the Claude session', () => {
    const claude = { harness: 'claude', agentId: 'agent-2', sessionId: 'claude-1' };
    seed(claude);
    expect(runJobStatus([statePath, 'done'], deps({ CLAUDE_CODE_SESSION_ID: 'claude-1' }))).toBe(0);
    expect(read()).toMatchObject({ status: 'done', sessionId: 'claude-1', launch: claude });
  });

  test('a report racing the launch waits for the board to record its session', () => {
    seed({ harness: 'codex' });
    let sleeps = 0;
    const code = runJobStatus(
      [statePath, 'working'],
      deps(
        { CODEX_THREAD_ID: 'thread-1' },
        {
          sleep: () => {
            sleeps++;
            if (sleeps === 2) writeJobState(statePath, { status: 'starting', tabId: 'tab1', launch: BOUND });
          },
        },
      ),
    );
    expect(code).toBe(0);
    expect(sleeps).toBe(2);
    expect(read()).toMatchObject({ status: 'working', sessionId: 'thread-1', launch: BOUND });
  });

  test('a launch that never records its session refuses once the wait runs out', () => {
    const before = seed({ harness: 'codex' });
    let sleeps = 0;
    const code = runJobStatus(
      [statePath, 'done'],
      deps({ CODEX_THREAD_ID: 'thread-1' }, { sleep: () => sleeps++, launchWaitMs: 1000 }),
    );
    expect(code).toBe(1);
    expect(sleeps).toBe(4);
    expect(readFileSync(statePath, 'utf8')).toBe(before);
    expect(errors).toEqual(['gitq has not recorded which agent session runs this job yet, so it did not save this status.']);
  });

  test('a job launched without a binding keeps recording the calling session', () => {
    seed(undefined);
    expect(runJobStatus([statePath, 'working'], deps({ CODEX_THREAD_ID: 'thread-5' }))).toBe(0);
    expect(read().sessionId).toBe('thread-5');
  });
});

describe('switch off', () => {
  test('writes exactly as before: Claude session or --session, no binding check', () => {
    seed(BOUND);
    const off = (env: Record<string, string | undefined>) => deps(env, { switchOn: () => false, sleep: () => { throw new Error('no wait with the switch off'); } });
    expect(runJobStatus([statePath, 'working'], off({ CLAUDE_CODE_SESSION_ID: 'claude-x', CODEX_THREAD_ID: 'thread-1' }))).toBe(0);
    expect(read()).toMatchObject({ status: 'working', sessionId: 'claude-x' });
    expect(runJobStatus([statePath, 'done', '--session', 'given'], off({}))).toBe(0);
    expect(read()).toMatchObject({ status: 'done', sessionId: 'given' });
    expect(errors).toEqual([]);
  });
});

describe('completion report with Claude absent', () => {
  let prevHome: string | undefined;
  let ownHome: string;
  beforeEach(() => {
    prevHome = process.env.HOME;
    ownHome = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-harness-home-')));
    if (ownHome === homedir()) throw new Error('refusing to touch the real account home');
    process.env.HOME = ownHome;
    setSetting('agent.integrations.enabled', true, 'machine');
  });
  afterEach(() => {
    process.env.HOME = prevHome;
    rmSync(ownHome, { recursive: true, force: true });
  });

  test('a Codex pane reports through the status bin and nothing runs claude', () => {
    seed(BOUND);
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const marker = join(dir, 'claude-ran');
    writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch '${marker}'\n`);
    chmodSync(join(bin, 'claude'), 0o755);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: ownHome, PATH: `${bin}:/usr/bin:/bin`, CODEX_THREAD_ID: 'thread-1' };
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDE_BIN;
    const gitq = join(import.meta.dir, '..', 'bin', 'gitq');
    const done = spawnSync(process.execPath, [gitq, 'job-status', statePath, 'done', 'rebased 2 branches'], { env, encoding: 'utf8' });
    expect(done.stderr).toBe('');
    expect(done.status).toBe(0);
    expect(read()).toMatchObject({ status: 'done', detail: 'rebased 2 branches', sessionId: 'thread-1' });
    const foreign = spawnSync(process.execPath, [gitq, 'job-status', statePath, 'error', 'x'], {
      env: { ...env, CODEX_THREAD_ID: 'thread-2' },
      encoding: 'utf8',
    });
    expect(foreign.status).toBe(1);
    expect(read().status).toBe('done');
    expect(existsSync(marker)).toBe(false);
  });
});
