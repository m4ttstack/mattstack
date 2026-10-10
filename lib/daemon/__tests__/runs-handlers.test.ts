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
