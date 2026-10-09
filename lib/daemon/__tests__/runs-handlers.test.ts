import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRunsHandlers } from "../handlers/runs.ts";
import { root, seedRun } from "../../runs/__tests__/fixtures.ts";

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
    const missing = await getHandler({ runId: "nope" });
    expect(missing.ok).toBe(false);
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
    const h = createRunsHandlers({ log } as any, noEmit);
    const r = await (h["runs:evidence"] as any)({ runId: "r-1", key: "before" });
    expect(r.ok).toBe(true);
    expect(r.data.mime).toBe("image/png");
    expect(Buffer.from(r.data.base64, "base64").equals(PNG)).toBe(true);
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
    const h = createRunsHandlers({ log } as any, noEmit);
    const call = (p: object) => (h["runs:evidence"] as any)(p);
    expect((await call({ key: "before" })).error).toBe("missing runId");
    expect((await call({ runId: "nope", key: "before" })).error).toBe("run not found");
    expect((await call({ runId: "r-2", key: "transcript" })).error).toBe("unknown key");
    expect((await call({ runId: "r-2", key: "after" })).error).toBe("no evidence");
    expect((await call({ runId: "r-3", key: "before" })).error).toBe("no evidence");
    expect((await call({ runId: "r-2", key: "before" })).ok).toBe(false);
  });
});
