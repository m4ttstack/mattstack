import { describe, expect, test } from "bun:test";
import type { GateRow } from "../../../packages/rt-client/src/commands.ts";
import { readCachedOutcome, writeCachedOutcome, type CachedOutcome } from "../../runs/outcome.ts";
import {
  createOutcomeRefresher,
  lookupFromMrGet,
  postedFromGateRows,
  type MrLookup,
  type OutcomeRefresherDeps,
  type OutcomeRunRow,
} from "../run-outcome-refresher.ts";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
let seq = 0;
const freshId = () => `20261008-${String(++seq).padStart(6, "0")}-rfr${Math.random().toString(36).slice(2, 6)}`;

function ownRun(over: Partial<OutcomeRunRow> = {}, iid = 405): OutcomeRunRow {
  return {
    id: freshId(), repo: "remote:gitlab.acme.test%2Facme%2Fweb", work_type: "feature", status: "done",
    started_at: NOW - 60 * MIN, ended_at: NOW - 30 * MIN, mr: { value: String(iid), produced_by: "ship" }, ...over,
  };
}

function reviewedRun(over: Partial<OutcomeRunRow> = {}): OutcomeRunRow {
  return ownRun({ work_type: "review", mr: { value: "!88", produced_by: "review" }, ...over });
}

const opened: MrLookup = { ok: true, state: "opened", ci: "running" };

function harness(runs: OutcomeRunRow[], over: Partial<OutcomeRefresherDeps> = {}) {
  const calls: { repo: string; iid: number }[] = [];
  const emitted: { runId: string; repo: string }[] = [];
  let now = NOW;
  let lookup: MrLookup = opened;
  const deps: OutcomeRefresherDeps = {
    listRunsForOutcome: () => runs,
    getMr: async (repo, iid) => { calls.push({ repo, iid }); return lookup; },
    knownRepos: () => new Set(runs.map((r) => r.repo)),
    postedFromGates: () => null,
    emitRunUpdated: (runId, repo) => emitted.push({ runId, repo }),
    now: () => now,
    ...over,
  };
  return {
    calls, emitted, deps,
    advance: (ms: number) => { now += ms; },
    answer: (next: MrLookup) => { lookup = next; },
  };
}

const cached = (over: Partial<CachedOutcome> = {}): CachedOutcome => ({
  iid: 405, state: "opened", ci: "running", posted: null, checkedAt: NOW - 20 * MIN, ...over,
});

