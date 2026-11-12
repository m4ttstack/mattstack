import { DAEMON_UNREACHABLE_PREFIX, rtCommand } from '@mattstack/rt-client';
import type { MrAction } from './mr-action.ts';

/** Must stay above the daemon's own mr:action budget (90 s), or the board
    gives up on a write the daemon is still finishing. */
export const FORGE_WRITE_TIMEOUT_MS = 120_000;

export type MergeQueued = { position: number | null; state: string };

export type ForgeWriteResult =
  | {
      kind: 'done';
      mergeQueued?: MergeQueued;
      sourceBranchNotDeleted?: string;
      noteId?: number;
      title?: string;
      recovered?: boolean;
      verified?: false;
    }
  | { kind: 'refused'; reason: string }
  | { kind: 'unanswered'; reason: string }
  | { kind: 'failed'; message: string };

type Command = typeof rtCommand;

const OPTS = { timeoutMs: FORGE_WRITE_TIMEOUT_MS };

const MERGE_UNANSWERED = 'the merge may still land';
const ACTION_UNANSWERED = 'it may still apply';
const NOTE_UNANSWERED = 'the note may have posted';

export function forgeReason(error: string): string {
  return error.replace(/^Error: /, '').replace(/^\w+ failed: /, '');
}

const unanswered = (error: string | undefined) =>
  (error ?? '').startsWith(DAEMON_UNREACHABLE_PREFIX);

async function mergedOnForge(
  repoName: string,
  iid: number,
  command: Command
): Promise<boolean> {
  const read = await command<{ mr?: { state?: string } }>(
    'mr:get',
    { repoName, iid, refresh: true },
    OPTS
  );
  return read.ok && read.data?.mr?.state === 'merged';
}

export async function githubMrWrite(
  repoName: string,
  iid: number,
  action: MrAction,
  command: Command = rtCommand
): Promise<ForgeWriteResult> {
  const res = await command<{
    sourceBranchNotDeleted?: string;
    queued?: { position: number | null; state: string };
  }>('mr:action', { repoName, iid, action, args: [] }, OPTS);
  if (res.ok) {
    const done: ForgeWriteResult = { kind: 'done' };
    if (res.data?.queued) done.mergeQueued = res.data.queued;
    if (res.data?.sourceBranchNotDeleted)
      done.sourceBranchNotDeleted = res.data.sourceBranchNotDeleted;
    return done;
  }
  if (unanswered(res.error)) {
    if (action !== 'merge')
      return { kind: 'unanswered', reason: ACTION_UNANSWERED };
    return (await mergedOnForge(repoName, iid, command))
      ? { kind: 'done' }
      : { kind: 'unanswered', reason: MERGE_UNANSWERED };
  }
  return { kind: 'refused', reason: forgeReason(res.error ?? '') };
}

export async function githubSetDraft(
  repoName: string,
  iid: number,
  draft: boolean,
  command: Command = rtCommand
): Promise<ForgeWriteResult> {
  const res = await command(
    'mr:action',
    { repoName, iid, action: 'toggleDraft', args: [draft] },
    OPTS
  );
  if (res.ok) return { kind: 'done' };
  if (unanswered(res.error))
    return { kind: 'unanswered', reason: ACTION_UNANSWERED };
  return { kind: 'refused', reason: forgeReason(res.error ?? '') };
}

export async function githubPostNote(
  repoName: string,
  iid: number,
  body: string,
  command: Command = rtCommand
): Promise<ForgeWriteResult> {
  const res = await command<{ noteId?: number }>(
    'mr:comment',
    { repoName, iid, body, resolvable: false },
    OPTS
  );
  if (res.ok) {
    const noteId = res.data?.noteId;
    return typeof noteId === 'number'
      ? { kind: 'done', noteId }
      : { kind: 'done' };
  }
  if (unanswered(res.error))
    return { kind: 'unanswered', reason: NOTE_UNANSWERED };
  return { kind: 'refused', reason: forgeReason(res.error ?? '') };
}
