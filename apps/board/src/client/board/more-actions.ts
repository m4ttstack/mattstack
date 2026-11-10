/** What a "+N more" line may do when clicked. Every line there is clickable,
    so the actions that start an agent get guards the row line never needed:
    no launch beside another agent at work on the MR, and no launch label on a
    click the server would only turn into a focus. */

import type { BoardMRWithReview } from '../types.ts';
import {
  DOCTOR_ACTIVE,
  doctorInterrupted,
  laneInterrupted,
  RESPOND_ACTIVE,
} from './format.ts';
import type { Candidate, Verb, VerbKind } from './row-status.ts';

export type Lane = 'review' | 'respond' | 'doctor';

/** The lane an agent verb launches, re-runs or jumps into. The color of the
    verb is the lane, so a reader knows which agent a click starts before
    reading the word; `resume`, `redo` and `focus` name theirs on the verb. */
const AGENT_LANE: Partial<Record<VerbKind, Lane>> = {
  'launch-review': 'review',
  're-review': 'review',
  'launch-respond': 'respond',
  'restart-respond': 'respond',
  'resume-respond': 'respond',
  'call-doctor': 'doctor',
};

export function laneOf(verb: Verb): Lane | undefined {
  if (verb.kind === 'resume' || verb.kind === 'redo' || verb.kind === 'focus')
    return verb.domain;
  return AGENT_LANE[verb.kind];
}

/** Verbs that start an agent pane rather than look at or tidy one. */
const LAUNCHES = new Set<VerbKind>([
  'launch-review',
  're-review',
  'launch-respond',
  'restart-respond',
  'resume-respond',
  'call-doctor',
  'redo',
  'resume',
]);

const REVIEW_ACTIVE = new Set(['queued', 'reviewing']);

/** Lanes with an agent at work on the MR. A lane whose pane died is not at
    work: its redo is how it gets going again. */
export function workingLanes(mr: BoardMRWithReview): Set<Lane> {
  const busy = new Set<Lane>();
  if (
    mr.review &&
    REVIEW_ACTIVE.has(mr.review.status) &&
    !laneInterrupted(mr.orphan, mr.review)
  )
    busy.add('review');
  if (
    mr.respond &&
    RESPOND_ACTIVE.has(mr.respond.status) &&
    !laneInterrupted(mr.orphan, mr.respond)
  )
    busy.add('respond');
  if (
    mr.doctor &&
    DOCTOR_ACTIVE.has(mr.doctor.status) &&
    !doctorInterrupted(mr)
  )
    busy.add('doctor');
  return busy;
}

const SOURCE_LANE: Record<string, Lane> = {
  Review: 'review',
  Respond: 'respond',
  Doctor: 'doctor',
};

export interface MoreAction {
  verb: Verb;
  lane?: Lane;
  /** Starts an agent pane, so only a click on the action itself runs it. */
  launches: boolean;
}

/** The one action a "+N more" line offers, or null when it offers none.
    Merge needs the row line's two-click arm, so it never shows here. */
export function moreAction(
  line: Candidate,
  mr: BoardMRWithReview
): MoreAction | null {
  const verb = line.verbs.find(v => v.kind !== 'merge');
  if (!verb) return null;
  const lane = laneOf(verb);
  if (!LAUNCHES.has(verb.kind)) return { verb, ...(lane ? { lane } : {}), launches: false };
  const busy = workingLanes(mr);
  // The server's dedup turns a launch on a running lane into a focus. Said
  // as "focus" only on that lane's own line: on another source's line it
  // would jump to an agent the line does not name.
  if (lane && busy.has(lane))
    return SOURCE_LANE[line.source ?? ''] === lane
      ? {
          verb: { kind: 'focus', label: 'focus', domain: lane },
          lane,
          launches: false,
        }
      : null;
  // Two agents on one branch race each other's pushes.
  if (busy.size > 0) return null;
  return { verb, ...(lane ? { lane } : {}), launches: true };
}

/** A line's identity across polls, so the list can hold its order. */
export const moreKey = (line: Candidate): string =>
  `${line.source ?? ''}:${line.word}`;

/** The lines in the order they had when the list opened; lines that arrived
    since go last, lines that resolved drop out. */
export function heldOrder(
  lines: readonly Candidate[],
  order: readonly string[] | null
): Candidate[] {
  if (!order) return [...lines];
  const rank = new Map(order.map((k, i) => [k, i]));
  const at = (l: Candidate) => rank.get(moreKey(l)) ?? order.length;
  return [...lines].sort((a, b) => at(a) - at(b));
}
