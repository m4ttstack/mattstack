/** rt sync's streamed lines read back as four fixed steps, led by the forge's
    own rebase when the chain asked it first, so the popover and the row's
    word show where a sync is without replaying its log. */

import type { ForgeStep } from '../types.ts';
import { parseSyncLine } from './sync-lines.ts';

type LocalKey = 'fetch' | 'backup' | 'rebase' | 'push';
export type StepKey = LocalKey | 'forge';
export type StepState =
  'done' | 'running' | 'pending' | 'skipped' | 'failed' | 'paused';

export interface SyncStep {
  key: StepKey;
  label: string;
  state: StepState;
  detail?: string;
  /** The backup branch, offered for copying. */
  ref?: string;
}

type LocalStep = SyncStep & { key: LocalKey };

export interface SyncView {
  title: string;
  tree?: string;
  steps: SyncStep[];
  /** Set when the chain asked a forge first; GitHub's step carries a note. */
  forge?: ForgeStep['forge'];
  /** What the row's word says while the sync runs. */
  phase?: { word: string; detail?: string };
  failure?: string;
  outcome:
    | 'running'
    | 'pushed'
    | 'up-to-date'
    | 'not-pushed'
    | 'paused'
    | 'failed'
    | 'forge-done'
    | 'cancelled';
}

const LABELS: Record<LocalKey, string> = {
  fetch: 'Fetch',
  backup: 'Back up',
  rebase: 'Rebase',
  push: 'Push',
};

const PHASE_WORD: Record<LocalKey, string> = {
  fetch: 'fetching',
  backup: 'backing up',
  rebase: 'rebasing',
  push: 'pushing',
};

const FAILED_DETAIL: Record<LocalKey, string> = {
  fetch: 'could not reach origin',
  backup: 'nothing was changed',
  rebase: 'stopped',
  push: 'failed',
};

/** A stop named by its step: rt's own failure line names the branch,
    which the row already shows. */
const FAILED_TITLE: Record<LocalKey, string> = {
  fetch: 'Fetch failed',
  backup: 'Backup failed',
  rebase: 'Rebase stopped',
  push: 'Rebased, not pushed',
};

const ORDER: LocalKey[] = ['fetch', 'backup', 'rebase', 'push'];

const forgeName = (kind: ForgeStep['forge']) =>
  kind === 'github' ? 'GitHub' : 'GitLab';

