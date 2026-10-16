import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { DAEMON_SOCK_PATH } from "../../lib/daemon-config.ts";
import { runEngineOp, runWriteVerb, type EngineOp } from "../runs-write.ts";

type Seen = { topic: string; payload: { stage: string | null; kind: string } };

async function withFakeDaemon<T>(body: (seen: Seen[]) => Promise<T>): Promise<T> {
  mkdirSync(dirname(DAEMON_SOCK_PATH), { recursive: true });
  if (existsSync(DAEMON_SOCK_PATH)) rmSync(DAEMON_SOCK_PATH);
  const seen: Seen[] = [];
  const server = Bun.serve({
    unix: DAEMON_SOCK_PATH,
    async fetch(req) { seen.push((await req.json()) as Seen); return new Response(JSON.stringify({ ok: true })); },
  });
  try {
    return await body(seen);
  } finally {
    server.stop(true);
    if (existsSync(DAEMON_SOCK_PATH)) rmSync(DAEMON_SOCK_PATH);
  }
}

const bases: string[] = [];
afterAll(() => { for (const b of bases) rmSync(b, { recursive: true, force: true }); });

function fixture(): { root: string; pack: string } {
  const base = mkdtempSync(join(tmpdir(), "rt-engine-op-"));
  bases.push(base);
  const pack = join(base, "pack");
  mkdirSync(join(pack, "pack"), { recursive: true });
  const stage = (s: string, consumes: string[], produces: string[]) => ({ stage: s, name: s, file: `skills/${s}/SKILL.md`, consumes, produces });
  writeFileSync(join(pack, "pack", "pipelines.json"), JSON.stringify({ version: 1, pipelines: { work: [stage("plan", [], ["plan"]), stage("build", ["plan"], [])] } }));
  return { root: join(base, "runs"), pack };
}

const ARGS = ["--repo", "demo", "--work-type", "work", "--pipeline", "work"];
const enterOp = (pack: string, extra: Partial<Extract<EngineOp, { op: "enter" }>> = {}): EngineOp => ({ op: "enter", args: [...ARGS, "--pack-dirs", pack], packRoot: pack, ...extra });

