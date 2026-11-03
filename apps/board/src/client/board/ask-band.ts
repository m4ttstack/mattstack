/** The band at the foot of a row that shows a teammate's agent working on
    this MR: this board's own ask of it, or a review their board started and
    lost, which the same band lets you ask for again. Kept off the status
    line and its "+N active" count, since the work is remote. */
import type {
  BoardMRWithReview,
  PeerReviewInfo,
  SentNudgeInfo,
} from '../types.ts';
import type { ActionRequest } from './row-actions.ts';

export type AskTone = 'neutral' | 'work' | 'ok' | 'bad' | 'warn';
export type AskAction = 'retry' | 'dismiss';

/** One line of the hover trail. `at` is absent when the step has no time of
    its own (a silence is not an event). */
export interface AskStep {
  name: string;
  detail: string;
  at?: number;
}

export interface AskBand {
  tone: AskTone;
  /** A lucide icon name. */
  icon: string;
  /** The teammate, as the band and the trail name them. */
  name: string;
  who: string;
  title: string;
  label: string;
  /** A quiet line at the band's right edge, when the state has nothing else
      to say there. */
  note?: string;
  actions: AskAction[];
  /** What the row knows of the ask's life, oldest first. */
  steps: AskStep[];
}

type Kind = NonNullable<SentNudgeInfo['kind']>;

const REQUESTED: Record<Kind, string> = {
  review: 'review requested',
  're-review': 're-review requested',
  respond: 'response requested',
};
const RUNNING: Record<Kind, string> = {
  review: 'reviewing',
  're-review': 'following up',
  respond: 'responding',
};
const DONE: Record<Kind, string> = {
  review: 'reviewed',
  're-review': 'followed up',
  respond: 'responded',
};
const TITLE: Record<Kind, string> = {
  review: 'Review',
  're-review': 'Follow-up review',
  respond: 'Response',
};

function doneLabel(kind: Kind, outcome?: string): string {
  const base = DONE[kind];
  if (outcome === 'approve') return `${base}: approved`;
  if (outcome === 'comment') return `${base}: comments`;
  return base;
}

const dayStart = (d: Date): number =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A moment as the reader would say it: the time today, "yesterday 6:30 PM",
    or the date and time for anything older. Days count by the calendar, not
    by 24-hour blocks. */
export function clock(ms: number, now: number = Date.now()): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
  const days = Math.round(
    (dayStart(new Date(now)) - dayStart(at)) / 86_400_000
  );
  if (days <= 0) return time;
  if (days === 1) return `yesterday ${time}`;
  const date = at.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
}

export function askBandModel(
  sent: SentNudgeInfo,
  now: number = Date.now(),
  name: string = sent.reviewer
): AskBand {
  const kind: Kind = sent.kind ?? 're-review';
  const requested: AskStep = {
    name: 'Requested',
    detail: 'you',
    at: sent.sentAt,
  };
  const band = (
    b: Pick<AskBand, 'tone' | 'icon' | 'label'> &
      Partial<Pick<AskBand, 'actions' | 'note'>>,
    ...more: AskStep[]
  ): AskBand => ({
    name,
    who: `${name}'s agent`,
    title: `${TITLE[kind]} from ${name}`,
    actions: [],
    ...b,
    steps: [requested, ...more],
  });

  switch (sent.display) {
    case 'confirmed':
    case 'launched':
      return band(
        {
          tone: 'work',
          icon: 'loader',
          label: RUNNING[kind],
          actions: ['dismiss'],
        },
        {
          name: 'Started',
          detail: `${name}'s agent`,
          at: sent.resolvedAt,
        }
      );
    case 'done': {
      const label = doneLabel(kind, sent.outcome);
      return band(
        {
          tone: 'ok',
          icon: 'check',
          label,
          actions: ['dismiss'],
        },
        { name: 'Finished', detail: label, at: sent.finishedAt }
      );
    }
    case 'failed':
      return band(
        {
          tone: 'bad',
          icon: 'triangle-alert',
          label: sent.reason ? `stopped: ${sent.reason}` : 'failed to run',
          actions: ['retry', 'dismiss'],
        },
        {
          name: 'Failed',
          detail: sent.reason ?? `${name}'s agent hit an error`,
          at: sent.finishedAt,
        }
      );
    case 'rejected':
      if (sent.declined)
        return band(
          {
            tone: 'bad',
            icon: 'ban',
            label: sent.reason
              ? `${name} declined: ${sent.reason}`
              : `${name} declined`,
            actions: ['dismiss'],
          },
          {
            name: 'Declined',
            detail: sent.declineNote ?? sent.reason ?? `${name} said no`,
            at: sent.resolvedAt,
          }
        );
      if (sent.reason === 'asks-off')
        return band(
          {
            tone: 'bad',
            icon: 'ban',
            label: `${name} has asks turned off`,
            actions: ['dismiss'],
          },
          { name: 'Declined', detail: `${name}'s board takes no asks` }
        );
      return band(
        {
          tone: 'bad',
          icon: 'ban',
          label: sent.reason ? `declined: ${sent.reason}` : 'declined',
          actions: ['retry', 'dismiss'],
        },
        {
          name: 'Declined',
          detail: sent.reason ?? `${name}'s board refused it`,
        }
      );
    case 'expired':
    case 'no-response':
      return band(
        {
          tone: 'warn',
          icon: 'hourglass',
          label: 'no answer',
          actions: ['retry', 'dismiss'],
        },
        { name: 'No answer', detail: `${name}'s board never replied` }
      );
    case 'no-update':
      return band(
        {
          tone: 'warn',
          icon: 'hourglass',
          label: 'no update',
          actions: ['retry', 'dismiss'],
        },
        { name: 'Started', detail: `${name}'s agent`, at: sent.resolvedAt },
        { name: 'No update', detail: `${name}'s agent has been quiet for 30m` }
      );
    case 'pending':
      return band(
        {
          tone: 'neutral',
          icon: 'hourglass',
          label: `waiting for ${name}'s go ahead`,
          actions: ['dismiss'],
          ...(sent.sentAt ? { note: `Sent ${clock(sent.sentAt, now)}` } : {}),
        },
        {
          name: 'Waiting',
          detail: `for ${name}'s go ahead`,
          at: sent.resolvedAt,
        }
      );
    case 'requested':
      return band({
        tone: 'neutral',
        icon: 'send',
        label: REQUESTED[kind],
        ...(sent.sentAt ? { note: `Sent ${clock(sent.sentAt, now)}` } : {}),
      });
  }
}

