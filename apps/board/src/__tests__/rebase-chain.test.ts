import { describe, expect, test } from 'bun:test';

import type { DoctorState } from '../doctor-state.ts';
import type { ForgeKind, ForgeRebaseResult } from '../forge-rebase.ts';
import type { LocalSyncOutcome } from '../local-sync.ts';
import { runRebaseChain } from '../rebase-chain.ts';

type Patch = Partial<DoctorState>;

function harness(
  over: {
    forge?: ForgeRebaseResult;
    sync?: LocalSyncOutcome;
    forgeKind?: ForgeKind;
    skipForge?: boolean;
    hasDoctor?: boolean;
    pipelineAtSync?: string;
  } = {}
) {
  const patches: Patch[] = [];
  const calls = { forge: 0, sync: 0 };
  const run = () =>
    runRebaseChain({
      forge: async () => {
        calls.forge++;
        return over.forge ?? { kind: 'current' };
      },
      forgeKind: over.forgeKind ?? 'gitlab',
      skipForge: over.skipForge ?? false,
      sync: async () => {
        calls.sync++;
        return (
          over.sync ?? { kind: 'clean', message: 'rebased and pushed', log: [] }
        );
      },
      write: patch => patches.push(patch),
      hasDoctor: over.hasDoctor ?? true,
      pipelineAtSync: over.pipelineAtSync,
    });
  return { patches, calls, run };
}

