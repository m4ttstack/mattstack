import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  boardDoctorOwner,
  ciLeaseFileName,
  claimCiLease,
  DEFAULT_CI_LEASE_TTL_SECONDS,
  readCiLease,
} from '@mattstack/rt-client';
import { createBoardAttendants } from '../triage/attendant.ts';

const MR = 'https://gitlab.example.com/acme/webapp/-/merge_requests/4821';

let dir: string;
let t: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'attendants-'));
  t = 1_700_000_000_000;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('createBoardAttendants', () => {
  test('claim uses the board doctor owner and refuses a live watch-ci lease', () => {
    claimCiLease(
      { mrUrl: MR, owner: 'session:w', holder: 'watch-ci' },
      { dir, now: () => t }
    );
    const port = createBoardAttendants({ dir, now: () => t });
    expect(port.claim(MR, 42, 'feat')).toBe(false);
  });

  test('claim then heartbeat and release through the port', () => {
    const port = createBoardAttendants({ dir, now: () => t });
    expect(port.claim(MR, 42, 'feat')).toBe(true);
    expect(readCiLease(MR, { dir, now: () => t }).lease).toMatchObject({
      owner: boardDoctorOwner(MR),
      holder: 'doctor',
      branch: 'feat',
      sessionLabel: 'mr-board-triage',
    });
    t += 1_000;
    port.heartbeat(MR, 42);
    expect(readCiLease(MR, { dir, now: () => t }).lease?.heartbeatAt).toBe(t);
    port.release(MR, 42);
    expect(readCiLease(MR, { dir, now: () => t }).lease).toBeNull();
  });

  test('heartbeat adopts a legacy doctor lease so an in-flight doctor does not lapse', () => {
    writeFileSync(
      join(dir, ciLeaseFileName(MR)),
      JSON.stringify({
        mr: MR,
        holder: 'doctor',
        startedAt: t,
        heartbeatAt: t,
        ttlSeconds: 600,
      })
    );
    const port = createBoardAttendants({ dir, now: () => t + 1 });
    port.heartbeat(MR, 42);
    expect(readCiLease(MR, { dir, now: () => t + 1 }).lease).toMatchObject({
      owner: boardDoctorOwner(MR),
      heartbeatAt: t + 1,
    });
  });

  test('release adopts and releases a legacy doctor lease left by a pre-upgrade board', () => {
    writeFileSync(
      join(dir, ciLeaseFileName(MR)),
      JSON.stringify({
        mr: MR,
        holder: 'doctor',
        startedAt: t,
        heartbeatAt: t,
        ttlSeconds: 600,
      })
    );
    createBoardAttendants({ dir, now: () => t }).release(MR, 42);
    expect(readCiLease(MR, { dir, now: () => t }).lease).toBeNull();
  });

  test('release never touches a legacy watch-ci lease', () => {
    writeFileSync(
      join(dir, ciLeaseFileName(MR)),
      JSON.stringify({
        mr: MR,
        holder: 'watch-ci',
        startedAt: t,
        heartbeatAt: t,
        ttlSeconds: 600,
      })
    );
    createBoardAttendants({ dir, now: () => t }).release(MR, 42);
    expect(readCiLease(MR, { dir, now: () => t }).lease?.holder).toBe(
      'watch-ci'
    );
  });

  test('heartbeat never touches a watch-ci lease', () => {
    claimCiLease(
      { mrUrl: MR, owner: 'session:w', holder: 'watch-ci' },
      { dir, now: () => t }
    );
    createBoardAttendants({ dir, now: () => t + 5 }).heartbeat(MR, 42);
    expect(readCiLease(MR, { dir, now: () => t + 5 }).lease?.heartbeatAt).toBe(
      t
    );
  });

  test('read and readByBranch return fresh leases', () => {
    claimCiLease(
      { mrUrl: MR, owner: 'session:w', holder: 'watch-ci', branch: 'feat' },
      { dir, now: () => t }
    );
    const port = createBoardAttendants({ dir, now: () => t });
    expect(port.read(MR, 42)?.holder).toBe('watch-ci');
    expect(port.readByBranch('feat')?.mr).toBe(MR);
  });

  test('read and readByBranch treat a stale lease as gone', () => {
    claimCiLease(
      { mrUrl: MR, owner: 'session:w', holder: 'watch-ci', branch: 'feat' },
      { dir, now: () => t }
    );
    const stale = t + DEFAULT_CI_LEASE_TTL_SECONDS * 1_000 + 1_000;
    const port = createBoardAttendants({ dir, now: () => stale });
    expect(port.read(MR, 42)).toBeNull();
    expect(port.readByBranch('feat')).toBeNull();
  });

  test('a busy lock makes claim return false instead of throwing', () => {
    const lockPath = join(dir, ciLeaseFileName(MR).replace(/\.json$/, '.lock'));
    writeFileSync(lockPath, JSON.stringify({ token: 'x', at: Date.now() }));
    const port = createBoardAttendants({ dir, now: () => t, lockWaitMs: 5 });
    expect(() => port.claim(MR, 42, 'feat')).not.toThrow();
    expect(port.claim(MR, 42, 'feat')).toBe(false);
  });

  test('a busy lock makes heartbeat and release no-ops instead of throwing', () => {
    claimCiLease(
      { mrUrl: MR, owner: boardDoctorOwner(MR), holder: 'doctor' },
      { dir, now: () => t }
    );
    const lockPath = join(dir, ciLeaseFileName(MR).replace(/\.json$/, '.lock'));
    writeFileSync(lockPath, JSON.stringify({ token: 'x', at: Date.now() }));
    const port = createBoardAttendants({ dir, now: () => t, lockWaitMs: 5 });
    expect(() => port.heartbeat(MR, 42)).not.toThrow();
    expect(() => port.release(MR, 42)).not.toThrow();
  });

  test('an fs failure (ENOTDIR) makes claim return false; every other method still does not throw', () => {
    const blockerFile = join(dir, 'not-a-directory');
    writeFileSync(blockerFile, 'x');
    const badDir = join(blockerFile, 'nested');
    const port = createBoardAttendants({ dir: badDir, now: () => t });
    expect(port.claim(MR, 42, 'feat')).toBe(false);
    expect(() => port.heartbeat(MR, 42)).not.toThrow();
    expect(() => port.release(MR, 42)).not.toThrow();
    expect(port.read(MR, 42)).toBeNull();
    expect(port.readByBranch('feat')).toBeNull();
  });

  test('claim warns once on a non-lock-busy failure and stays silent on lock contention', () => {
    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    try {
      const blockerFile = join(dir, 'not-a-directory');
      writeFileSync(blockerFile, 'x');
      createBoardAttendants({
        dir: join(blockerFile, 'nested'),
        now: () => t,
      }).claim(MR, 42, 'feat');
      expect(warns).toHaveLength(1);

      warns.length = 0;
      const lockPath = join(
        dir,
        ciLeaseFileName(MR).replace(/\.json$/, '.lock')
      );
      writeFileSync(lockPath, JSON.stringify({ token: 'x', at: Date.now() }));
      createBoardAttendants({ dir, now: () => t, lockWaitMs: 5 }).claim(
        MR,
        42,
        'feat'
      );
      expect(warns).toHaveLength(0);
    } finally {
      console.warn = originalWarn;
    }
  });
});
