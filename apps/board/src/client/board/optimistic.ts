import type {
  BoardMRWithReview,
  DoctorInfo,
  RespondInfo,
  ReviewInfo,
} from '../types.ts';
import { DOCTOR_ACTIVE, RESPOND_ACTIVE } from './format.ts';

/** The three axes a board action can optimistically claim before the server's
    state file round-trips back via /data.json. */
export type Axis = 'review' | 'respond' | 'doctor';

/** What a claim knew of its lane when it was made: the lane the server had
    then, and when the click landed. */
interface Claim {
  prior: string | null;
  at: number;
}

export interface OptimisticState {
  review: Record<string, ReviewInfo>;
  respond: Record<string, RespondInfo>;
  doctor: Record<string, DoctorInfo>;
  claims: Record<Axis, Record<string, Claim>>;
}

export const EMPTY_OPTIMISTIC: OptimisticState = {
  review: {},
  respond: {},
  doctor: {},
  claims: { review: {}, respond: {}, doctor: {} },
};

/** How long a claim may stand over a server lane that has not moved. A launch
    the server took up writes its lane within seconds; this only ends a claim
    whose launch never reached the lane. */
export const OPTIMISTIC_HOLD_MS = 2 * 60_000;

/** A lane as the server last wrote it. A claim made over a finished run must
    not give way to that same run on the next poll, only to a newer write;
    comparing the server's own values keeps a remote board's clock out of it. */
export function laneMark(
  lane: { status: string; updatedAt?: number } | undefined | null
): string | null {
  return lane ? `${lane.status}@${lane.updatedAt ?? ''}` : null;
}

/** Whether the server has written this lane since the claim was made. */
function caughtUp(
  s: OptimisticState,
  axis: Axis,
  mr: BoardMRWithReview
): boolean {
  const lane = mr[axis];
  if (!lane || !mr.webUrl) return false;
  const claim = s.claims[axis][mr.webUrl];
  return !claim || laneMark(lane) !== claim.prior;
}

/** Review's "still going" set is inline (not exported from format.ts) since
    it's only two literals and format.ts has no ReviewStatus active-set today. */
const REVIEW_ACTIVE = new Set(['queued', 'reviewing']);

/** Mark one axis/url queued the instant a launch is requested, before the
    server's state file round-trips back via /data.json. */
export function setQueued(
  s: OptimisticState,
  axis: Axis,
  url: string,
  status: 'queued' | 'syncing' = 'queued',
  prior: string | null = null,
  now: number = Date.now()
): OptimisticState {
  return {
    ...s,
    [axis]: { ...s[axis], [url]: { status } },
    claims: {
      ...s.claims,
      [axis]: { ...s.claims[axis], [url]: { prior, at: now } },
    },
  };
}

/** Undo an optimistic claim -- a launch request that failed or errored before
    the server ever recorded it. */
export function rollback(
  s: OptimisticState,
  axis: Axis,
  url: string
): OptimisticState {
  if (!(url in s[axis])) return s;
  const next = { ...s[axis] };
  delete next[url];
  const claims = { ...s.claims[axis] };
  delete claims[url];
  return { ...s, [axis]: next, claims: { ...s.claims, [axis]: claims } };
}

/** Drop optimistic entries once the server has written that axis since the
    claim, or the claim has outlived OPTIMISTIC_HOLD_MS. Returns the SAME
    reference when nothing changed, so a caller that re-runs this every poll
    doesn't loop an effect keyed on the result. */
export function clearServerTruth(
  s: OptimisticState,
  mrs: BoardMRWithReview[],
  now: number = Date.now()
): OptimisticState {
  let next = s;
  (['review', 'respond', 'doctor'] as const).forEach(axis => {
    for (const mr of mrs) {
      const url = mr.webUrl;
      if (!url || !next[axis][url]) continue;
      const claim = next.claims[axis][url];
      const lapsed = !!claim && now - claim.at > OPTIMISTIC_HOLD_MS;
      if (caughtUp(next, axis, mr) || lapsed) next = rollback(next, axis, url);
    }
  });
  return next;
}