describe("outcome refresher tick", () => {
  test("an uncached own run is resolved and cached", async () => {
    const run = ownRun();
    const h = harness([run]);
    await createOutcomeRefresher(h.deps).tick();
    expect(h.calls).toEqual([{ repo: run.repo, iid: 405 }]);
    expect(readCachedOutcome(run.id)).toEqual({ iid: 405, state: "opened", ci: "running", posted: null, checkedAt: NOW });
    expect(h.emitted).toEqual([{ runId: run.id, repo: run.repo }]);
  });

  test("merged is final: a second tick makes no call", async () => {
    const run = ownRun();
    const h = harness([run]);
    h.answer({ ok: true, state: "merged", mergedAt: NOW - MIN, ci: "success" });
    const refresher = createOutcomeRefresher(h.deps);
    await refresher.tick();
    h.advance(60 * MIN);
    await refresher.tick();
    expect(h.calls).toHaveLength(1);
    expect(readCachedOutcome(run.id)).toMatchObject({ state: "merged", mergedAt: NOW - MIN, ci: "success" });
  });

  test("closed is final too", async () => {
    const run = ownRun();
    writeCachedOutcome(run.id, cached({ state: "closed", checkedAt: NOW - 90 * MIN }));
    const h = harness([run]);
    await createOutcomeRefresher(h.deps).tick();
    expect(h.calls).toHaveLength(0);
  });

  test("an opened entry refreshes only after the TTL", async () => {
    const run = ownRun();
    const h = harness([run]);
    const refresher = createOutcomeRefresher(h.deps);
    await refresher.tick();
    h.advance(9 * MIN);
    await refresher.tick();
    expect(h.calls).toHaveLength(1);
    h.advance(2 * MIN);
    await refresher.tick();
    expect(h.calls).toHaveLength(2);
  });

  test("a refresh that changes nothing writes a new checkedAt and emits nothing", async () => {
    const run = ownRun();
    const h = harness([run]);
    const refresher = createOutcomeRefresher(h.deps);
    await refresher.tick();
    h.advance(11 * MIN);
    await refresher.tick();
    expect(h.emitted).toHaveLength(1);
    expect(readCachedOutcome(run.id)?.checkedAt).toBe(NOW + 11 * MIN);
  });

  test("a change emits run-updated", async () => {
    const run = ownRun();
    const h = harness([run]);
    const refresher = createOutcomeRefresher(h.deps);
    await refresher.tick();
    h.answer({ ok: true, state: "merged", mergedAt: NOW, ci: "success" });
    h.advance(11 * MIN);
    await refresher.tick();
    expect(h.emitted).toHaveLength(2);
  });

  test("a run older than the max age is not refreshed once cached, but is filled when uncached", async () => {
    const old = ownRun({ started_at: NOW - 8 * 24 * 60 * MIN });
    const cachedOld = ownRun({ started_at: NOW - 8 * 24 * 60 * MIN });
    writeCachedOutcome(cachedOld.id, cached());
    const h = harness([old, cachedOld]);
    await createOutcomeRefresher(h.deps).tick();
    expect(h.calls).toHaveLength(1);
    expect(readCachedOutcome(old.id)).not.toBeNull();
    expect(readCachedOutcome(cachedOld.id)?.checkedAt).toBe(NOW - 20 * MIN);
  });

  test("at most batch forge calls per tick, oldest checkedAt first (uncached before cached)", async () => {
    const uncached = [ownRun(), ownRun()];
    const older = ownRun();
    const newer = ownRun();
    writeCachedOutcome(older.id, cached({ checkedAt: NOW - 30 * MIN }));
    writeCachedOutcome(newer.id, cached({ checkedAt: NOW - 20 * MIN }));
    const h = harness([newer, older, ...uncached]);
    const refresher = createOutcomeRefresher(h.deps, { batch: 3 });
    await refresher.tick();
    expect(h.calls).toHaveLength(3);
    expect(readCachedOutcome(uncached[0]!.id)?.checkedAt).toBe(NOW);
    expect(readCachedOutcome(uncached[1]!.id)?.checkedAt).toBe(NOW);
    expect(readCachedOutcome(older.id)?.checkedAt).toBe(NOW);
    expect(readCachedOutcome(newer.id)?.checkedAt).toBe(NOW - 20 * MIN);
    await refresher.tick();
    expect(h.calls).toHaveLength(4);
  });

  test("an unknown repo makes no call and leaves no entry", async () => {
    const run = ownRun();
    const h = harness([run], { knownRepos: () => new Set() });
    await createOutcomeRefresher(h.deps).tick();
    expect(h.calls).toHaveLength(0);
    expect(readCachedOutcome(run.id)).toBeNull();
    expect(h.emitted).toHaveLength(0);
  });

  test("the repo index is read once per tick, whatever the number of runs", async () => {
    const runs = [ownRun({}, 1), ownRun({}, 2), ownRun({}, 3)];
    let reads = 0;
    const h = harness(runs, { knownRepos: () => { reads++; return new Set(runs.map((r) => r.repo)); } });
    await createOutcomeRefresher(h.deps).tick();
    expect(reads).toBe(1);
    expect(h.calls).toHaveLength(3);
  });

  test("a forge call that never answers times out as a failure and frees the next tick", async () => {
    const run = ownRun();
    const h = harness([run], { getMr: () => new Promise<MrLookup>(() => {}) });
    const refresher = createOutcomeRefresher(h.deps, { mrTimeoutMs: 5 });
    await refresher.tick();
    expect(readCachedOutcome(run.id)).toBeNull();
    h.deps.getMr = async () => opened;
    h.advance(11 * MIN);
    await refresher.tick();
    expect(readCachedOutcome(run.id)).toMatchObject({ state: "opened", checkedAt: NOW + 11 * MIN });
  });

  test("a timed-out forge call is told to stop through its signal", async () => {
    const run = ownRun();
    let seen: AbortSignal | undefined;
    const h = harness([run], { getMr: (_r, _i, signal) => { seen = signal; return new Promise<MrLookup>(() => {}); } });
    await createOutcomeRefresher(h.deps, { mrTimeoutMs: 5 }).tick();
    expect(seen?.aborted).toBe(true);
  });

  test("a forge call that throws, even synchronously, reads as a failure and frees the next tick", async () => {
    const run = ownRun();
    const h = harness([run], { getMr: () => { throw new Error("boom"); } });
    const refresher = createOutcomeRefresher(h.deps, { mrTimeoutMs: 60_000 });
    await refresher.tick();
    expect(readCachedOutcome(run.id)).toBeNull();
    h.deps.getMr = async () => opened;
    h.advance(11 * MIN);
    await refresher.tick();
    expect(readCachedOutcome(run.id)).toMatchObject({ state: "opened" });
  });

  test("a failed call keeps the old entry, emits nothing and is not retried before the TTL", async () => {
    const run = ownRun();
    const before = cached({ checkedAt: NOW - 20 * MIN });
    writeCachedOutcome(run.id, before);
    const h = harness([run]);
    h.answer({ ok: false });
    const refresher = createOutcomeRefresher(h.deps);
    await refresher.tick();
    await refresher.tick();
    expect(h.calls).toHaveLength(1);
    expect(readCachedOutcome(run.id)).toEqual(before);
    expect(h.emitted).toHaveLength(0);
    h.advance(11 * MIN);
    await refresher.tick();
    expect(h.calls).toHaveLength(2);
  });

  test("a failing run does not starve the others of batch slots", async () => {
    const broken = ownRun({}, 1);
    const fine = ownRun({}, 2);
    const h = harness([broken, fine], {
      getMr: async (_repo, iid) => (iid === 1 ? { ok: false } : opened),
    });
    const refresher = createOutcomeRefresher(h.deps, { batch: 1 });
    await refresher.tick();
    await refresher.tick();
    expect(readCachedOutcome(fine.id)).not.toBeNull();
  });

  test("a reviewed run gets its posted label from the gates and never calls the forge", async () => {
    const run = reviewedRun();
    const h = harness([run], { postedFromGates: () => "Comment" });
    await createOutcomeRefresher(h.deps).tick();
    expect(h.calls).toHaveLength(0);
    expect(readCachedOutcome(run.id)).toMatchObject({ iid: 88, posted: "Comment" });
    expect(h.emitted).toEqual([{ runId: run.id, repo: run.repo }]);
  });

  test("a reviewed run with a posted label cached is left alone; without a gate answer nothing is written", async () => {
    const posted = reviewedRun();
    writeCachedOutcome(posted.id, cached({ iid: 88, posted: "Approve" }));
    const waiting = reviewedRun();
    let asked = 0;
    const h = harness([posted, waiting], { postedFromGates: () => { asked++; return null; } });
    await createOutcomeRefresher(h.deps).tick();
    expect(asked).toBe(1);
    expect(readCachedOutcome(posted.id)?.posted).toBe("Approve");
    expect(readCachedOutcome(waiting.id)).toBeNull();
    expect(h.emitted).toHaveLength(0);
  });

  test("a review past the max age with no answered post gate is asked once, not every tick", async () => {
    const old = reviewedRun({ started_at: NOW - 8 * 24 * 60 * MIN });
    const recent = reviewedRun();
    const asked: string[] = [];
    const h = harness([old, recent], { postedFromGates: (id) => { asked.push(id); return null; } });
    const refresher = createOutcomeRefresher(h.deps);
    await refresher.tick();
    await refresher.tick();
    expect(asked.filter((id) => id === old.id)).toHaveLength(1);
    expect(asked.filter((id) => id === recent.id)).toHaveLength(2);
  });

  test("runs without a parsable MR or a known role are skipped", async () => {
    const runs = [
      ownRun({ mr: null }),
      ownRun({ mr: { value: "not an mr", produced_by: "ship" } }),
      ownRun({ mr: { value: "12", produced_by: "implement" } }),
      ownRun({ work_type: "review", mr: { value: "12", produced_by: "ship" } }),
    ];
    const h = harness(runs);
    await createOutcomeRefresher(h.deps).tick();
    expect(h.calls).toHaveLength(0);
  });

  test("a tick that starts while another is running does nothing", async () => {
    const run = ownRun();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = harness([run], { getMr: async () => { await gate; return opened; } });
    const refresher = createOutcomeRefresher(h.deps);
    const first = refresher.tick();
    await refresher.tick();
    release();
    await first;
    expect(h.emitted).toHaveLength(1);
  });
});

