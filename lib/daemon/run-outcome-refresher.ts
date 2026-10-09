/**
 * Fills the run outcome cache (lib/runs/outcome.ts) in the background, so
 * listRuns never waits on the forge. Own MRs resolve through the daemon's MR
 * read a few per tick; a reviewed run's posted label comes from its answered
 * post gate and needs no forge call.
 */
import type { GateRow, MrGetData } from "../../packages/rt-client/src/commands.ts";
import { unwrapGateAnswerValue } from "../../packages/rt-client/src/gate-answers.ts";
import { gateOptionLabel, gateOptionValue } from "../../packages/rt-client/src/gate-options.ts";
import { mrRole, parseMrRef, readCachedOutcome, writeCachedOutcome, type CachedOutcome } from "../runs/outcome.ts";

export type MrLookup =
  | { ok: true; state: "opened" | "merged" | "closed"; mergedAt?: number; ci: string | null }
  | { ok: false };

export interface OutcomeRunRow {
  id: string;
  repo: string;
  work_type: string;
  status: string;
  started_at: number;
  ended_at: number | null;
  mr: { value: string; produced_by: string } | null;
}

export interface OutcomeRefresherDeps {
  listRunsForOutcome: () => OutcomeRunRow[];
  /** Aborted when the call outlasts `mrTimeoutMs`; a throw or rejection reads as a failed lookup. */
  getMr: (repoName: string, iid: number, signal: AbortSignal) => Promise<MrLookup>;
  /** The repo index's keys; read at most once per tick. */
  knownRepos: () => ReadonlySet<string>;
  postedFromGates: (runId: string) => string | null;
  emitRunUpdated: (runId: string, repo: string) => void;
  now: () => number;
}

export interface OutcomeRefresherOpts {
  batch?: number;
  openTtlMs?: number;
  maxAgeMs?: number;
  mrTimeoutMs?: number;
}

const DEFAULT_BATCH = 4;
const DEFAULT_OPEN_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_MR_TIMEOUT_MS = 30_000;

const RECOMMENDED_SUFFIX = /\s*\(\s*recommended\s*\)\s*$/i;

/** The question whose pick says what a post gate did, by gate kind. */
const POSTED_QUESTION: Record<string, string> = { "review-post": "outcome", "respond-post": "disposition" };

/** The pick label of the latest answered review-post or respond-post gate among a run's linked gates. */
export function postedFromGateRows(rows: GateRow[]): string | null {
  const answered = rows
    .filter((g) => g.status === "answered" && g.answer && g.kind in POSTED_QUESTION)
    .sort((a, b) => b.answer!.answeredAt - a.answer!.answeredAt);
  const gate = answered[0];
  if (!gate) return null;
  const qid = POSTED_QUESTION[gate.kind]!;
  const raw = gate.answer!.answers[qid];
  const value = raw === undefined ? undefined : unwrapGateAnswerValue(raw);
  if (typeof value !== "string") return null;
  const option = gate.questions.find((q) => q.id === qid)?.options.find((o) => gateOptionValue(o) === value);
  const label = (option === undefined ? value : gateOptionLabel(option)).replace(RECOMMENDED_SUFFIX, "").trim();
  return label || null;
}

/** Maps an `mr:get` result onto the cache's MR shape. A locked MR is still open; any other state is no answer. */
export function lookupFromMrGet(res: { ok: true; data: MrGetData } | { ok: false }): MrLookup {
  if (!res.ok) return { ok: false };
  const { state, mergedAt, pipeline } = res.data.mr;
  const mapped = state === "locked" ? "opened" : state;
  if (mapped !== "opened" && mapped !== "merged" && mapped !== "closed") return { ok: false };
  const out: MrLookup = { ok: true, state: mapped, ci: pipeline?.status ?? null };
  const merged = mergedAt ? Date.parse(mergedAt) : NaN;
  if (Number.isFinite(merged)) out.mergedAt = merged;
  return out;
}

function sameOutcome(a: CachedOutcome | null, b: CachedOutcome): boolean {
  return (
    a !== null &&
    a.iid === b.iid &&
    a.state === b.state &&
    a.mergedAt === b.mergedAt &&
    a.ci === b.ci &&
    a.posted === b.posted
  );
}