const shortTarget = (t: string) => t.replace(/^origin\//, '');
const commits = (hint?: string) => hint?.replace(/ behind$/, '');

/** Each step by rt's own wording, anchored where the branch cannot reach:
    titles carry the branch name, so a loose match would read a branch named
    "backup" or "conflict" as that step. */
function keyOf(title: string): LocalKey | null {
  if (/^Fetch(ing|ed) from origin/.test(title)) return 'fetch';
  if (/^(Saved a backup|Could not save a backup)/.test(title)) return 'backup';
  if (
    /^Rebas(ing|ed) /.test(title) ||
    / is up to date with \S+$/.test(title) ||
    /^\d+ files? (has|have) conflicts/.test(title) ||
    /^The rebase /.test(title)
  )
    return 'rebase';
  if (/^Push(ing|ed)\b/.test(title) || /^Could not push /.test(title))
    return 'push';
  return null;
}

export function syncSteps(
  lines: readonly string[],
  running: boolean,
  forge?: ForgeStep
): SyncView {
  const steps = new Map<LocalKey, LocalStep>(
    ORDER.map(key => [key, { key, label: LABELS[key], state: 'pending' }])
  );
  let parsed = 0;
  let tree: string | undefined;
  let target: string | undefined;
  let upToDate = false;
  let conflicts: string | undefined;
  let failure: string | undefined;
  let failedAt: LocalKey | undefined;

  for (const raw of lines) {
    const line = parseSyncLine(raw);
    if (!line.status) continue;
    parsed++;
    const worktree = /^Syncing in worktree (.+)$/.exec(line.title);
    if (worktree) {
      tree = worktree[1];
      continue;
    }
    const key = keyOf(line.title);
    if (line.status === 'failed' || line.status === 'refused') {
      const at =
        key ??
        ORDER.find(k => steps.get(k)!.state === 'running') ??
        ORDER.find(k => steps.get(k)!.state === 'pending');
      if (at) {
        const step = steps.get(at)!;
        step.state = 'failed';
        step.detail = FAILED_DETAIL[at];
        failedAt = at;
      }
      failure = line.title;
      continue;
    }
    if (!key) continue;
    const step = steps.get(key)!;
    const onto = /onto (\S+)$/.exec(line.title);
    if (onto) target = shortTarget(onto[1]!);
    if (key === 'backup') {
      step.state = line.status === 'running' ? 'running' : 'done';
      if (line.hint) step.ref = line.hint;
      continue;
    }
    if (key === 'rebase' && line.status === 'needs-you') {
      step.state = 'paused';
      const n = /^(\d+ files?)/.exec(line.title);
      conflicts = n ? n[1] : undefined;
      step.detail = conflicts
        ? `conflicts in ${conflicts}`
        : 'paused on conflicts';
      continue;
    }
    if (key === 'rebase' && / is up to date with /.test(line.title)) {
      upToDate = true;
      step.state = 'done';
      step.detail = 'nothing to rebase';
      const t = / with (\S+)$/.exec(line.title);
      if (t) target = shortTarget(t[1]!);
      continue;
    }
    step.state = line.status === 'running' ? 'running' : 'done';
    if (key === 'rebase' && line.hint) {
      step.detail = line.status === 'running' ? commits(line.hint) : line.hint;
    } else if (key === 'fetch') step.detail = 'origin';
  }

  // A running line that later lines moved past finished; rt prints no
  // done line for every step.
  let seenLater = false;
  for (const key of [...ORDER].reverse()) {
    const s = steps.get(key)!;
    if (s.state === 'running' && (seenLater || !running)) s.state = 'done';
    if (s.state !== 'pending') seenLater = true;
  }

  const list = ORDER.map(k => steps.get(k)!);
  const stopped = list.some(s => s.state === 'failed' || s.state === 'paused');
  // rt prints some steps only once they finish (the backup), so between
  // lines the step after the last finished one is the one at work.
  if (
    running &&
    !stopped &&
    !list.some(s => s.state === 'running') &&
    list.some(s => s.state === 'done')
  ) {
    const next = list.find(s => s.state === 'pending');
    if (next) next.state = 'running';
  }
  // The forge settled it or was cancelled before any local sync began.
  const forgeOnly = !!forge && !running && parsed === 0;
  const cancelled =
    forgeOnly && forge.state === 'failed' && forge.detail === 'cancelled';
  if (!running && !stopped)
    for (const s of list)
      if (s.state === 'pending') {
        s.state = 'skipped';
        if (!forgeOnly)
          s.detail =
            s.key === 'backup' ? 'nothing to back up' : 'nothing to push';
      }

  const forgeStep: SyncStep | undefined = forge && {
    key: 'forge',
    label: `${forgeName(forge.forge)} rebase`,
    state: forge.state,
    ...(forge.detail ? { detail: forge.detail } : {}),
  };
  const forgeRunning = running && forge?.state === 'running';
  const current = forgeRunning
    ? undefined
    : list.find(s => s.state === 'running');
  const forgeWord = forge ? `on ${forgeName(forge.forge)}` : '';
  const onto = target ? ` onto ${target}` : '';
  const pushed = steps.get('push')!.state === 'done';
  const outcome: SyncView['outcome'] = running
    ? 'running'
    : cancelled
      ? 'cancelled'
      : forgeOnly && forge.state === 'done'
        ? 'forge-done'
        : forgeOnly
          ? 'failed'
          : steps.get('rebase')!.state === 'paused'
            ? 'paused'
            : failure
              ? 'failed'
              : pushed
                ? 'pushed'
                : upToDate
                  ? 'up-to-date'
                  : 'not-pushed';

  const title = {
    running: forgeRunning
      ? `Rebasing ${forgeWord}`
      : current
        ? current.key === 'rebase'
          ? `Rebasing${onto}`
          : `${PHASE_WORD[current.key][0]!.toUpperCase()}${PHASE_WORD[current.key].slice(1)}`
        : 'Starting',
    pushed: 'Rebased and pushed',
    'up-to-date': 'Already up to date',
    'not-pushed': 'Rebased, not pushed',
    paused: 'Rebase paused on conflicts',
    failed: failedAt
      ? FAILED_TITLE[failedAt]
      : forgeOnly && forge.state === 'failed'
        ? 'Rebase failed'
        : 'Sync stopped',
    'forge-done':
      forge?.detail === 'already current'
        ? `Already up to date ${forgeWord}`
        : `Rebased ${forgeWord}`,
    cancelled: 'Rebase cancelled',
  }[outcome];

  const phase = running
    ? forgeRunning
      ? { word: 'rebasing', detail: forgeWord }
      : current
        ? {
            word: PHASE_WORD[current.key],
            ...(current.key === 'rebase' && current.detail
              ? { detail: `${current.detail}${onto}` }
              : current.key === 'fetch'
                ? { detail: 'origin' }
                : {}),
          }
        : { word: 'preparing', ...(tree ? { detail: `worktree ${tree}` } : {}) }
    : undefined;

  return {
    title,
    ...(tree ? { tree } : {}),
    steps: forgeStep ? [forgeStep, ...list] : list,
    ...(forge ? { forge: forge.forge } : {}),
    ...(phase ? { phase } : {}),
    ...(failure ? { failure } : {}),
    outcome,
  };
}