describe("runEngineOp", () => {
  test("enter starts a run, emits run-start with stage null and returns the envelope", async () => {
    const { root, pack } = fixture();
    await withFakeDaemon(async (seen) => {
      const r = await runEngineOp(enterOp(pack), { RT_RUNS_ROOT: root });
      expect(r.code).toBe(0);
      expect(JSON.parse(r.out)).toMatchObject({ ok: true, mode: "started", stages: ["plan", "build"], at: { stage: "plan", attempt: 1 } });
      expect(seen.map((s) => s.payload)).toEqual([expect.objectContaining({ stage: null, kind: "run-start" })]);
    });
  });

  test("enter resuming a run emits run-resume", async () => {
    const { root, pack } = fixture();
    const env = { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const started = JSON.parse((await runEngineOp(enterOp(pack), env)).out) as { runId: string };
    await withFakeDaemon(async (seen) => {
      const r = await runEngineOp(enterOp(pack, { resume: started.runId }), { RT_RUNS_ROOT: root });
      expect(JSON.parse(r.out)).toMatchObject({ ok: true, mode: "resumed", runId: started.runId });
      expect(seen.map((s) => s.payload.kind)).toEqual(["run-resume"]);
    });
  });

  test("enter with candidates and inheritance emits nothing", async () => {
    const { root, pack } = fixture();
    const env = { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const started = JSON.parse((await runEngineOp(enterOp(pack), env)).out) as { runDb: string };
    await withFakeDaemon(async (seen) => {
      const quiet = { RT_RUNS_ROOT: root };
      expect(JSON.parse((await runEngineOp(enterOp(pack), quiet)).out).mode).toBe("candidates");
      expect(JSON.parse((await runEngineOp(enterOp(pack, { handedRunDb: started.runDb }), quiet)).out).mode).toBe("inherited");
      expect(seen).toEqual([]);
    });
  });

  test("enter, and next when it starts a stage, adopt the session; hold does not", async () => {
    const { root, pack } = fixture();
    const base = { RT_RUNS_ROOT: root, CLAUDE_CODE_SESSION_ID: "sess-engine-1" };
    await withFakeDaemon(async (seen) => {
      const adopts = () => seen.filter((s) => JSON.stringify(s).includes("sess-engine-1")).length;
      const { runDb } = JSON.parse((await runEngineOp(enterOp(pack), base)).out) as { runDb: string };
      expect(adopts()).toBe(1);
      const env = { ...base, RT_RUN_DB: runDb };
      await runWriteVerb("field", ["set", "plan", "x", "--stage", "plan"], { ...env, RT_RUN_EMIT: "0" });
      const next = await runEngineOp({ op: "next", stage: "plan" }, env, "/");
      expect(JSON.parse(next.out)).toMatchObject({ ended: "done", next: { stage: "build" } });
      expect(adopts()).toBe(2);
      await runEngineOp({ op: "hold", stage: "build", decidedBy: "me" }, env, "/");
      expect(adopts()).toBe(2);
    });
  });

  test("resume adopts the session", async () => {
    const { root, pack } = fixture();
    const base = { RT_RUNS_ROOT: root, CLAUDE_CODE_SESSION_ID: "sess-engine-1" };
    await withFakeDaemon(async (seen) => {
      const adopts = () => seen.filter((s) => JSON.stringify(s).includes("sess-engine-1")).length;
      const { runId } = JSON.parse((await runEngineOp(enterOp(pack), base)).out) as { runId: string };
      expect(adopts()).toBe(1);
      const r = await runEngineOp(enterOp(pack, { resume: runId }), base);
      expect(JSON.parse(r.out).mode).toBe("resumed");
      expect(adopts()).toBe(2);
    });
  });

  test("resolve adopts when it starts a stage (retry, redirect) and not for hold", async () => {
    const { root, pack } = fixture();
    const base = { RT_RUNS_ROOT: root, CLAUDE_CODE_SESSION_ID: "sess-engine-1" };
    const quiet = { ...base, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const { runDb } = JSON.parse((await runEngineOp(enterOp(pack), quiet)).out) as { runDb: string };
    const env = { ...base, RT_RUN_DB: runDb };
    await runWriteVerb("field", ["set", "plan", "x", "--stage", "plan"], { ...quiet, RT_RUN_DB: runDb });
    await runEngineOp({ op: "next", stage: "plan" }, { ...quiet, RT_RUN_DB: runDb }, "/");
    await runWriteVerb("stage-fail", ["--stage", "build", "--reason", "red"], { ...quiet, RT_RUN_DB: runDb });
    await withFakeDaemon(async (seen) => {
      const adopts = () => seen.filter((s) => JSON.stringify(s).includes("sess-engine-1")).length;
      const resolve = async (next: "retry" | "redirect" | "hold", extra: { to?: string } = {}) =>
        JSON.parse((await runEngineOp({ op: "resolve", stage: "build", next, decidedBy: "me", ...extra }, env, "/")).out);
      expect(await resolve("hold")).toMatchObject({ applied: "hold" });
      expect(adopts()).toBe(0);
      expect(await resolve("retry")).toMatchObject({ applied: "retry", next: { stage: "build", attempt: 2 } });
      expect(adopts()).toBe(1);
      expect(await resolve("redirect", { to: "plan" })).toMatchObject({ applied: "redirect", next: { stage: "plan" } });
      expect(adopts()).toBe(2);
    });
  });

  test("a missing --repo is a usage error, exit 2", async () => {
    const { root, pack } = fixture();
    const r = await runEngineOp({ op: "enter", args: ["--work-type", "w", "--pipeline", "p"], packRoot: pack }, { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" });
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out)).toEqual({ ok: false, error: "--repo is required" });
  });

  test("next, resolve, hold, close and budget emit their own kind with the op's stage", async () => {
    const { root, pack } = fixture();
    const quiet = { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const { runDb } = JSON.parse((await runEngineOp(enterOp(pack), quiet)).out) as { runDb: string };
    const env = { ...quiet, RT_RUN_DB: runDb };
    await runWriteVerb("field", ["set", "plan", "x", "--stage", "plan"], env);
    const loud = { RT_RUN_DB: runDb };
    await withFakeDaemon(async (seen) => {
      const ops: EngineOp[] = [
        { op: "next", stage: "plan" },
        { op: "hold", stage: "build", reason: "w", decidedBy: "me" },
        { op: "resolve", stage: "build", next: "redirect", to: "plan", decidedBy: "me" },
        { op: "budget", key: "k", limit: 2 },
        { op: "resolve", stage: "plan", next: "abandon", decidedBy: "me" },
      ];
      const results = [];
      for (const op of ops) results.push(await runEngineOp(op, loud, "/"));
      expect(results.map((r) => r.code)).toEqual([0, 0, 0, 0, 0]);
      expect(seen.map((s) => [s.payload.kind, s.payload.stage])).toEqual([
        ["run-next", "plan"], ["run-hold", "build"], ["run-resolve", "build"], ["run-budget", null], ["run-resolve", "plan"],
      ]);
      expect(JSON.parse(results[3]!.out)).toEqual({ ok: true, key: "k", spent: 1, limit: 2, remaining: 1, exhausted: false });
    });
  });

  test("an op that wrote nothing emits nothing: repeated, held, closed, a zero budget increment", async () => {
    const { root, pack } = fixture();
    const quiet = { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const { runDb } = JSON.parse((await runEngineOp(enterOp(pack), quiet)).out) as { runDb: string };
    const env = { ...quiet, RT_RUN_DB: runDb };
    await runWriteVerb("field", ["set", "plan", "x", "--stage", "plan"], env);
    const loud = { RT_RUN_DB: runDb };
    await withFakeDaemon(async (seen) => {
      const run = async (op: EngineOp) => JSON.parse((await runEngineOp(op, loud, "/")).out);
      expect(await run({ op: "next", stage: "plan" })).toMatchObject({ ended: "done" });
      expect(seen.map((s) => s.payload.kind)).toEqual(["run-next"]);
      expect(await run({ op: "next", stage: "plan" })).toMatchObject({ ended: "done", repeated: true });
      expect(await run({ op: "budget", key: "k", limit: 2, increment: 0 })).toMatchObject({ spent: 0 });
      expect(await run({ op: "resolve", stage: "build", next: "iterate", attempt: 1, decidedBy: "me" })).toMatchObject({ applied: "iterate" });
      expect(seen.map((s) => s.payload.kind)).toEqual(["run-next", "run-resolve"]);
      expect(await run({ op: "resolve", stage: "build", next: "iterate", attempt: 1, decidedBy: "me" })).toMatchObject({ applied: "iterate", repeated: true });
      expect(await run({ op: "hold", stage: "build", decidedBy: "me" })).toMatchObject({ held: true });
      expect(seen).toHaveLength(3);
      expect(await run({ op: "next", stage: "build" })).toMatchObject({ ended: "held" });
      await run({ op: "resolve", stage: "build", next: "abandon", decidedBy: "me" });
      expect(seen).toHaveLength(4);
      expect(await run({ op: "next", stage: "build" })).toMatchObject({ ended: "closed" });
      expect(seen).toHaveLength(4);
    });
  });

  test("close closes a standalone run and refuses a work-type mismatch", async () => {
    const { root, pack } = fixture();
    const quiet = { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const { runDb } = JSON.parse((await runEngineOp(enterOp(pack, { stage: "watch" }), quiet)).out) as { runDb: string };
    const env = { ...quiet, RT_RUN_DB: runDb };
    const wrong = await runEngineOp({ op: "close", workType: "other", stage: "watch", outcome: "done" }, env, "/");
    expect(wrong.code).toBe(2);
    expect(JSON.parse(wrong.out).error).toContain("inherited run closes nothing");
    const right = await runEngineOp({ op: "close", workType: "work", stage: "watch", outcome: "done" }, env, "/");
    expect(JSON.parse(right.out)).toEqual({ ok: true, closed: true, status: "done" });
  });

  test("a missing run DB is exit 2 and an engine refusal keeps its code", async () => {
    const { root } = fixture();
    const env = { RT_RUNS_ROOT: root, RT_RUN_DB: join(root, "nope", "state.db"), RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv;
    const r = await runEngineOp({ op: "next", stage: "plan" }, env, "/");
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).error).toContain("run DB not found");
  });
});
