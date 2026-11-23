import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRunsHandlers } from "../handlers/runs.ts";
import { root, seedRun } from "../../runs/__tests__/fixtures.ts";
import { runsGetRoute, runsListRoute } from "../../../packages/rt-client/src/daemon-api/index.ts";

afterEach(() => { delete process.env.RT_RUNS_ROOT; });

const log = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } as any;
const noEmit = () => {};

describe("runs handlers", () => {
  test("runs:list scopes by repo; runs:get resolves with and without repo", async () => {
    const dir = root();
    seedRun(dir, "remote:alpha", "20260821-010101-aaaa", 1000);
    const h = createRunsHandlers({ log } as any, noEmit);
    const listHandler = h["runs:list"] as any;
    const getHandler = h["runs:get"] as any;
    const list = await listHandler({ repo: "remote:alpha" });
    expect(list.ok).toBe(true);
    expect((list as any).data.runs).toHaveLength(1);
    const byBoth = await getHandler({ repo: "remote:alpha", runId: "20260821-010101-aaaa" });
    expect((byBoth as any).data.run.repo).toBe("remote:alpha");
    const byId = await getHandler({ runId: "20260821-010101-aaaa" });
    expect((byId as any).data.run.repo).toBe("remote:alpha");
    expect(runsListRoute.success.safeParse(list).error).toBeUndefined();
    expect(runsGetRoute.success.safeParse(byId).error).toBeUndefined();
    const missing = await getHandler({ runId: "nope" });
    expect(missing.ok).toBe(false);
  });

  test("runs:list and runs:get read a run at an open kit gate as waiting, not stale", async () => {
    const dir = root();
    const long = Date.now() - 2 * 60 * 60_000;
    const fields = [{ key: "claude-session", value: "sess-kit", at: long }];
    seedRun(dir, "remote:alpha", "20260821-010101-kitg", long, 2, { fields });
    const plain = createRunsHandlers({ log } as any, noEmit);
    expect(((await (plain["runs:list"] as any)({})) as any).data.runs[0].attention.reason).toBe("stale");

    const h = createRunsHandlers({ log } as any, noEmit, { openKitGate: (session) => (session === "sess-kit" ? "gate-1" : null) });
    const list = (await (h["runs:list"] as any)({})) as any;
    expect(list.data.runs[0].attention).toMatchObject({ needs: true, reason: "blocked" });
    const get = (await (h["runs:get"] as any)({ runId: "20260821-010101-kitg" })) as any;
    expect(get.data.run.attention.reason).toBe("blocked");
    expect(runsListRoute.success.safeParse(list).error).toBeUndefined();
    expect(runsGetRoute.success.safeParse(get).error).toBeUndefined();
  });

  test("runs:get without runId is a validation error", async () => {
    const h = createRunsHandlers({ log } as any, noEmit);
    const getHandler = h["runs:get"] as any;
    const r = await getHandler({} as any);
    expect(r.ok).toBe(false);
  });

  test("runs:abandon refuses a run that already ended, and emits nothing", async () => {
    const dir = root();
    seedRun(dir, "remote:acme", "20260822-150000-ffff", 1000, 2, { status: "done" });
    const emitted: string[] = [];
    const handlers = createRunsHandlers({ log } as any, (topic) => { emitted.push(topic); });

    const res = await handlers["runs:abandon"]({ runId: "20260822-150000-ffff", repo: "remote:acme" });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("already");
    // A refusal must not announce a change that did not happen.
    expect(emitted).toEqual([]);
  });

  test("runs:abandon emits run-updated on success", async () => {
    const dir = root();
    seedRun(dir, "remote:acme", "20260822-150001-gggg", 1000, 2, { status: "running" });
    const emitted: { topic: string; payload: any }[] = [];
    const handlers = createRunsHandlers({ log } as any, (topic, payload) => { emitted.push({ topic, payload }); });

    const res = await handlers["runs:abandon"]({ runId: "20260822-150001-gggg", repo: "remote:acme" });

    expect(res.ok).toBe(true);
    expect(emitted[0]!.topic).toBe("run-updated");
    expect(emitted[0]!.payload).toMatchObject({ repo: "remote:acme", kind: "abandoned" });
  });

  test("BOARD-61: abandoning a run settles the run's gates", async () => {
    const dir = root();
    seedRun(dir, "remote:acme", "20260822-150002-hhhh", 1000, 2, { status: "running" });
    const settled: string[] = [];
    const handlers = createRunsHandlers({ log } as any, noEmit, { closeRunGates: async (runId) => { settled.push(runId); } });

    const res = await handlers["runs:abandon"]({ runId: "20260822-150002-hhhh", repo: "remote:acme" });

    expect(res.ok).toBe(true);
    expect(settled).toEqual(["20260822-150002-hhhh"]);
  });

  test("a refused abandon leaves the run's gates alone", async () => {
    const dir = root();
    seedRun(dir, "remote:acme", "20260822-150003-iiii", 1000, 2, { status: "done" });
    const settled: string[] = [];
    const handlers = createRunsHandlers({ log } as any, noEmit, { closeRunGates: async (runId) => { settled.push(runId); } });

    expect((await handlers["runs:abandon"]({ runId: "20260822-150003-iiii", repo: "remote:acme" })).ok).toBe(false);
    expect(settled).toEqual([]);
  });

  test("a gate that fails to settle never turns an abandoned run into a failure", async () => {
    const dir = root();
    seedRun(dir, "remote:acme", "20260822-150004-jjjj", 1000, 2, { status: "running" });
    const handlers = createRunsHandlers({ log } as any, noEmit, { closeRunGates: async () => { throw new Error("gates store busy"); } });

    expect((await handlers["runs:abandon"]({ runId: "20260822-150004-jjjj", repo: "remote:acme" })).ok).toBe(true);
  });

  test("a bare legacy repo filter resolves nothing rather than name-matching, never crashes", async () => {
    const dir = root();
    seedRun(dir, "remote:alpha", "20260821-010101-aaaa", 1000);
    const h = createRunsHandlers({ log } as any, noEmit);

    const list = await (h["runs:list"] as any)({ repo: "alpha" });
    expect(list).toEqual({ ok: true, data: { runs: [] } });

    const get = await (h["runs:get"] as any)({ repo: "alpha", runId: "20260821-010101-aaaa" });
    expect(get).toEqual({ ok: false, error: "run not found" });

    const abandon = await (h["runs:abandon"] as any)({ repo: "alpha", runId: "20260821-010101-aaaa" });
    expect(abandon).toEqual({ ok: false, error: "run not found" });
  });
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

  test("runs:evidence serves a key's file from the run's worktree", async () => {
    const dir = root();
    const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
    writeFileSync(join(tree, "before.png"), PNG);
    seedRun(dir, "remote:alpha", "r-1", 1000, 1, { fields: [
      { key: "worktree", value: tree },
      { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "before.png") }) },
    ] });
    const h = createRunsHandlers({ log } as any, noEmit, { isRunTree: (p, repo) => p === tree && repo === "remote:alpha" });
    const r = await (h["runs:evidence"] as any)({ runId: "r-1", key: "before" });
    expect(r.ok).toBe(true);
    expect(r.data.mime).toBe("image/png");
    expect(Buffer.from(r.data.base64, "base64").equals(PNG)).toBe(true);
  });

  test("runs:evidence addresses a v2 image by case, slot, theme and variant", async () => {
    const dir = root();
    const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
    const PNG2 = Buffer.concat([PNG, Buffer.from([1])]);
    writeFileSync(join(tree, "b.png"), PNG);
    writeFileSync(join(tree, "b-ann.png"), PNG2);
    writeFileSync(join(tree, "dark.png"), PNG);
    const value = {
      v: 2,
      cases: [{ id: "c1", label: "C", before: { path: join(tree, "b.png"), annotated: join(tree, "b-ann.png"), caption: "x" }, after: { dark: { path: join(tree, "dark.png"), waiver: "w" } } }],
    };
    seedRun(dir, "remote:alpha", "v2-1", 1000, 1, { fields: [{ key: "worktree", value: tree }, { key: "evidence", value: JSON.stringify(value) }] });
    const h = createRunsHandlers({ log } as any, noEmit, { isRunTree: (p, repo) => p === tree && repo === "remote:alpha" });
    const call = (p: object) => (h["runs:evidence"] as any)({ runId: "v2-1", ...p });
    const base = await call({ case: "c1", slot: "before" });
    expect(Buffer.from(base.data.base64, "base64").equals(PNG)).toBe(true);
    const ann = await call({ case: "c1", slot: "before", annotated: true });
    expect(Buffer.from(ann.data.base64, "base64").equals(PNG2)).toBe(true);
    expect((await call({ case: "c1", slot: "after", theme: "dark" })).ok).toBe(true);
    expect((await call({ case: "c1", slot: "after" })).error).toBe("theme required: this slot is themed");
    expect((await call({ case: "c1", slot: "before", theme: "light" })).error).toBe("this slot has no themes");
    expect((await call({ case: "c1", slot: "after", theme: "light" })).error).toBe("no evidence");
    expect((await call({ case: "c1", slot: "middle" })).error).toBe("bad address: slot must be before or after, theme light or dark, annotated a boolean");
    expect((await call({ case: "c1", slot: "before", theme: "sepia" })).error).toBe("bad address: slot must be before or after, theme light or dark, annotated a boolean");
    expect((await call({ case: 3, slot: "before" })).error).toBe("bad address: slot must be before or after, theme light or dark, annotated a boolean");
    expect((await call({ case: "c1", slot: "before", annotated: "yes" })).error).toBe("bad address: slot must be before or after, theme light or dark, annotated a boolean");
  });

  test("runs:evidence addresses a v1 value as case 'case', and key addressing is unchanged", async () => {
    const dir = root();
    const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
    writeFileSync(join(tree, "before.png"), PNG);
    seedRun(dir, "remote:alpha", "v1-1", 1000, 1, { fields: [
      { key: "worktree", value: tree },
      { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "before.png") }) },
    ] });
    const h = createRunsHandlers({ log } as any, noEmit, { isRunTree: (p, repo) => p === tree && repo === "remote:alpha" });
    expect((await (h["runs:evidence"] as any)({ runId: "v1-1", case: "case", slot: "before" })).ok).toBe(true);
    expect((await (h["runs:evidence"] as any)({ runId: "v1-1", key: "before" })).ok).toBe(true);
  });

  test("runs:evidence does not admit a self-reported worktree that is not registered", async () => {
    const dir = root();
    const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
    writeFileSync(join(tree, "before.png"), PNG);
    seedRun(dir, "remote:alpha", "r-4", 1000, 1, { fields: [
      { key: "worktree", value: tree },
      { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "before.png") }) },
    ] });
    const h = createRunsHandlers({ log } as any, noEmit, { isRunTree: () => false });
    const r = await (h["runs:evidence"] as any)({ runId: "r-4", key: "before" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("outside the allowed upload roots");
  });

  test("runs:evidence does not admit a tree registered to another repo", async () => {
    const dir = root();
    const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
    writeFileSync(join(tree, "before.png"), PNG);
    seedRun(dir, "remote:alpha", "r-6", 1000, 1, { fields: [
      { key: "worktree", value: tree },
      { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "before.png") }) },
    ] });
    const h = createRunsHandlers({ log } as any, noEmit, { isRunTree: (p, repo) => p === tree && repo === "remote:beta" });
    const r = await (h["runs:evidence"] as any)({ runId: "r-6", key: "before" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("outside the allowed upload roots");
  });

  test("runs:evidence admits no worktree root when no registry seam is given", async () => {
    const dir = root();
    const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
    writeFileSync(join(tree, "before.png"), PNG);
    seedRun(dir, "remote:alpha", "r-5", 1000, 1, { fields: [
      { key: "worktree", value: tree },
      { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "before.png") }) },
    ] });
    const h = createRunsHandlers({ log } as any, noEmit);
    expect((await (h["runs:evidence"] as any)({ runId: "r-5", key: "before" })).ok).toBe(false);
  });

  test("runs:evidence refuses unknown keys, absent keys, legacy values and symlinks out", async () => {
    const dir = root();
    const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
    const outside = mkdtempSync(join(tmpdir(), "rt-out-"));
    writeFileSync(join(outside, "secret.png"), PNG);
    symlinkSync(join(outside, "secret.png"), join(tree, "link.png"));
    seedRun(dir, "remote:alpha", "r-2", 1000, 1, { fields: [
      { key: "worktree", value: tree },
      { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "link.png") }) },
    ] });
    seedRun(dir, "remote:alpha", "r-3", 1000, 1, { fields: [{ key: "evidence", value: "see /tmp/x.png" }] });
    const h = createRunsHandlers({ log } as any, noEmit, { isRunTree: (p, repo) => p === tree && repo === "remote:alpha" });
    const call = (p: object) => (h["runs:evidence"] as any)(p);
    expect((await call({ key: "before" })).error).toBe("missing runId");
    expect((await call({ runId: "nope", key: "before" })).error).toBe("run not found");
    expect((await call({ runId: "r-2", key: "notes" })).error).toBe("unknown key");
    expect((await call({ runId: "r-2", key: "after" })).error).toBe("no evidence");
    expect((await call({ runId: "r-3", key: "before" })).error).toBe("no evidence");
    const escaped = await call({ runId: "r-2", key: "before" });
    expect(escaped.ok).toBe(false);
    expect(escaped.error).toContain("outside the allowed upload roots");
  });

  describe("transcript", () => {
    function seedTranscript(runId: string, file: string, bytes: Buffer | string, extra: object = {}) {
      const dir = root();
      const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
      writeFileSync(join(tree, file), bytes);
      seedRun(dir, "remote:alpha", runId, 1000, 1, { fields: [
        { key: "worktree", value: tree },
        { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "before.png"), transcript: join(tree, file), ...extra }) },
      ] });
      return tree;
    }
    const seams = (tree: string) => ({ isRunTree: (p: string, repo: string) => p === tree && repo === "remote:alpha" });
    const call = (tree: string, runId: string) => (createRunsHandlers({ log } as any, noEmit, seams(tree))["runs:evidence"] as any)({ runId, key: "transcript" });

    test("serves the transcript of a v2 record, and refuses one outside the registered worktree", async () => {
      const dir = root();
      const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
      writeFileSync(join(tree, "run.md"), "# V2\n");
      writeFileSync(join(tree, "b.png"), PNG);
      const value = { v: 2, transcript: join(tree, "run.md"), cases: [{ id: "c1", label: "C", before: { path: join(tree, "b.png"), waiver: "w" } }] };
      seedRun(dir, "remote:alpha", "t-v2", 1000, 1, { fields: [{ key: "worktree", value: tree }, { key: "evidence", value: JSON.stringify(value) }] });
      expect(await call(tree, "t-v2")).toEqual({ ok: true, data: { mime: "text/markdown", text: "# V2\n" } });
      const unregistered = (createRunsHandlers({ log } as any, noEmit, { isRunTree: () => false })["runs:evidence"] as any)({ runId: "t-v2", key: "transcript" });
      expect((await unregistered).ok).toBe(false);
    });

    test("serves a .md transcript from the registered worktree as markdown text", async () => {
      const tree = seedTranscript("t-1", "run.md", "# Run\n");
      expect(await call(tree, "t-1")).toEqual({ ok: true, data: { mime: "text/markdown", text: "# Run\n" } });
    });

    test("serves a .log transcript as plain text", async () => {
      const tree = seedTranscript("t-2", "run.log", "line 1\nline 2\n");
      expect(await call(tree, "t-2")).toEqual({ ok: true, data: { mime: "text/plain", text: "line 1\nline 2\n" } });
    });

    test("refuses a transcript over 256 KB", async () => {
      const tree = seedTranscript("t-3", "run.log", Buffer.alloc(300 * 1024, 0x61));
      const r = await call(tree, "t-3");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("text cap");
    });

    test("refuses invalid UTF-8", async () => {
      const tree = seedTranscript("t-4", "run.txt", Buffer.from([0x61, 0xff, 0xfe]));
      expect(await call(tree, "t-4")).toEqual({ ok: false, error: "file is not valid UTF-8" });
    });

    test("refuses a .png transcript", async () => {
      const tree = seedTranscript("t-5", "run.png", "not text");
      expect((await call(tree, "t-5")).error).toContain("extension must be one of");
    });

    test("refuses a transcript that is a symlink out of the worktree", async () => {
      const outside = mkdtempSync(join(tmpdir(), "rt-out-"));
      writeFileSync(join(outside, "secret.md"), "secret");
      const tree = seedTranscript("t-6", "other.md", "x");
      symlinkSync(join(outside, "secret.md"), join(tree, "link.md"));
      const dir = root();
      seedRun(dir, "remote:alpha", "t-7", 1000, 1, { fields: [
        { key: "worktree", value: tree },
        { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "before.png"), transcript: join(tree, "link.md") }) },
      ] });
      const r = await call(tree, "t-7");
      expect(r.ok).toBe(false);
      expect(r.error).toContain("outside the allowed upload roots");
    });

    test("does not admit a worktree rt did not register to the run's repo", async () => {
      seedTranscript("t-8", "run.md", "x");
      const h = createRunsHandlers({ log } as any, noEmit, { isRunTree: () => false });
      const r = await (h["runs:evidence"] as any)({ runId: "t-8", key: "transcript" });
      expect(r.ok).toBe(false);
      expect(r.error).toContain("outside the allowed upload roots");
    });

    test("answers no evidence when the run names no transcript", async () => {
      const dir = root();
      const tree = mkdtempSync(join(tmpdir(), "rt-tree-"));
      seedRun(dir, "remote:alpha", "t-9", 1000, 1, { fields: [
        { key: "worktree", value: tree },
        { key: "evidence", value: JSON.stringify({ v: 1, before: join(tree, "before.png") }) },
      ] });
      expect((await call(tree, "t-9")).error).toBe("no evidence");
    });
  });
});