describe('runRebaseChain', () => {
  test('forge rebased skips sync', async () => {
    const h = harness({ forge: { kind: 'rebased', sha: 'abc' } });
    const end = await h.run();
    expect(h.calls.sync).toBe(0);
    expect(end).toEqual({ kind: 'forge-done', message: 'rebased on GitLab' });
    expect(h.patches[0]).toMatchObject({
      status: 'forge-rebasing',
      forge: { forge: 'gitlab', state: 'running' },
    });
    expect(h.patches.at(-1)).toMatchObject({
      status: 'synced',
      message: 'rebased on GitLab',
      forge: { forge: 'gitlab', state: 'done', detail: 'rebased' },
    });
  });

  test('forge rebased names GitHub from the forge kind', async () => {
    const h = harness({
      forge: { kind: 'rebased', sha: null },
      forgeKind: 'github',
    });
    expect(await h.run()).toEqual({
      kind: 'forge-done',
      message: 'rebased on GitHub',
    });
  });

  test('forge current skips sync', async () => {
    const h = harness({ forge: { kind: 'current' } });
    const end = await h.run();
    expect(h.calls.sync).toBe(0);
    expect(end.kind).toBe('forge-done');
    expect(h.patches.at(-1)).toMatchObject({
      status: 'synced',
      forge: { state: 'done', detail: 'already current' },
    });
  });

  test('forge failed runs sync', async () => {
    const h = harness({
      forge: {
        kind: 'failed',
        reason: 'Rebase failed: conflict',
        conflicts: true,
      },
    });
    const end = await h.run();
    expect(h.calls.sync).toBe(1);
    expect(end).toEqual({ kind: 'synced', message: 'rebased and pushed' });
    expect(h.patches).toContainEqual(
      expect.objectContaining({
        status: 'syncing',
        forge: {
          forge: 'gitlab',
          state: 'failed',
          detail: 'Rebase failed: conflict',
        },
      })
    );
  });

  test('forge unclear runs sync', async () => {
    const h = harness({ forge: { kind: 'unclear' } });
    await h.run();
    expect(h.calls.sync).toBe(1);
    expect(h.patches).toContainEqual(
      expect.objectContaining({
        forge: {
          forge: 'gitlab',
          state: 'failed',
          detail: 'no clear answer from GitLab',
        },
      })
    );
  });

  test('cannot rebase runs sync with the step skipped', async () => {
    const h = harness({ forge: { kind: 'cannot' }, forgeKind: 'github' });
    await h.run();
    expect(h.calls.sync).toBe(1);
    expect(h.patches).toContainEqual(
      expect.objectContaining({
        forge: {
          forge: 'github',
          state: 'skipped',
          detail: 'GitHub cannot rebase',
        },
      })
    );
  });

  test('known conflicts skip the forge', async () => {
    const h = harness({ skipForge: true });
    await h.run();
    expect(h.calls.forge).toBe(0);
    expect(h.calls.sync).toBe(1);
    expect(h.patches).toContainEqual(
      expect.objectContaining({
        status: 'syncing',
        forge: {
          forge: 'gitlab',
          state: 'skipped',
          detail: 'conflicts already known',
        },
      })
    );
    expect(h.patches.some(p => p.status === 'forge-rebasing')).toBe(false);
  });

  test('cancel ends the chain', async () => {
    const h = harness({ forge: { kind: 'cancelled' } });
    const end = await h.run();
    expect(h.calls.sync).toBe(0);
    expect(end).toEqual({ kind: 'cancelled' });
    expect(h.patches.at(-1)).toMatchObject({
      status: 'sync-stopped',
      message: 'cancelled; the forge may still be rebasing',
      forge: { forge: 'gitlab', state: 'failed', detail: 'cancelled' },
    });
  });

  test('a forge that throws stops the chain with its message', async () => {
    const patches: Patch[] = [];
    let synced = 0;
    const end = await runRebaseChain({
      forge: async () => {
        throw new Error('gitlab token not configured');
      },
      forgeKind: 'gitlab',
      skipForge: false,
      sync: async () => {
        synced++;
        return { kind: 'clean', message: 'rebased and pushed', log: [] };
      },
      write: patch => patches.push(patch),
      hasDoctor: true,
    });
    expect(synced).toBe(0);
    expect(end).toEqual({
      kind: 'stopped',
      message: 'gitlab token not configured',
    });
    expect(patches.at(-1)).toMatchObject({
      status: 'sync-stopped',
      message: 'gitlab token not configured',
    });
  });

  test('a sync that throws stops the chain with its message', async () => {
    const patches: Patch[] = [];
    const end = await runRebaseChain({
      forge: async () => ({ kind: 'unclear' }),
      forgeKind: 'gitlab',
      skipForge: false,
      sync: async () => {
        throw new Error('daemon gone');
      },
      write: patch => patches.push(patch),
      hasDoctor: true,
    });
    expect(end).toEqual({ kind: 'stopped', message: 'daemon gone' });
    expect(patches.at(-1)).toMatchObject({
      status: 'sync-stopped',
      message: 'daemon gone',
    });
  });

  test('a clean sync writes synced with the log and pipeline', async () => {
    const h = harness({
      forge: { kind: 'unclear' },
      sync: { kind: 'clean', message: 'already up to date', log: ['a', 'b'] },
      pipelineAtSync: '77',
    });
    const end = await h.run();
    expect(end).toEqual({ kind: 'synced', message: 'already up to date' });
    expect(h.patches.at(-1)).toMatchObject({
      status: 'synced',
      message: 'already up to date',
      pausedTree: null,
      syncLog: ['a', 'b'],
      pipelineAtSync: '77',
    });
  });

  test('a stopped sync writes sync-stopped', async () => {
    const h = harness({
      forge: { kind: 'unclear' },
      sync: { kind: 'stopped', message: 'rebased, not pushed', log: ['x'] },
    });
    const end = await h.run();
    expect(end).toEqual({ kind: 'stopped', message: 'rebased, not pushed' });
    expect(h.patches.at(-1)).toMatchObject({
      status: 'sync-stopped',
      message: 'rebased, not pushed',
      pausedTree: null,
      syncLog: ['x'],
    });
  });

  test('sync conflict with a doctor pauses for the doctor', async () => {
    const h = harness({
      forge: { kind: 'unclear' },
      sync: { kind: 'conflict', tree: '/trees/elrond', log: ['l'] },
    });
    const end = await h.run();
    expect(end).toEqual({
      kind: 'paused',
      tree: '/trees/elrond',
      doctor: true,
    });
    expect(h.patches.at(-1)).toMatchObject({
      status: 'queued',
      pausedTree: '/trees/elrond',
      syncLog: ['l'],
    });
  });

  test('sync conflict without a doctor stops on the tree', async () => {
    const h = harness({
      forge: { kind: 'unclear' },
      sync: { kind: 'conflict', tree: '/trees/elrond', log: [] },
      hasDoctor: false,
    });
    const end = await h.run();
    expect(end).toEqual({
      kind: 'paused',
      tree: '/trees/elrond',
      doctor: false,
    });
    expect(h.patches.at(-1)).toMatchObject({
      status: 'sync-stopped',
      pausedTree: '/trees/elrond',
      message: 'paused in /trees/elrond; no doctor on this tab',
    });
  });
});