/** A review a teammate's board started on its own and lost. The peer state
    carries only the failure's time, so the Started step has no clock. */
export function peerFailureBandModel(
  peer: PeerReviewInfo,
  name: string = peer.reviewer
): AskBand {
  return {
    tone: 'bad',
    icon: 'triangle-alert',
    name,
    who: `${name}'s agent`,
    title: `Review from ${name}`,
    label: peer.reason ? `stopped: ${peer.reason}` : 'failed to run',
    actions: ['retry', 'dismiss'],
    steps: [
      { name: 'Started', detail: `${name}'s board` },
      {
        name: 'Failed',
        detail: peer.reason ?? `${name}'s agent hit an error`,
        at: peer.updatedAt,
      },
    ],
  };
}

export type BandSource =
  | { kind: 'sent'; sent: SentNudgeInfo }
  | { kind: 'peer'; peer: PeerReviewInfo };

/** What the row's band shows: this board's own ask first, else a peer's
    errored review nobody has dismissed. */
export function bandSource(mr: BoardMRWithReview): BandSource | null {
  if (mr.sentNudge) return { kind: 'sent', sent: mr.sentNudge };
  const peer = (mr.peerReviews ?? []).find(
    p => p.status === 'error' && p.dismissedAt === undefined
  );
  return peer ? { kind: 'peer', peer } : null;
}

/** The band's dismiss, as the local board takes it: a sent ask is dropped
    outright; a peer's lost review is stamped on that reviewer's state. */
export function bandDismissRequest(
  mr: BoardMRWithReview
): { path: string; body: Record<string, string> } | null {
  const source = bandSource(mr);
  if (!source || !mr.webUrl) return null;
  return source.kind === 'sent'
    ? { path: '/nudge/dismiss', body: { mrUrl: mr.webUrl } }
    : {
        path: '/peer-review/dismiss',
        body: { mrUrl: mr.webUrl, reviewer: source.peer.reviewer },
      };
}

/** What a sent retry settles: the peer failure it replaced, stamped
    dismissed so it cannot resurface once the new ask is gone. */
export function bandRetrySettles(
  mr: BoardMRWithReview
): { path: string; body: Record<string, string> } | null {
  return bandSource(mr)?.kind === 'peer' ? bandDismissRequest(mr) : null;
}

/** The band's retry: the same kind of ask to the same teammate (/nudge
    replaces the recorded ask, so the new one scraps the old), or a fresh
    re-review from the peer whose own review was lost. */
export function bandRetryAction(
  mr: BoardMRWithReview
): Extract<ActionRequest, { kind: 'ask' }> | null {
  const source = bandSource(mr);
  if (!source) return null;
  return source.kind === 'sent'
    ? {
        kind: 'ask',
        ask: source.sent.kind ?? 're-review',
        reviewer: source.sent.reviewer,
      }
    : { kind: 'ask', ask: 're-review', reviewer: source.peer.reviewer };
}