function gate(kind: string, qid: string, answer: unknown, answeredAt: number, options: GateRow["questions"][number]["options"]): GateRow {
  return {
    id: `g-${answeredAt}`, subject: "mr:https://gitlab.acme.test/acme/web/-/merge_requests/88", kind,
    questions: [{ id: qid, label: "Verdict", multi: false, options }],
    meta: null, status: "answered",
    answer: { answers: { [qid]: answer as string }, by: "console", answeredAt },
    openedAt: answeredAt - 10, parkedAt: null, closedAt: null, closedReason: null, supersededBy: null,
    agent: null, pane: null, nudge: null, delivery: null, released: false, consumedAt: null, owner: null, escalatedAt: null,
  };
}

const VERDICT = [{ value: "comment", label: "Comment (Recommended)" }, { value: "approve", label: "Approve" }];

describe("postedFromGateRows", () => {
  test("a review-post gate reads the outcome pick label, without the recommended suffix", () => {
    expect(postedFromGateRows([gate("review-post", "outcome", "comment", 10, VERDICT)])).toBe("Comment");
    expect(postedFromGateRows([gate("review-post", "outcome", "approve", 10, VERDICT)])).toBe("Approve");
  });

  test("a respond-post gate reads the disposition pick label", () => {
    const options = [{ value: "reply", label: "Reply only" }, { value: "reply-resolve", label: "Reply and resolve" }];
    expect(postedFromGateRows([gate("respond-post", "disposition", "reply-resolve", 10, options)])).toBe("Reply and resolve");
  });

  test("the latest answered post gate wins", () => {
    const rows = [
      gate("review-post", "outcome", "comment", 10, VERDICT),
      gate("review-post", "outcome", "approve", 30, VERDICT),
      gate("review-post", "outcome", "comment", 20, VERDICT),
    ];
    expect(postedFromGateRows(rows)).toBe("Approve");
  });

  test("an unwrapped {value, note} answer and a bare string option are both read", () => {
    expect(postedFromGateRows([gate("review-post", "outcome", { value: "approve", note: "lgtm" }, 10, VERDICT)])).toBe("Approve");
    expect(postedFromGateRows([gate("review-post", "outcome", "comment", 10, ["comment", "approve"])])).toBe("comment");
  });

  test("open gates, other kinds and a missing question read null", () => {
    const open: GateRow = { ...gate("review-post", "outcome", "comment", 10, VERDICT), status: "open", answer: null };
    expect(postedFromGateRows([open])).toBeNull();
    expect(postedFromGateRows([gate("run-stage", "outcome", "comment", 10, VERDICT)])).toBeNull();
    expect(postedFromGateRows([gate("review-post", "next", "proceed", 10, ["proceed"])])).toBeNull();
    expect(postedFromGateRows([])).toBeNull();
  });
});

describe("lookupFromMrGet", () => {
  const mrOf = (over: Record<string, unknown>) =>
    ({ ok: true, data: { mr: { state: "opened", mergedAt: null, pipeline: null, ...over }, fetchedAt: 1 } }) as never;

  test("maps state, pipeline status and the merge time", () => {
    expect(lookupFromMrGet(mrOf({ state: "merged", mergedAt: "2026-10-01T12:00:00.000Z", pipeline: { status: "success" } })))
      .toEqual({ ok: true, state: "merged", mergedAt: Date.parse("2026-10-01T12:00:00.000Z"), ci: "success" });
    expect(lookupFromMrGet(mrOf({ state: "opened" }))).toEqual({ ok: true, state: "opened", ci: null });
  });

  test("a locked MR is open; an unknown state or a failed read is no answer", () => {
    expect(lookupFromMrGet(mrOf({ state: "locked" }))).toMatchObject({ ok: true, state: "opened" });
    expect(lookupFromMrGet(mrOf({ state: "draft" }))).toEqual({ ok: false });
    expect(lookupFromMrGet({ ok: false })).toEqual({ ok: false });
  });
});
