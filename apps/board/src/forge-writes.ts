import {
  ReadBackFailedError,
  type GitLabProvider,
  type NoteMutator,
} from '@mattstack/glance';
import { DAEMON_UNREACHABLE_PREFIX, rtCommand } from '@mattstack/rt-client';
import {
  mergeRefusalReason,
  runMrAction,
  type MrAction,
  type MrActionProvider,
} from './mr-action.ts';

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

type Written<K extends ForgeWriteResult['kind']> = Extract<
  ForgeWriteResult,
  { kind: K }
>;

export type GithubWriteResult = Written<'done' | 'refused' | 'unanswered'>;

type Command = typeof rtCommand;

const OPTS = { timeoutMs: FORGE_WRITE_TIMEOUT_MS };

const MERGE_UNANSWERED = 'the merge may still land';
const ACTION_UNANSWERED = 'it may still apply';
const NOTE_UNANSWERED = 'the note may have posted';

export function forgeReason(error: string): string {
  return error.replace(/^Error: /, '').replace(/^\w+ failed: /, '');
}

const refusedReason = (error: string | undefined, cmd: string) =>
  forgeReason(error ?? '') || `${cmd} failed`;

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
): Promise<GithubWriteResult> {
  const res = await command<{
    sourceBranchNotDeleted?: string;
    queued?: { position: number | null; state: string };
  }>('mr:action', { repoName, iid, action, args: [] }, OPTS);
  if (res.ok) {
    const done: Written<'done'> = { kind: 'done' };
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
  return { kind: 'refused', reason: refusedReason(res.error, 'mr:action') };
}

export async function githubSetDraft(
  repoName: string,
  iid: number,
  draft: boolean,
  command: Command = rtCommand
): Promise<GithubWriteResult> {
  const res = await command(
    'mr:action',
    { repoName, iid, action: 'toggleDraft', args: [draft] },
    OPTS
  );
  if (res.ok) return { kind: 'done' };
  if (unanswered(res.error))
    return { kind: 'unanswered', reason: ACTION_UNANSWERED };
  return { kind: 'refused', reason: refusedReason(res.error, 'mr:action') };
}

export async function githubPostNote(
  repoName: string,
  iid: number,
  body: string,
  command: Command = rtCommand
): Promise<GithubWriteResult> {
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
  return { kind: 'refused', reason: refusedReason(res.error, 'mr:comment') };
}

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** A factory is resolved inside the write's own try, so a provider that
    cannot be built is classified like any other failed write. */
type Source<P> = P | (() => P | Promise<P>);

const resolveSource = async <P extends object>(
  source: Source<P>
): Promise<P> =>
  typeof source === 'function'
    ? await (source as () => P | Promise<P>)()
    : source;

export async function gitlabMrWrite(
  provider: Source<MrActionProvider>,
  path: string,
  iid: number,
  action: MrAction,
  onError?: (message: string) => void
): Promise<Written<'done' | 'refused' | 'failed'>> {
  try {
    await runMrAction(await resolveSource(provider), path, iid, action);
    return { kind: 'done' };
  } catch (err) {
    const message = errorMessage(err);
    onError?.(message);
    const reason = action === 'merge' ? mergeRefusalReason(message) : null;
    return reason ? { kind: 'refused', reason } : { kind: 'failed', message };
  }
}

export async function gitlabSetDraft(
  provider: Source<Pick<GitLabProvider, 'updatePullRequest' | 'fetchSingleMR'>>,
  path: string,
  iid: number,
  draft: boolean,
  onError?: (message: string) => void
): Promise<Written<'done' | 'failed'>> {
  try {
    const updated = await (
      await resolveSource(provider)
    ).updatePullRequest(path, iid, { draft });
    return { kind: 'done', title: updated.title };
  } catch (err) {
    const message = errorMessage(err);
    onError?.(message);
    // glance retries its post-write read-back before giving up, and the edit
    // has landed either way, so ask GitLab what is true before calling a
    // write that worked a failure.
    const after = await (
      await resolveSource(provider)
    )
      .fetchSingleMR(path, iid, null)
      .catch(() => null);
    if (after?.draft === draft)
      return { kind: 'done', title: after.title, recovered: true };
    // The SDK says outright the edit reached GitLab and only describing it
    // back failed; that outranks a recovery read that may itself have failed.
    if (err instanceof ReadBackFailedError && err.writeApplied)
      return { kind: 'done', recovered: true, verified: false };
    return { kind: 'failed', message };
  }
}

export async function gitlabPostNote(
  mutator: Pick<NoteMutator, 'createNote'>,
  projectId: number,
  iid: number,
  body: string
): Promise<Written<'done' | 'failed'>> {
  try {
    const note = await mutator.createNote(projectId, iid, body);
    return { kind: 'done', noteId: note.id };
  } catch (err) {
    return { kind: 'failed', message: errorMessage(err) };
  }
}