/** The fast-poll predicate: is anything -- optimistic or server-reported --
    still mid-flight on any axis. */
export function anyActive(
  s: OptimisticState,
  mrs: BoardMRWithReview[]
): boolean {
  const reviewActive =
    Object.values(s.review).some(r => REVIEW_ACTIVE.has(r.status)) ||
    mrs.some(mr => {
      const st = mr.review?.status;
      return !!st && REVIEW_ACTIVE.has(st);
    });
  if (reviewActive) return true;

  const respondActive =
    Object.values(s.respond).some(r => RESPOND_ACTIVE.has(r.status)) ||
    mrs.some(mr => {
      const st = mr.respond?.status;
      return !!st && RESPOND_ACTIVE.has(st);
    });
  if (respondActive) return true;

  const doctorActive =
    Object.values(s.doctor).some(r => DOCTOR_ACTIVE.has(r.status)) ||
    mrs.some(mr => {
      const st = mr.doctor?.status;
      return !!st && DOCTOR_ACTIVE.has(st);
    });
  return doctorActive;
}

/** A claim shows until the server writes its lane; after that, server state
    wins, per axis. */
export function overlay(
  mrs: BoardMRWithReview[],
  s: OptimisticState
): BoardMRWithReview[] {
  return mrs.map(mr => {
    const optRev = mr.webUrl ? s.review[mr.webUrl] : undefined;
    const optResp = mr.webUrl ? s.respond[mr.webUrl] : undefined;
    const optDoc = mr.webUrl ? s.doctor[mr.webUrl] : undefined;
    let next: BoardMRWithReview = mr;
    // A claim stands until the server has written that lane since the click;
    // an older run's state on the lane does not outrank it.
    if (optRev && !caughtUp(s, 'review', mr))
      next = { ...next, review: optRev };
    if (optResp && !caughtUp(s, 'respond', mr))
      next = { ...next, respond: optResp };
    if (optDoc && !caughtUp(s, 'doctor', mr))
      next = { ...next, doctor: optDoc };
    return next;
  });
}

/** How long a fired merge may read as merging while GitLab still reports the
    MR open with no merge error (a merge train, a stalled sync). */
export const MERGE_HOLD_MS = 3 * 60_000;

/** A fired merge, by MR url, with when it was fired. */
export type Merging = ReadonlyMap<string, number>;

/** Milliseconds until the earliest held merge passes MERGE_HOLD_MS, so a
    hold lapses on time even when no fresh load arrives; null when none. */
export function nextMergeLapse(merging: Merging, now: number): number | null {
  if (merging.size === 0) return null;
  const earliest = Math.min(...merging.values());
  return Math.max(0, earliest + MERGE_HOLD_MS - now + 1);
}

/** A merge the board fired reads as GitLab's own merging state on that row,
    through the seconds GitLab and rt's sync still report the MR open and
    mergeable. */
export function overlayMerging(
  mrs: BoardMRWithReview[],
  merging: Merging
): BoardMRWithReview[] {
  if (merging.size === 0) return mrs;
  return mrs.map(mr =>
    mr.webUrl && merging.has(mr.webUrl)
      ? { ...mr, mergeButton: { ...mr.mergeButton, loading: true } }
      : mr
  );
}

/** Let go of a fired merge once its MR has left the board, GitLab has
    recorded a merge error on it, or it has been held MERGE_HOLD_MS. Returns
    the SAME reference when nothing changed, for the same reason as
    clearServerTruth. */
export function settleMerging(
  merging: Merging,
  mrs: BoardMRWithReview[],
  now: number
): Merging {
  if (merging.size === 0) return merging;
  const open = new Set(
    mrs
      .filter(mr => mr.webUrl && !mr.blockers.hasMergeError)
      .map(mr => mr.webUrl)
  );
  const next = new Map(
    [...merging].filter(
      ([url, firedAt]) => open.has(url) && now - firedAt <= MERGE_HOLD_MS
    )
  );
  return next.size === merging.size ? merging : next;
}
