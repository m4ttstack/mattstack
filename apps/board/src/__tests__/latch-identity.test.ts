import { afterAll, describe, expect, test } from 'bun:test';

import { verifyLatchIdentity } from '../latch/identity.ts';
import { getKvValue } from '../state/kv-blob.ts';
import { removeTempDbs, tempDb } from './latch-temp-db.ts';

afterAll(removeTempDbs);

const DAY = 24 * 60 * 60_000;
const REPO = 'github.com/o/r';

function fakeDaemon(reply: unknown) {
  const calls: Array<{ verb: string; payload: Record<string, unknown> }> = [];
  const command = (async (verb: string, payload: Record<string, unknown>) => {
    calls.push({ verb, payload });
    return reply;
  }) as never;
  return { calls, command };
}

describe('verifyLatchIdentity', () => {
  test('a case-insensitive match is cached for 24 hours', async () => {
    const db = tempDb();
    const daemon = fakeDaemon({ ok: true, data: { username: 'Ellie-Dev' } });
    let now = 1_000;
    const deps = { command: daemon.command, now: () => now, db };

    expect(await verifyLatchIdentity(REPO, 'ellie-dev', deps)).toEqual({
      ok: true,
    });
    expect(daemon.calls).toEqual([
      { verb: 'forge:self', payload: { repoName: REPO } },
    ]);
    expect(getKvValue<unknown>('latch-identity', REPO, null, db)).toEqual({
      login: 'Ellie-Dev',
      at: 1_000,
    });

    now = 1_000 + DAY - 1;
    expect(await verifyLatchIdentity(REPO, 'ellie-dev', deps)).toEqual({
      ok: true,
    });
    expect(daemon.calls).toHaveLength(1);

    now = 1_000 + DAY;
    expect(await verifyLatchIdentity(REPO, 'ellie-dev', deps)).toEqual({
      ok: true,
    });
    expect(daemon.calls).toHaveLength(2);
  });

  test('a mismatch answers the daemon login and is not cached', async () => {
    const db = tempDb();
    const daemon = fakeDaemon({ ok: true, data: { username: 'ivasco' } });
    const deps = { command: daemon.command, now: () => 1_000, db };

    expect(await verifyLatchIdentity(REPO, 'ellie-dev', deps)).toEqual({
      ok: false,
      login: 'ivasco',
    });
    expect(getKvValue('latch-identity', REPO, null, db)).toBeNull();
    await verifyLatchIdentity(REPO, 'ellie-dev', deps);
    expect(daemon.calls).toHaveLength(2);
  });

  test('a failed read answers no login and is not cached', async () => {
    const db = tempDb();
    const daemon = fakeDaemon({ ok: false, error: 'no token for github.com' });
    const deps = { command: daemon.command, now: () => 1_000, db };

    expect(await verifyLatchIdentity(REPO, 'ellie-dev', deps)).toEqual({
      ok: false,
      login: null,
    });
    expect(getKvValue('latch-identity', REPO, null, db)).toBeNull();
  });

  test('a cached match for another login does not vouch for this one', async () => {
    const db = tempDb();
    const daemon = fakeDaemon({ ok: true, data: { username: 'ellie-dev' } });
    const deps = { command: daemon.command, now: () => 1_000, db };
    await verifyLatchIdentity(REPO, 'ellie-dev', deps);

    expect(await verifyLatchIdentity(REPO, 'ivasco', deps)).toEqual({
      ok: false,
      login: 'ellie-dev',
    });
    expect(daemon.calls).toHaveLength(2);
  });
});
