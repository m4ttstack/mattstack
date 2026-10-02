/** The band at the foot of a row that shows this board's own ask of a
    teammate's agent: where it stands and what can be done about it. Kept off
    the status line and its "+N active" count, since the work is remote. */
import type { SentNudgeInfo } from '../types.ts';

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
  're-review': 're-reviewing',
  respond: 'responding',
};
const DONE: Record<Kind, string> = {
  review: 'reviewed',
  're-review': 're-reviewed',
  respond: 'responded',
};
const TITLE: Record<Kind, string> = {
  review: 'Review',
  're-review': 'Re-review',
  respond: 'Response',
};

function doneLabel(kind: Kind, outcome?: string): string {
  const base = DONE[kind];
  if (outcome === 'approve') return `${base}: approved`;
  if (outcome === 'comment') return `${base}: comments`;
  return base;
}

const capitalize = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export function askBandModel(sent: SentNudgeInfo): AskBand {
  const kind: Kind = sent.kind ?? 're-review';
  const name =
    sent.reviewerName?.trim().split(/\s+/)[0] || capitalize(sent.reviewer);
  const requested: AskStep = {
    name: 'Requested',
    detail: 'you',
    at: sent.sentAt,
  };
  const band = (
    b: Pick<AskBand, 'tone' | 'icon' | 'label'> &
      Partial<Pick<AskBand, 'actions'>>,
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
          label: sent.reason
            ? `failed to run: ${sent.reason}`
            : 'failed to run',
          actions: ['retry', 'dismiss'],
        },
        {
          name: 'Failed',
          detail: sent.reason ?? `${name}'s agent hit an error`,
          at: sent.finishedAt,
        }
      );
    case 'rejected':
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
    case 'requested':
      return band({
        tone: 'neutral',
        icon: 'send',
        label: REQUESTED[kind],
      });
  }
}
