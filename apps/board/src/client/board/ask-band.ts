/** The band at the foot of a row that shows this board's own ask of a
    teammate's agent: where it stands and what can be done about it. Kept off
    the status line and its "+N active" count, since the work is remote. */
import type { SentNudgeInfo } from '../types.ts';
import { ago } from './format.ts';

export type AskTone = 'neutral' | 'work' | 'ok' | 'bad' | 'warn';
export type AskAction = 'retry' | 'dismiss';

export interface AskBand {
  tone: AskTone;
  /** A lucide icon name. */
  icon: string;
  who: string;
  label: string;
  age?: string;
  actions: AskAction[];
  /** What the row knows of the ask's life, oldest first. */
  trail: string[];
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

const since = (ms: number | undefined, now: number): string | undefined =>
  ms ? ago(new Date(ms).toISOString(), now) : undefined;

const ageWord = (ms: number | undefined, now: number): string | undefined => {
  const a = since(ms, now);
  return a ? `${a} ago` : undefined;
};

function doneLabel(kind: Kind, outcome?: string): string {
  const base = DONE[kind];
  if (outcome === 'approve') return `${base}: approved`;
  if (outcome === 'comment') return `${base}: comments`;
  return base;
}

export function askBandModel(sent: SentNudgeInfo, now: number): AskBand {
  const kind: Kind = sent.kind ?? 're-review';
  const who = `${sent.reviewer}'s agent`;
  const requested = ageWord(sent.sentAt, now);
  const trail = [requested ? `requested ${requested}` : 'requested'];
  const band = (
    b: Pick<AskBand, 'tone' | 'icon' | 'label' | 'age'> &
      Partial<Pick<AskBand, 'actions'>>,
    ...more: string[]
  ): AskBand => ({
    who,
    actions: [],
    ...b,
    trail: [...trail, ...more],
  });

  switch (sent.display) {
    case 'confirmed':
    case 'launched': {
      const started = ageWord(sent.resolvedAt, now);
      return band(
        {
          tone: 'work',
          icon: 'loader',
          label: RUNNING[kind],
          age: since(sent.resolvedAt, now),
        },
        started ? `started ${started}` : 'started'
      );
    }
    case 'done': {
      const label = doneLabel(kind, sent.outcome);
      const finished = ageWord(sent.finishedAt, now);
      return band(
        {
          tone: 'ok',
          icon: 'check',
          label,
          age: finished,
          actions: ['dismiss'],
        },
        `finished ${finished ?? ''}: ${label}`.replace(' :', ':')
      );
    }
    case 'failed': {
      const finished = ageWord(sent.finishedAt, now);
      return band(
        {
          tone: 'bad',
          icon: 'triangle-alert',
          label: sent.reason ? `failed to run: ${sent.reason}` : 'failed to run',
          age: finished,
          actions: ['retry', 'dismiss'],
        },
        finished ? `failed ${finished}` : 'failed'
      );
    }
    case 'rejected':
      return band(
        {
          tone: 'bad',
          icon: 'ban',
          label: sent.reason ? `declined: ${sent.reason}` : 'declined',
          age: since(sent.sentAt, now),
          actions: ['retry', 'dismiss'],
        },
        'declined'
      );
    case 'expired':
    case 'no-response':
      return band(
        {
          tone: 'warn',
          icon: 'hourglass',
          label: 'no answer',
          age: since(sent.sentAt, now),
          actions: ['retry', 'dismiss'],
        },
        'no answer'
      );
    case 'requested':
      return band({
        tone: 'neutral',
        icon: 'send',
        label: REQUESTED[kind],
        age: since(sent.sentAt, now),
      });
  }
}
