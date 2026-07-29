import { describe, test, expect, afterEach } from 'bun:test';
import { mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { acquireLease, findLease, listLeases, parkLease, releaseLease } from '../../src/core/leases.ts';

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await rm(cleanups.pop()!, { recursive: true, force: true });
});

function fakeCommonDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitq-lease-')));
  cleanups.push(dir);
  return dir;
}

describe('lease registry', () => {
  test('acquire, park, release round-trip', async () => {
    const cd = fakeCommonDir();
    const res = await acquireLease(cd, { slotPath: '/w/gitq-1', stackId: 's1', action: 'sync' });
    expect(res.ok).toBe(true);
    expect((await findLease(cd, 's1'))?.state).toBe('running');
    await parkLease(cd, 's1');
    expect((await findLease(cd, 's1'))?.state).toBe('parked');
    await releaseLease(cd, 's1');
    expect(await findLease(cd, 's1')).toBeNull();
  });

  test('refuses a second lease for the same stack and for a taken slot', async () => {
    const cd = fakeCommonDir();
    await acquireLease(cd, { slotPath: '/w/gitq-1', stackId: 's1', action: 'sync' });
    const sameStack = await acquireLease(cd, { slotPath: '/w/gitq-2', stackId: 's1', action: 'absorb' });
    expect(sameStack).toMatchObject({ ok: false, reason: 'stack-leased' });
    const sameSlot = await acquireLease(cd, { slotPath: '/w/gitq-1', stackId: 's2', action: 'sync' });
    expect(sameSlot).toMatchObject({ ok: false, reason: 'slot-leased' });
    const fine = await acquireLease(cd, { slotPath: '/w/gitq-2', stackId: 's2', action: 'sync' });
    expect(fine.ok).toBe(true);
  });

  test('reaps dead running leases but never parked ones', async () => {
    const cd = fakeCommonDir();
    await acquireLease(cd, { slotPath: '/w/gitq-1', stackId: 'dead-running', action: 'sync' });
    await acquireLease(cd, { slotPath: '/w/gitq-2', stackId: 'dead-parked', action: 'sync' });
    await parkLease(cd, 'dead-parked');
    const res = await acquireLease(
      cd,
      { slotPath: '/w/gitq-1', stackId: 'fresh', action: 'sync' },
      { isPidAlive: () => false },
    );
    expect(res.ok).toBe(true);
    expect(await findLease(cd, 'dead-running')).toBeNull();
    expect((await findLease(cd, 'dead-parked'))?.state).toBe('parked');
  });

  test('a dead running lease is invisible to readers, so the guards stop refusing on it', async () => {
    const cd = fakeCommonDir();
    await acquireLease(cd, { slotPath: '/w/gitq-1', stackId: 's1', action: 'sync' });

    // The deadlock in MAT-78: the holder pid died, so every mutating command
    // refused on a lease nobody was holding, while `continue` and `abort` --
    // the two remedies the refusal message names -- only look at parked leases
    // and so could not see it. `acquireLease` already reaped dead running
    // leases, but `requireStackFree` refuses through `findLease` long before
    // anything reaches it, so the reaper was unreachable.
    expect(await listLeases(cd, { isPidAlive: () => false })).toEqual([]);
    expect(await findLease(cd, 's1', { isPidAlive: () => false })).toBeNull();
  });

  test('a parked lease outlives its holder, because that is what parked means', async () => {
    const cd = fakeCommonDir();
    await acquireLease(cd, { slotPath: '/w/gitq-1', stackId: 's1', action: 'sync' });
    await parkLease(cd, 's1');

    // A parked cascade exited on purpose (code 2, waiting on judgment), so its
    // holder is *supposed* to be gone. Reaping it would silently discard the
    // conflict state the user is being asked to resolve.
    expect(await listLeases(cd, { isPidAlive: () => false })).toHaveLength(1);
    expect((await findLease(cd, 's1', { isPidAlive: () => false }))?.state).toBe('parked');
  });

  test('concurrent acquires for one slot admit exactly one winner', async () => {
    const cd = fakeCommonDir();
    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        acquireLease(cd, { slotPath: '/w/gitq-1', stackId: `s${i}`, action: 'sync' }),
      ),
    );
    expect(attempts.filter((a) => a.ok).length).toBe(1);
    expect((await listLeases(cd)).length).toBe(1);
  });
});
