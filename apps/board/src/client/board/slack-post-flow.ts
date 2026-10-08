import type { BoardMR } from '../../data.ts';
import type { ActionResult } from '../api.ts';
import type { ToastHandle } from './launch-flow.ts';
import type { SlackPostPreview } from './OwnersPostModal.tsx';

export interface SlackPostDeps {
  post: (path: string, payload: unknown) => Promise<ActionResult>;
  /** Repos whose code owner sections name Slack channels. */
  ownerRepos: string[];
  startToast: (text: string) => ToastHandle;
  openDialog: (mr: BoardMR, preview: SlackPostPreview) => void;
  reload: () => void;
}

/** The thread lookup's answer: the ref the board now keeps for the MR. */
export interface SlackRefBody {
  status: 'found' | 'notfound';
  permalink?: string;
  reactions?: string[];
  checkedAt: number;
}

/** How stale a "no thread" answer may be before an open menu asks again. */
const LOOKUP_AFTER_MS = 60_000;

/** Whether opening this MR's menu should look for its Slack thread: never
    looked for, or not found over a minute ago. The background sweep covers
    the rest; this catches a thread posted since. */
export function needsThreadLookup(
  mr: {
    webUrl?: string | null;
    slack?: { status: 'found' | 'notfound'; checkedAt?: number };
  },
  now: number,
  env: { local: boolean; slackEnabled?: boolean }
): boolean {
  if (!env.local || !env.slackEnabled || !mr.webUrl) return false;
  if (!mr.slack) return true;
  return (
    mr.slack.status === 'notfound' &&
    now - (mr.slack.checkedAt ?? 0) > LOOKUP_AFTER_MS
  );
}

interface PostOutcome {
  posted: Array<{ channel: string }>;
  failed: Array<{ channel: string; error: string }>;
}

/** "post to slack" on one MR. Where code owners have channels, the board
    first reads which of them still need asking: with only the team channel
    left it posts there at once, and otherwise opens the dialog. */
export async function startSlackPost(
  mr: BoardMR,
  deps: SlackPostDeps
): Promise<void> {
  if (!mr.webUrl) return;
  if (!mr.rtRepo || !deps.ownerRepos.includes(mr.rtRepo)) {
    const toast = deps.startToast(`posting !${mr.iid} to slack…`);
    const result = await deps.post('/slack/post', { mrUrls: [mr.webUrl] });
    if (!result.ok)
      return toast.fail(`slack post failed for !${mr.iid} (${result.status})`);
    toast.done(
      result.body?.linked
        ? `!${mr.iid} already in slack... linked`
        : `posted !${mr.iid} to slack`
    );
    deps.reload();
    return;
  }
  const toast = deps.startToast(`checking where !${mr.iid} goes in slack…`);
  const read = await deps.post('/slack/owners/preview', { mrUrl: mr.webUrl });
  if (!read.ok)
    return toast.fail(
      `could not check slack for !${mr.iid} (${read.status})${read.text ? `: ${read.text}` : ''}`
    );
  const preview = read.body as unknown as SlackPostPreview;
  if (!preview.direct) {
    toast.done(`!${mr.iid} needs code owners too, pick channels`);
    deps.openDialog(mr, preview);
    return;
  }
  const sent = await deps.post('/slack/owners/post', {
    mrUrl: mr.webUrl,
    team: true,
  });
  const outcome = sent.body as unknown as PostOutcome | null;
  if (!sent.ok || !outcome || outcome.failed.length > 0)
    return toast.fail(
      `slack post failed for !${mr.iid}: ${
        outcome?.failed
          .map(f => `#${f.channel} failed: ${f.error}`)
          .join(', ') || `${sent.status}${sent.text ? ` ${sent.text}` : ''}`
      }`
    );
  toast.done(`posted !${mr.iid} to #${preview.team.channel}`);
  deps.reload();
}