export function createOutcomeRefresher(
  deps: OutcomeRefresherDeps,
  opts: OutcomeRefresherOpts = {},
): { tick: () => Promise<void> } {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const openTtlMs = opts.openTtlMs ?? DEFAULT_OPEN_TTL_MS;
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const mrTimeoutMs = opts.mrTimeoutMs ?? DEFAULT_MR_TIMEOUT_MS;
  // A failed lookup keeps its entry as it was, so without this a run the
  // forge cannot answer for would take a batch slot on every tick.
  const failedAt = new Map<string, number>();
  // A review past the max age is asked for its post gate once per process;
  // without this one with no answered post gate would be asked every tick.
  const askedOld = new Set<string>();
  let running = false;

  // A hung forge call must not hold `running` forever: it reads as a failure.
  const getMrBounded = (repo: string, iid: number): Promise<MrLookup> => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<MrLookup>((resolve) => {
      timer = setTimeout(() => {
        abort.abort();
        resolve({ ok: false });
      }, mrTimeoutMs);
    });
    const call = new Promise<MrLookup>((resolve) => resolve(deps.getMr(repo, iid, abort.signal)))
      .catch((): MrLookup => ({ ok: false }));
    return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
  };

  const store = (run: OutcomeRunRow, previous: CachedOutcome | null, next: CachedOutcome): void => {
    writeCachedOutcome(run.id, next);
    if (!sameOutcome(previous, next)) deps.emitRunUpdated(run.id, run.repo);
  };

  const refreshReviewed = (run: OutcomeRunRow, iid: number, now: number): void => {
    const cached = readCachedOutcome(run.id);
    const previous = cached && cached.iid === iid ? cached : null;
    if (previous?.posted != null) return;
    if (now - run.started_at > maxAgeMs) {
      if (askedOld.has(run.id)) return;
      askedOld.add(run.id);
    }
    const posted = deps.postedFromGates(run.id);
    if (posted === null) return;
    // A review never reads the forge, so its entry carries a placeholder MR state.
    store(run, previous, { iid, state: previous?.state ?? "opened", ci: previous?.ci ?? null, posted, checkedAt: now });
  };

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const now = deps.now();
      let repos: ReadonlySet<string> | null = null;
      const due: { run: OutcomeRunRow; iid: number; previous: CachedOutcome | null }[] = [];
      for (const run of deps.listRunsForOutcome()) {
        const ref = run.mr ? parseMrRef(run.mr.value) : null;
        const role = run.mr ? mrRole(run.mr.produced_by, run.work_type) : null;
        if (!ref || !role) continue;
        if (role === "reviewed") {
          refreshReviewed(run, ref.iid, now);
          continue;
        }
        repos ??= deps.knownRepos();
        if (!repos.has(run.repo)) continue;
        const cached = readCachedOutcome(run.id);
        const previous = cached && cached.iid === ref.iid ? cached : null;
        if (previous) {
          if (previous.state !== "opened") continue;
          if (now - previous.checkedAt < openTtlMs) continue;
          if (now - run.started_at > maxAgeMs) continue;
        }
        const failed = failedAt.get(run.id);
        if (failed !== undefined && now - failed < openTtlMs) continue;
        due.push({ run, iid: ref.iid, previous });
      }
      due.sort((a, b) => (a.previous?.checkedAt ?? 0) - (b.previous?.checkedAt ?? 0));
      for (const { run, iid, previous } of due.slice(0, batch)) {
        const mr = await getMrBounded(run.repo, iid);
        if (!mr.ok) {
          failedAt.set(run.id, now);
          continue;
        }
        failedAt.delete(run.id);
        const next: CachedOutcome = { iid, state: mr.state, ci: mr.ci, posted: previous?.posted ?? null, checkedAt: now };
        if (mr.mergedAt !== undefined) next.mergedAt = mr.mergedAt;
        store(run, previous, next);
      }
    } finally {
      running = false;
    }
  };

  return { tick };
}