describe("runs:hold and runs:redo", () => {
  const REPO = "remote:acme";
  const RUN = "20261117-090000-redo";

  function seedLive(status = "running", stages?: { name: string; status: string }[]): string {
    const dir = root();
    seedRun(dir, REPO, RUN, 1000, 2, { status, ...(stages ? { stages } : {}) });
    return join(dir, REPO, RUN, "state.db");
  }

  function fieldOf(path: string, key: string): string | undefined {
    const db = new Database(path, { readonly: true });
    try {
      return (db.query("SELECT value FROM fields WHERE key = ?").get(key) as { value: string } | null)?.value;
    } finally {
      db.close();
    }
  }

  function gate(over: Record<string, unknown> = {}): any {
    return {
      id: "g-1", subject: `run:${RUN}`, kind: "decision", questions: [], openedAt: 2000,
      meta: { stage: "plan", headCommit: "abc1234" },
      status: "answered", answer: { answers: {}, by: "mode:quiet", answeredAt: 1 },
      ...over,
    };
  }

  function handlersWith(row: any, emitted: { topic: string; payload: any }[]) {
    return createRunsHandlers({ log } as any, (topic, payload) => { emitted.push({ topic, payload }); }, {
      gateById: (id) => (row && row.id === id ? row : null),
    });
  }

  test("runs:redo on a mode-answered gate records the redo and emits once", async () => {
    const path = seedLive();
    const emitted: { topic: string; payload: any }[] = [];
    const h = handlersWith(gate(), emitted);
    const res = await (h["runs:redo"] as any)({ gate: "g-1", note: "try the shared helper" });
    expect(res).toEqual({ ok: true, data: { runId: RUN, repo: REPO, to: "plan", headCommit: "abc1234" } });
    expect(emitted).toEqual([{ topic: "run-updated", payload: { repo: REPO, runId: RUN, stage: "plan", kind: "redo" } }]);
    expect(JSON.parse(fieldOf(path, "redo")!)).toMatchObject({ gate: "g-1", to: "plan", by: "console", headCommit: "abc1234" });
  });

  const refusals: [string, any, string, string][] = [
    ["a person's answer", { gateRow: gate({ answer: { answers: {}, by: "console", answeredAt: 1 } }) }, "not-mode", "only a gate a mode answered can be redone"],
    ["no recorded stage", { gateRow: gate({ meta: { headCommit: "abc1234" } }) }, "no-stage", "that gate recorded no stage to go back to"],
    ["a blank note", { gateRow: gate(), note: "  " }, "bad-note", "Redo needs a note for the worker"],
    ["an unknown gate", { gateRow: null }, "not-found", "no gate g-1"],
    ["a gate from an earlier pass", { gateRow: gate({ openedAt: 500 }) }, "stale", "that gate is from an earlier pass of its step"],
  ];
  for (const [name, c, code, message] of refusals) {
    test(`runs:redo refuses ${name} with ${code}, writing and emitting nothing`, async () => {
      const path = seedLive();
      const emitted: { topic: string; payload: any }[] = [];
      const h = handlersWith(c.gateRow, emitted);
      const res = await (h["runs:redo"] as any)({ gate: "g-1", note: c.note ?? "a note" });
      expect(res).toEqual({ ok: false, error: message, failure: { code, message } });
      expect(emitted).toEqual([]);
      expect(fieldOf(path, "redo")).toBeUndefined();
    });
  }

  test("runs:hold holds the run's current stage and emits held", async () => {
    const path = seedLive();
    const emitted: { topic: string; payload: any }[] = [];
    const res = await (handlersWith(null, emitted)["runs:hold"] as any)({ runId: RUN });
    expect(res).toEqual({ ok: true, data: { held: true, stage: "plan" } });
    expect(fieldOf(path, "hold")).toBe("paused from the console");
    expect(emitted).toEqual([{ topic: "run-updated", payload: { repo: REPO, runId: RUN, stage: "plan", kind: "held" } }]);
  });

  test("a repeat runs:hold reports already and emits nothing more", async () => {
    seedLive();
    const emitted: { topic: string; payload: any }[] = [];
    const h = handlersWith(null, emitted);
    await (h["runs:hold"] as any)({ runId: RUN });
    const res = await (h["runs:hold"] as any)({ runId: RUN });
    expect(res).toEqual({ ok: true, data: { held: true, stage: "plan", already: true } });
    expect(emitted).toHaveLength(1);
  });

  test("runs:hold on a run with no stage row refuses with no-stage and emits nothing", async () => {
    const path = seedLive("running", []);
    const emitted: { topic: string; payload: any }[] = [];
    const res = await (handlersWith(null, emitted)["runs:hold"] as any)({ runId: RUN });
    expect(res).toEqual({ ok: false, error: "this run has no step to pause at", failure: { code: "no-stage", message: "this run has no step to pause at" } });
    expect(emitted).toEqual([]);
    expect(fieldOf(path, "hold")).toBeUndefined();
  });

  test("runs:hold on a finished run refuses with finished and emits nothing", async () => {
    seedLive("done");
    const emitted: { topic: string; payload: any }[] = [];
    const res = await (handlersWith(null, emitted)["runs:hold"] as any)({ runId: RUN });
    expect(res).toEqual({ ok: false, error: "this run has finished", failure: { code: "finished", message: "this run has finished" } });
    expect(emitted).toEqual([]);
  });
});
