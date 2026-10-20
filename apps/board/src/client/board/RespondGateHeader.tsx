import type { BoardMRWithReview } from '../types.ts';
import type { PlanCtx, PostCtx } from './gate-ctx.ts';
import { onGitHub } from './MrLinks.tsx';

export interface HeaderChip {
  key: string;
  text: string;
  hue: 'grey' | 'amber' | 'green';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `posting`, when given, replaces a post gate's offered reply count with
    the number its submit will post, so the rail agrees with the sheet.
    `mix` names a plan gate's items the way its heading does. */
export function headerChips(
  ctx: PlanCtx | PostCtx,
  posting?: number,
  mix: ItemMix = 'threads'
): HeaderChip[] {
  const chips: HeaderChip[] = [];
  if (ctx.shape === 'plan@1') {
    const { total, blocking } = ctx.threads;
    chips.push({
      key: 'threads',
      text: `${total} ${itemNoun(total, mix)}`,
      hue: 'grey',
    });
    chips.push(
      blocking > 0
        ? { key: 'blocking', text: `${blocking} blocking`, hue: 'amber' }
        : { key: 'blocking', text: 'all non-blocking', hue: 'grey' }
    );
  } else {
    chips.push({
      key: 'replies',
      text: plural(posting ?? ctx.replies, 'reply', 'replies'),
      hue: 'grey',
    });
    if (ctx.fixes.length >= 3)
      chips.push({
        key: 'fixes',
        text: `${ctx.fixes.length} fixes pushed`,
        hue: 'green',
      });
    else
      ctx.fixes.forEach((fix, i) =>
        chips.push({
          key: `fix-${i}`,
          text: `fix pushed · ${fix.sha}`,
          hue: 'green',
        })
      );
  }
  return chips;
}

/** The round a gate shows. Given the person's response round, the
    wrapper's own round only shows as the revises past it. */
export function gateRounds(
  ctx: PlanCtx | PostCtx,
  responseRound?: number
): { round?: number; revise?: number } {
  if (responseRound === undefined) return { round: ctx.round };
  const revise =
    ctx.round !== undefined && ctx.round > responseRound
      ? ctx.round - responseRound
      : undefined;
  return { round: responseRound >= 2 ? responseRound : undefined, revise };
}

/** The round and the adjudication, the context's prose facts; they read as
    a meta line rather than chips. */
export function headerMeta(
  ctx: PlanCtx | PostCtx,
  responseRound?: number
): string[] {
  const { round, revise } = gateRounds(ctx, responseRound);
  return [
    round !== undefined ? `round ${round}` : undefined,
    revise !== undefined ? `revise ${revise}` : undefined,
    ctx.adjudication,
  ].filter((m): m is string => Boolean(m));
}

/** The reviewer's full name for a gate's reviewer handle: the board's team
    roster first, then the MR's assigned reviewers and approvers, else the
    handle itself. */
export function reviewerName(
  handle: string,
  mr?: BoardMRWithReview,
  people?: ReadonlyMap<string, string>
): string {
  const same = (u: { username: string }) => u.username === handle;
  return (
    people?.get(handle) ??
    mr?.reviews?.reviewers?.find(same)?.name ??
    mr?.reviews?.approvedBy?.find(same)?.name ??
    handle
  );
}

/** A person's full name for a handle: the team roster first, then the MR's
    author, then its assigned reviewers and approvers, then the people it
    can respond to, else the handle. */
export function personName(
  handle: string,
  mr?: BoardMRWithReview,
  people?: ReadonlyMap<string, string>
): string {
  const known = reviewerName(handle, mr, people);
  return (
    people?.get(handle) ??
    (mr?.author?.username === handle
      ? mr.author.name || undefined
      : undefined) ??
    (known !== handle ? known : undefined) ??
    mr?.respondTargets?.find(t => t.username === handle)?.name ??
    handle
  );
}

/** The person a respond gate answers: the live respond run's person when
    the gate opened during that run, else the gate's own reviewer (a parked
    gate from an earlier run, or a run launched without a person). */
export function respondPerson(
  ctx: PlanCtx | PostCtx,
  openedAt: number,
  mr?: BoardMRWithReview
): string {
  const run = mr?.respond;
  return run?.person && openedAt >= (run.startedAt ?? 0)
    ? run.person
    : ctx.reviewer;
}

/** The label a respond gate gives a plain Overview comment's question. */
export const OVERVIEW_LABEL = 'Overview comment';

/** Whether a respond gate's items are review threads, Overview comments,
    or both, judged by their question labels. */
export type ItemMix = 'threads' | 'comments' | 'mixed';

export function itemMix(labels: readonly string[]): ItemMix {
  const comments = labels.filter(l => l === OVERVIEW_LABEL).length;
  if (comments === 0) return 'threads';
  return comments === labels.length ? 'comments' : 'mixed';
}

export function itemNoun(n: number, mix: ItemMix): string {
  if (mix === 'mixed') return 'threads and comments';
  const one = mix === 'comments' ? 'comment' : 'thread';
  return n === 1 ? one : `${one}s`;
}

/** The decision context's verb: a person who left only Overview comments
    commented; anyone with a review thread reviewed. */
export function leadVerb(mix: ItemMix): string {
  return mix === 'comments' ? 'commented on' : 'reviewed';
}

/** `!<n>` from an `mr:<url>` subject: the object line's stand-in when the
    board has no row for the MR, so the card never waits on the join. */
export function subjectRef(subject: string): string {
  const m = subject.startsWith('mr:') ? /(\d+)\/?$/.exec(subject) : null;
  if (!m) return subject;
  return `${onGitHub(undefined, subject) ? '#' : '!'}${m[1]}`;
}

/** A respond context's prose facts and chips, under its reviewer line in
    the rail. */
export function RespondCtxFacts({
  ctx,
  posting,
  responseRound,
  mix,
}: {
  ctx: PlanCtx | PostCtx;
  /** How the gate's items read; see `itemMix`. */
  mix?: ItemMix;
  /** The person's response round off the MR's respond lane; see
      `headerMeta`. */
  responseRound?: number;
  /** A post gate's reply count as its submit will post it; see
      `headerChips`. */
  posting?: number;
}) {
  const meta = headerMeta(ctx, responseRound);
  return (
    <>
      {meta.length > 0 && (
        <p className="tui-sheet-context-meta">{meta.join(' · ')}</p>
      )}
      <div className="tui-respond-chips">
        {headerChips(ctx, posting, mix).map(chip => (
          <span
            key={chip.key}
            className="tui-respond-chip"
            data-hue={chip.hue}
            data-chip={chip.key}
          >
            {chip.text}
          </span>
        ))}
      </div>
    </>
  );
}
