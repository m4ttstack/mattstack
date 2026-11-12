import type { DoctorState } from './doctor-state.ts';
import type { ForgeKind, ForgeRebaseResult } from './forge-rebase.ts';
import type { LocalSyncOutcome } from './local-sync.ts';

export interface ForgeStep {
  forge: ForgeKind;
  state: 'running' | 'done' | 'failed' | 'skipped';
  detail?: string;
}

export type RebaseChainEnd =
  | { kind: 'forge-done'; message: string }
  | { kind: 'synced'; message: string }
  | { kind: 'stopped'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'paused'; tree: string; doctor: boolean };

export interface RebaseChainDeps {
  forge: () => Promise<ForgeRebaseResult>;
  forgeKind: ForgeKind;
  skipForge: boolean;
  sync: () => Promise<LocalSyncOutcome>;
  write: (patch: Partial<DoctorState>) => void;
  hasDoctor: boolean;
  /** The pipeline the MR showed before the chain pushed. */
  pipelineAtSync?: string;
}

const forgeName = (kind: ForgeKind) =>
  kind === 'github' ? 'GitHub' : 'GitLab';

/** A null clears a field on the row, an undefined keeps it. */
const CLEAR = null as unknown as undefined;

/** The step the forge leaves behind when the local sync has to run. */
function stepAfterForge(kind: ForgeKind, result: ForgeRebaseResult): ForgeStep {
  const name = forgeName(kind);
  if (result.kind === 'cannot')
    return { forge: kind, state: 'skipped', detail: `${name} cannot rebase` };
  if (result.kind === 'failed')
    return { forge: kind, state: 'failed', detail: result.reason };
  return {
    forge: kind,
    state: 'failed',
    detail: `no clear answer from ${name}`,
  };
}

/** `runningForge` names the forge when the throw cut its step off, so the
    step does not stay running on a stopped row. */
function stopOnThrow(
  write: RebaseChainDeps['write'],
  err: unknown,
  runningForge?: ForgeKind
): RebaseChainEnd {
  const message = err instanceof Error ? err.message : String(err);
  write({
    status: 'sync-stopped',
    message,
    ...(runningForge
      ? { forge: { forge: runningForge, state: 'failed', detail: message } }
      : {}),
  });
  return { kind: 'stopped', message };
}

export async function runRebaseChain(
  deps: RebaseChainDeps
): Promise<RebaseChainEnd> {
  const { forgeKind, write } = deps;
  let forge: ForgeStep;

  if (deps.skipForge) {
    forge = {
      forge: forgeKind,
      state: 'skipped',
      detail: 'conflicts already known',
    };
  } else {
    write({
      status: 'forge-rebasing',
      forge: { forge: forgeKind, state: 'running' },
    });
    let result: ForgeRebaseResult;
    try {
      result = await deps.forge();
    } catch (err) {
      return stopOnThrow(write, err, forgeKind);
    }
    if (result.kind === 'cancelled') {
      write({
        status: 'sync-stopped',
        message: 'cancelled; the forge may still be rebasing',
        forge: { forge: forgeKind, state: 'failed', detail: 'cancelled' },
      });
      return { kind: 'cancelled' };
    }
    if (result.kind === 'rebased' || result.kind === 'current') {
      const rebased = result.kind === 'rebased';
      const message = rebased
        ? `rebased on ${forgeName(forgeKind)}`
        : `already up to date on ${forgeName(forgeKind)}`;
      write({
        status: 'synced',
        message,
        pausedTree: CLEAR,
        pipelineAtSync: rebased ? (deps.pipelineAtSync ?? CLEAR) : CLEAR,
        forge: {
          forge: forgeKind,
          state: 'done',
          detail: rebased ? 'rebased' : 'already current',
        },
      });
      return { kind: 'forge-done', message };
    }
    forge = stepAfterForge(forgeKind, result);
  }

  write({ status: 'syncing', forge });
  let outcome: LocalSyncOutcome;
  try {
    outcome = await deps.sync();
  } catch (err) {
    return stopOnThrow(write, err);
  }
  const syncLog = outcome.log;

  if (outcome.kind === 'clean') {
    write({
      status: 'synced',
      message: outcome.message,
      pausedTree: CLEAR,
      syncLog,
      pipelineAtSync: deps.pipelineAtSync ?? CLEAR,
    });
    return { kind: 'synced', message: outcome.message };
  }
  if (outcome.kind === 'stopped') {
    write({
      status: 'sync-stopped',
      message: outcome.message,
      pausedTree: CLEAR,
      syncLog,
    });
    return { kind: 'stopped', message: outcome.message };
  }
  if (deps.hasDoctor) {
    write({ status: 'queued', pausedTree: outcome.tree, syncLog });
    return { kind: 'paused', tree: outcome.tree, doctor: true };
  }
  write({
    status: 'sync-stopped',
    message: `paused in ${outcome.tree}; no doctor on this tab`,
    pausedTree: outcome.tree,
    syncLog,
  });
  return { kind: 'paused', tree: outcome.tree, doctor: false };
}
