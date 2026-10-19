import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { EngineOp } from "../../../commands/runs-write.ts";
import { isFieldChanged, valueSha256 } from "../../runs/write.ts";
import { packRootFrom, realRunToolDeps, runToolDefs, splitFlags, type RunToolDeps } from "../run-tools.ts";

type Call = { verb: string; args: string[]; env: NodeJS.ProcessEnv; cwd: string };
type EngineCall = { op: EngineOp; env: NodeJS.ProcessEnv; cwd: string };

const RUNS_ROOT = "/runs";
const DB = `${RUNS_ROOT}/repo/id/state.db`;
const RUNS_ROOT_ENV = { RT_RUNS_ROOT: RUNS_ROOT } as NodeJS.ProcessEnv;

function fakeDeps(out = '{"ok":true}', code = 0): { deps: RunToolDeps; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    deps: {
      write: async (verb, args, env, cwd) => { calls.push({ verb, args, env: env ?? {}, cwd: cwd ?? "" }); return { out, code }; },
      list: async () => ({ ok: true, data: { runs: [] } }) as any,
      realpath: (p) => p.replace("/link/", "/real/"),
      isPackRoot: () => true,
      engine: async () => ({ out: "{}", code: 0 }),
    },
  };
}

function fakeEngine(out = '{"ok":true}', code = 0): { deps: RunToolDeps; calls: EngineCall[] } {
  const { deps } = fakeDeps();
  const calls: EngineCall[] = [];
  deps.engine = async (op, env, cwd) => { calls.push({ op, env: env ?? {}, cwd: cwd ?? "" }); return { out, code }; };
  return { deps, calls };
}

const tool = (deps: RunToolDeps, name: string) => runToolDefs(deps).find((t) => t.name === name)!;

describe("splitFlags", () => {
  test("splits on whitespace", () => {
    expect(splitFlags(" --repo r  --work-type w --pipeline p ")).toEqual({ ok: true, args: ["--repo", "r", "--work-type", "w", "--pipeline", "p"] });
  });
  test("refuses quotes and command substitution", () => {
    for (const bad of ["--repo 'r'", '--repo "r"', "--repo $(id)", "--repo `id`"]) {
      expect(splitFlags(bad).ok, bad).toBe(false);
    }
  });
  test("refuses C0 control characters and DEL", () => {
    for (const bad of ["--repo r\x00", "--repo r\x07", "--repo r\x1b", "--repo r\x7f"]) {
      expect(splitFlags(bad).ok, bad).toBe(false);
    }
  });
  test("still splits on tab, newline and carriage return", () => {
    expect(splitFlags("--repo\tr\n--work-type\rw").ok).toBe(true);
  });
});

describe("packRootFrom", () => {
  test("is the realpath two levels above the skill dir", () => {
    expect(packRootFrom("/link/pack/skills/work", (p) => p.replace("/link/", "/real/"))).toBe("/real/pack");
  });
});

describe("run_start", () => {
  test("builds the run-start argv from flags, skillDir, ticket and spawnedBy", async () => {
    const { deps, calls } = fakeDeps('{"ok":true,"runId":"x","runDb":"/db"}');
    const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p", skillDir: "/link/pack/skills/work", ticket: "T-1", spawnedBy: "board" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(res.body).toEqual({ ok: true, runId: "x", runDb: "/db" });
    expect(calls[0]!.verb).toBe("run-start");
    expect(calls[0]!.args).toEqual(["--repo", "r", "--work-type", "w", "--pipeline", "p", "--pack-dirs", "/real/pack", "--ticket", "T-1", "--spawned-by", "board"]);
  });
  test("refuses a quoted flag string without calling write", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_start").handler({ flags: "--repo $(x)", skillDir: "/p/s/w" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
  test("refuses a relative skillDir without calling write", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p", skillDir: "pack/skills/work" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("skillDir");
    expect(calls).toEqual([]);
  });
  test("refuses a skillDir whose derived pack root carries no plugin manifest", async () => {
    const { deps, calls } = fakeDeps();
    deps.isPackRoot = () => false;
    const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("plugin.json");
    expect(calls).toEqual([]);
  });

  describe("flags allowlist", () => {
    test("refuses an unknown flag", async () => {
      const { deps, calls } = fakeDeps();
      const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --evil x", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("--evil");
      expect(calls).toEqual([]);
    });
    test("refuses an attempted --pack-dirs override in --x v form", async () => {
      const { deps, calls } = fakeDeps();
      const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --pack-dirs /evil", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("--pack-dirs");
      expect(calls).toEqual([]);
    });
    test("refuses an attempted --pack-dirs override in --x=v form", async () => {
      const { deps, calls } = fakeDeps();
      const res = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --pack-dirs=/evil", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("--pack-dirs");
      expect(calls).toEqual([]);
    });
    test("refuses --ticket and --spawned-by named inside the flags string itself", async () => {
      const { deps, calls } = fakeDeps();
      const ticket = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --ticket T-1", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      const spawned = await tool(deps, "run_start").handler({ flags: "--repo r --work-type w --pipeline p --spawned-by board", skillDir: "/link/pack/skills/work" }, {} as NodeJS.ProcessEnv);
      expect(ticket.ok).toBe(false);
      expect(spawned.ok).toBe(false);
      expect(calls).toEqual([]);
    });
    test("accepts every flag run-start's own CLI parses", async () => {
      const { deps, calls } = fakeDeps('{"ok":true,"runId":"x","runDb":"/db"}');
      const res = await tool(deps, "run_start").handler({
        flags: "--repo r --work-type w --pipeline p --run-id abc --mattstack-sha sha1 --mattstack-dirty 1 --pack-sha name=val",
        skillDir: "/link/pack/skills/work",
      }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(true);
      expect(calls[0]!.args).toEqual([
        "--repo", "r", "--work-type", "w", "--pipeline", "p",
        "--run-id", "abc", "--mattstack-sha", "sha1", "--mattstack-dirty", "1", "--pack-sha", "name=val",
        "--pack-dirs", "/real/pack",
      ]);
    });
  });
});

describe("run_stage description", () => {
  test("says a start on a running stage refuses and names the moves, never that it supersedes", () => {
    const { description } = tool(fakeDeps().deps, "run_stage");
    expect(description).not.toContain("supersede");
    expect(description).toContain("A start on a stage whose latest attempt is still running refuses");
    for (const move of ["run_enter", "run_next", "run_resolve"]) expect(description).toContain(move);
  });

  test("says a start on a done run needs reopen, and only a done run reopens", () => {
    const { description, inputSchema } = tool(fakeDeps().deps, "run_stage");
    expect(description).toContain("reopen: true");
    expect(description).toContain("Only a done run reopens");
    expect((inputSchema as { properties: Record<string, unknown> }).properties.reopen).toMatchObject({ type: "boolean" });
  });
});

describe("run_stage reopen", () => {
  test("start passes --reopen only when reopen is true", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_stage").handler({ runDb: DB, action: "start", stage: "ship", reopen: true }, RUNS_ROOT_ENV);
    await tool(deps, "run_stage").handler({ runDb: DB, action: "start", stage: "ship", reopen: false }, RUNS_ROOT_ENV);
    expect(calls.map((c) => c.args)).toEqual([["--stage", "ship", "--reopen"], ["--stage", "ship"]]);
  });

  test("reopen that is not a boolean, or true on another action, is a field error", async () => {
    const { deps, calls } = fakeDeps();
    expect((await tool(deps, "run_stage").handler({ runDb: DB, action: "start", stage: "ship", reopen: "yes" }, RUNS_ROOT_ENV)).error).toBe('"reopen" must be a boolean');
    expect((await tool(deps, "run_stage").handler({ runDb: DB, action: "done", stage: "ship", reopen: true }, RUNS_ROOT_ENV)).error).toBe('"reopen" goes only with action start');
    expect(calls).toEqual([]);
    await tool(deps, "run_stage").handler({ runDb: DB, action: "done", stage: "ship", reopen: false }, RUNS_ROOT_ENV);
    expect(calls.map((c) => c.verb)).toEqual(["stage-done"]);
  });
});

describe("run tools pass runDb as RT_RUN_DB and cwd through", () => {
  test("run_stage start", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_stage").handler({ runDb: DB, action: "start", stage: "plan" }, { HOME: "/h", ...RUNS_ROOT_ENV } as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "stage-start", args: ["--stage", "plan"] });
    expect(calls[0]!.env.RT_RUN_DB).toBe(DB);
    expect(calls[0]!.env.HOME).toBe("/h");
  });
  test("run_stage fail carries reason and detailPath; redirect carries to", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_stage").handler({ runDb: DB, action: "fail", stage: "ci", reason: "red", detailPath: "/d" }, RUNS_ROOT_ENV);
    await tool(deps, "run_stage").handler({ runDb: DB, action: "redirect", stage: "ci", to: "implement", reason: "back" }, RUNS_ROOT_ENV);
    expect(calls[0]).toMatchObject({ verb: "stage-fail", args: ["--stage", "ci", "--reason", "red", "--detail-path", "/d"] });
    expect(calls[1]).toMatchObject({ verb: "stage-redirect", args: ["--stage", "ci", "--to", "implement", "--reason", "back"] });
  });
  test("run_stage redirect without to is a field error", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_stage").handler({ runDb: DB, action: "redirect", stage: "ci" }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("to");
    expect(calls).toEqual([]);
  });
  test("run_field_set and run_field_get", async () => {
    const { deps, calls } = fakeDeps("main", 0);
    await tool(deps, "run_field_set").handler({ runDb: DB, key: "branch", value: "feat", stage: "provision" }, RUNS_ROOT_ENV);
    const got = await tool(deps, "run_field_get").handler({ runDb: DB, key: "branch" }, RUNS_ROOT_ENV);
    expect(calls[0]).toMatchObject({ verb: "field", args: ["set", "branch", "feat", "--stage", "provision"] });
    expect(calls[1]).toMatchObject({ verb: "field", args: ["get", "branch"] });
    expect(got).toEqual({ ok: true, body: { value: "main" } });
  });
  test("run_field_set passes ifSha256 as --if-sha256 and refuses one that is not 64 hex digits", async () => {
    const { deps, calls } = fakeDeps("", 0);
    const sha = "a".repeat(64);
    await tool(deps, "run_field_set").handler({ runDb: DB, key: "branch", value: "feat", stage: "provision", ifSha256: sha }, RUNS_ROOT_ENV);
    expect(calls[0]).toMatchObject({ verb: "field", args: ["set", "branch", "feat", "--stage", "provision", "--if-sha256", sha] });
    const bad = await tool(deps, "run_field_set").handler({ runDb: DB, key: "branch", value: "feat", stage: "provision", ifSha256: "nope" }, RUNS_ROOT_ENV);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("ifSha256");
    expect(calls).toHaveLength(1);
  });
  test("run_field_get on a missing key (exit 3) is an error naming the key", async () => {
    const { deps } = fakeDeps("", 3);
    const res = await tool(deps, "run_field_get").handler({ runDb: DB, key: "mr" }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("mr");
  });
  test("run_decision serializes selection itself", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_decision").handler({ runDb: DB, contract: "gate@1", scope: "close", selection: { next: "done" }, decidedBy: "pane" }, RUNS_ROOT_ENV);
    expect(calls[0]).toMatchObject({ verb: "decision", args: ["record", "--contract", "gate@1", "--scope", "close", "--selection", '{"next":"done"}', "--decided-by", "pane"] });
  });
  test("run_status and run_snapshot; cwd stands in when runDb is omitted", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_status").handler({ cwd: "/tree", status: "done" }, {} as NodeJS.ProcessEnv);
    await tool(deps, "run_snapshot").handler({ cwd: "/tree" }, {} as NodeJS.ProcessEnv);
    expect(calls[0]).toMatchObject({ verb: "run-status", args: ["--status", "done"], cwd: "/tree" });
    expect(calls[0]!.env.RT_RUN_DB).toBeUndefined();
    expect(calls[1]).toMatchObject({ verb: "snapshot", args: [], cwd: "/tree" });
  });
  test("cwd alone drops an RT_RUN_DB inherited by the server, so it cannot bypass confinement", async () => {
    const { deps, calls } = fakeDeps();
    await tool(deps, "run_snapshot").handler({ cwd: "/tree" }, { RT_RUN_DB: "/elsewhere/other.db" } as NodeJS.ProcessEnv);
    expect(calls[0]!.env.RT_RUN_DB).toBeUndefined();
  });
  test("an empty runs root refuses every runDb", async () => {
    const { deps, calls } = fakeDeps();
    const saved = process.env.RT_RUNS_ROOT;
    process.env.RT_RUNS_ROOT = "";
    try {
      const res = await tool(deps, "run_snapshot").handler({ runDb: "/anywhere/state.db" }, { RT_RUNS_ROOT: "" } as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toContain("no runs root");
      expect(calls).toEqual([]);
    } finally {
      if (saved === undefined) delete process.env.RT_RUNS_ROOT;
      else process.env.RT_RUNS_ROOT = saved;
    }
  });
  test("neither runDb nor cwd is refused without touching the run store", async () => {
    const { deps, calls } = fakeDeps();
    for (const name of ["run_stage", "run_field_set", "run_field_get", "run_decision", "run_status", "run_snapshot"]) {
      const res = await tool(deps, name).handler({ action: "start", stage: "s", key: "k", value: "v", contract: "c", scope: "s", selection: {}, decidedBy: "d", status: "done" }, {} as NodeJS.ProcessEnv);
      expect(res.ok, name).toBe(false);
      expect(res.error, name).toContain("runDb");
    }
    expect(calls).toEqual([]);
  });
  test("run_list passes the repo positionally to listRuns", async () => {
    const seen: unknown[] = [];
    const { deps } = fakeDeps();
    deps.list = (async (repo: unknown) => { seen.push(repo); return { ok: true, data: { runs: [] } }; }) as any;
    await tool(deps, "run_list").handler({ repo: "acme" }, {} as NodeJS.ProcessEnv);
    await tool(deps, "run_list").handler({}, {} as NodeJS.ProcessEnv);
    expect(seen).toEqual(["acme", undefined]);
  });
  test("legacy work runs match the default verb", async () => {
    const { deps } = fakeDeps();
    const runs = [{ id: "1", pipeline: "feature" }, { id: "2", pipeline: "work" }, { id: "3", pipeline: "accessibility" }, { id: "4", pipeline: "" }];
    deps.list = (async () => ({ ok: true, data: { runs } })) as any;
    const ids = async (pipelines: unknown) => {
      const res = await tool(deps, "run_list").handler({ pipelines }, {} as NodeJS.ProcessEnv);
      return res.ok ? (res.body as { runs: Array<{ id: string }> }).runs.map((r) => r.id) : res.error;
    };
    expect(await ids(["feature", "work"])).toEqual(["1", "2", "4"]);
    expect(await ids(["accessibility"])).toEqual(["3"]);
    expect(await ids("x")).toBe('"pipelines" must be an array of strings');
    expect(await ids([1])).toBe('"pipelines" must be an array of strings');
  });
  test("a non-zero write result surfaces the envelope's error", async () => {
    const { deps } = fakeDeps('{"ok":false,"error":"stage not running"}', 2);
    const res = await tool(deps, "run_snapshot").handler({ runDb: DB }, RUNS_ROOT_ENV);
    expect(res).toEqual({ ok: false, body: undefined, error: "stage not running" });
  });
});

describe("runDb and cwd validation", () => {
  test("refuses a relative runDb", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ runDb: "repo/id/state.db" }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("runDb");
    expect(calls).toEqual([]);
  });
  test("refuses a relative cwd", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ cwd: "tree" }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("cwd");
    expect(calls).toEqual([]);
  });
  test("refuses a runDb outside the runs root", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ runDb: "/elsewhere/repo/id/state.db" }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("runs root");
    expect(calls).toEqual([]);
  });
  test("refuses a runDb whose basename is not state.db", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ runDb: `${RUNS_ROOT}/repo/id/other.db` }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("state.db");
    expect(calls).toEqual([]);
  });
  test("accepts an absolute runDb under the runs root named state.db", async () => {
    const { deps, calls } = fakeDeps();
    const res = await tool(deps, "run_snapshot").handler({ runDb: DB }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(true);
    expect(calls[0]!.env.RT_RUN_DB).toBe(DB);
  });
  test("passes the realpathed runDb as RT_RUN_DB, not the raw input", async () => {
    const { deps, calls } = fakeDeps();
    deps.realpath = (p) => p.replace(/link/g, "real");
    const res = await tool(deps, "run_snapshot").handler({ runDb: `${RUNS_ROOT}/link/repo/id/state.db` }, { RT_RUNS_ROOT: `${RUNS_ROOT}/link` } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(calls[0]!.env.RT_RUN_DB).toBe(`${RUNS_ROOT}/real/repo/id/state.db`);
  });
  test("realpaths the runs root too, so a runDb behind a symlinked root (macOS /var -> /private/var) still resolves", async () => {
    const { deps, calls } = fakeDeps();
    deps.realpath = (p) => p.replace("/var/", "/private/var/");
    const res = await tool(deps, "run_snapshot").handler({ runDb: "/var/runs/repo/id/state.db" }, { RT_RUNS_ROOT: "/var/runs" } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect(calls[0]!.env.RT_RUN_DB).toBe("/private/var/runs/repo/id/state.db");
  });
  test("still refuses a runDb outside the root once both are realpathed", async () => {
    const { deps, calls } = fakeDeps();
    deps.realpath = (p) => p.replace("/var/", "/private/var/");
    const res = await tool(deps, "run_snapshot").handler({ runDb: "/elsewhere/repo/id/state.db" }, { RT_RUNS_ROOT: "/var/runs" } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("runs root");
    expect(calls).toEqual([]);
  });
  test("tolerates a runs root that does not resolve yet (a fresh install)", async () => {
    const { deps } = fakeDeps();
    const ROOT = "/fresh/runs";
    deps.realpath = (p) => { if (p === ROOT) throw new Error("ENOENT"); return p; };
    const res = await tool(deps, "run_snapshot").handler({ runDb: `${ROOT}/repo/id/state.db` }, { RT_RUNS_ROOT: ROOT } as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
  });
});

const FLAGS = "--repo r --work-type w --pipeline p";
const SKILL = "/link/pack/skills/work";
const HANDED = `${RUNS_ROOT}/r/id/state.db`;

describe("run_enter", () => {
  test("builds the enter op from flags, skillDir and the optional inputs", async () => {
    const { deps, calls } = fakeEngine('{"ok":true,"mode":"started"}');
    const res = await tool(deps, "run_enter").handler(
      { flags: FLAGS, skillDir: SKILL, stage: "plan", pipeline: "feature", runDb: HANDED, resume: "id-1", fresh: true, ticket: "T-1", spawnedBy: "board" },
      RUNS_ROOT_ENV,
    );
    expect(res).toEqual({ ok: true, body: { ok: true, mode: "started" } });
    expect(calls[0]!.op).toEqual({
      op: "enter",
      args: ["--repo", "r", "--work-type", "w", "--pipeline", "p", "--pack-dirs", "/real/pack", "--ticket", "T-1", "--spawned-by", "board"],
      packRoot: "/real/pack", stage: "plan", pipeline: "feature", handedRunDb: HANDED, resume: "id-1", fresh: true,
    });
  });
  test("only the inputs given reach the op", async () => {
    const { deps, calls } = fakeEngine();
    await tool(deps, "run_enter").handler({ flags: FLAGS, skillDir: SKILL }, RUNS_ROOT_ENV);
    expect(calls[0]!.op).toEqual({ op: "enter", args: ["--repo", "r", "--work-type", "w", "--pipeline", "p", "--pack-dirs", "/real/pack"], packRoot: "/real/pack" });
  });
  test("refuses bad input without calling the engine", async () => {
    const { deps, calls } = fakeEngine();
    const run = (input: Record<string, unknown>) => tool(deps, "run_enter").handler({ flags: FLAGS, skillDir: SKILL, ...input }, RUNS_ROOT_ENV);
    expect((await run({ flags: "--repo $(x)" })).ok).toBe(false);
    expect((await run({ flags: `${FLAGS} --evil x` })).ok).toBe(false);
    expect((await run({ skillDir: "pack/skills/work" })).error).toContain("skillDir");
    expect((await run({ runDb: "/elsewhere/r/id/state.db" })).error).toContain("runs root");
    expect((await run({ runDb: `${RUNS_ROOT}/other/id/state.db` })).error).toContain("runs root");
    expect((await run({ runDb: `${RUNS_ROOT}/r/id/other.db` })).error).toContain("state.db");
    expect((await run({ runDb: "repo/id/state.db" })).error).toContain("runDb");
    for (const resume of ["../x", "a/b", "..", ""]) expect((await run({ resume })).error, resume).toContain("resume");
    expect((await run({ fresh: "yes" })).ok).toBe(false);
    deps.isPackRoot = () => false;
    expect((await run({})).error).toContain("plugin.json");
    expect(calls).toEqual([]);
  });
  test("an engine error envelope becomes the error message", async () => {
    const { deps } = fakeEngine('{"ok":false,"error":"no run x in repo r"}', 2);
    const res = await tool(deps, "run_enter").handler({ flags: FLAGS, skillDir: SKILL }, RUNS_ROOT_ENV);
    expect(res).toEqual({ ok: false, body: undefined, error: "no run x in repo r" });
  });
});

describe("run engine tools", () => {
  test("each builds its op and passes the confined runDb as RT_RUN_DB", async () => {
    const { deps, calls } = fakeEngine();
    const env = { HOME: "/h", ...RUNS_ROOT_ENV } as NodeJS.ProcessEnv;
    await tool(deps, "run_next").handler({ runDb: DB, stage: "plan" }, env);
    await tool(deps, "run_resolve").handler({ runDb: DB, stage: "ci", next: "redirect", to: "implement", note: "why", decidedBy: "pane" }, env);
    await tool(deps, "run_hold").handler({ runDb: DB, stage: "ci", reason: "wait", decidedBy: "pane" }, env);
    await tool(deps, "run_close").handler({ runDb: DB, workType: "w", stage: "s", outcome: "failed", reason: "r", detailPath: "/d" }, env);
    await tool(deps, "run_budget").handler({ runDb: DB, key: "k", limit: 3, increment: 0, stage: "ci" }, env);
    expect(calls.map((c) => c.op)).toEqual([
      { op: "next", stage: "plan" },
      { op: "resolve", stage: "ci", next: "redirect", to: "implement", note: "why", decidedBy: "pane" },
      { op: "hold", stage: "ci", reason: "wait", decidedBy: "pane" },
      { op: "close", workType: "w", stage: "s", outcome: "failed", reason: "r", detailPath: "/d" },
      { op: "budget", key: "k", limit: 3, increment: 0, stage: "ci" },
    ]);
    for (const c of calls) {
      expect(c.env.RT_RUN_DB).toBe(DB);
      expect(c.env.HOME).toBe("/h");
    }
  });
  test("run_resolve passes attempt through and declares it as an integer of at least 1", async () => {
    const { deps, calls } = fakeEngine();
    await tool(deps, "run_resolve").handler({ runDb: DB, stage: "ci", next: "iterate", attempt: 2, decidedBy: "pane" }, RUNS_ROOT_ENV);
    expect(calls[0]!.op).toEqual({ op: "resolve", stage: "ci", next: "iterate", attempt: 2, decidedBy: "pane" });
    const props = (tool(deps, "run_resolve").inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props.attempt).toMatchObject({ type: "integer", minimum: 1 });
    for (const attempt of [0, -1, 1.5, "2"]) {
      const res = await tool(deps, "run_resolve").handler({ runDb: DB, stage: "ci", next: "retry", attempt, decidedBy: "pane" }, RUNS_ROOT_ENV);
      expect(res.ok, String(attempt)).toBe(false);
    }
    expect(calls).toHaveLength(1);
  });
  test("run_enter refuses a stage that is not a single token", async () => {
    const { deps, calls } = fakeEngine();
    for (const stage of ["", " ", "two words", "tab\there", "line\nbreak"]) {
      const res = await tool(deps, "run_enter").handler({ flags: FLAGS, skillDir: SKILL, stage }, RUNS_ROOT_ENV);
      expect(res.ok, JSON.stringify(stage)).toBe(false);
      expect(res.error, JSON.stringify(stage)).toContain("stage");
    }
    expect(calls).toEqual([]);
  });
  test("cwd stands in when runDb is omitted", async () => {
    const { deps, calls } = fakeEngine();
    await tool(deps, "run_next").handler({ cwd: "/tree", stage: "plan" }, { RT_RUN_DB: "/elsewhere/other.db" } as NodeJS.ProcessEnv);
    expect(calls[0]!.cwd).toBe("/tree");
    expect(calls[0]!.env.RT_RUN_DB).toBeUndefined();
  });
  test("a missing required field is refused without calling the engine", async () => {
    const { deps, calls } = fakeEngine();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["run_next", {}],
      ["run_resolve", { next: "done", decidedBy: "d" }],
      ["run_resolve", { stage: "s", decidedBy: "d" }],
      ["run_resolve", { stage: "s", next: "done" }],
      ["run_resolve", { stage: "s", next: "bogus", decidedBy: "d" }],
      ["run_hold", { decidedBy: "d" }],
      ["run_hold", { stage: "s" }],
      ["run_close", { stage: "s", outcome: "done" }],
      ["run_close", { workType: "w", stage: "s", outcome: "bogus" }],
      ["run_budget", { limit: 1 }],
      ["run_budget", { key: "k" }],
      ["run_budget", { key: "k", limit: 1.5 }],
      ["run_budget", { key: "k", limit: 1, increment: "1" }],
    ];
    for (const [name, input] of cases) {
      const res = await tool(deps, name).handler({ runDb: DB, ...input }, RUNS_ROOT_ENV);
      expect(res.ok, `${name} ${JSON.stringify(input)}`).toBe(false);
    }
    expect(calls).toEqual([]);
  });
  test("a runDb outside the runs root, or neither runDb nor cwd, is refused", async () => {
    const { deps, calls } = fakeEngine();
    const inputs: Record<string, Record<string, unknown>> = {
      run_next: { stage: "s" },
      run_resolve: { stage: "s", next: "done", decidedBy: "d" },
      run_hold: { stage: "s", decidedBy: "d" },
      run_close: { workType: "w", stage: "s", outcome: "done" },
      run_budget: { key: "k", limit: 1 },
    };
    for (const [name, input] of Object.entries(inputs)) {
      const outside = await tool(deps, name).handler({ ...input, runDb: "/elsewhere/repo/id/state.db" }, RUNS_ROOT_ENV);
      expect(outside.error, name).toContain("runs root");
      const none = await tool(deps, name).handler(input, RUNS_ROOT_ENV);
      expect(none.error, name).toContain("runDb");
    }
    expect(calls).toEqual([]);
  });
  test("an engine error envelope becomes err(message)", async () => {
    const { deps } = fakeEngine('{"ok":false,"error":"stage ci is not running"}', 2);
    const res = await tool(deps, "run_next").handler({ runDb: DB, stage: "ci" }, RUNS_ROOT_ENV);
    expect(res).toEqual({ ok: false, body: undefined, error: "stage ci is not running" });
  });
  test("an unparseable failure still names the tool's exit", async () => {
    const { deps } = fakeEngine("", 1);
    const res = await tool(deps, "run_budget").handler({ runDb: DB, key: "k", limit: 1 }, RUNS_ROOT_ENV);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("exit 1");
  });
  test("every engine tool is MCP only and says it opens no gate", () => {
    const { deps } = fakeEngine();
    for (const name of ["run_enter", "run_next", "run_resolve", "run_hold", "run_close", "run_budget"]) {
      const t = tool(deps, name);
      expect(t.shellForms, name).toEqual({ none: "MCP only; no rt runs verb" });
      expect(t.description, name).toMatch(/no gate/i);
      expect((t.inputSchema as { additionalProperties: boolean }).additionalProperties, name).toBe(false);
    }
  });
  test("run_list's shell-form note names the six", () => {
    const forms = tool(fakeEngine().deps, "run_list").shellForms as Array<{ note?: string }>;
    for (const name of ["run_enter", "run_next", "run_resolve", "run_hold", "run_close", "run_budget"]) expect(forms[0]!.note).toContain(name);
  });
});

describe("run engine tools against a real run store", () => {
  const bases: string[] = [];
  afterAll(() => { for (const b of bases) rmSync(b, { recursive: true, force: true }); });

  function store(): { root: string; skillDir: string; env: NodeJS.ProcessEnv; deps: RunToolDeps } {
    const base = mkdtempSync(join(tmpdir(), "run-engine-tools-"));
    bases.push(base);
    const root = join(base, "runs");
    const pack = join(base, "pack");
    mkdirSync(join(pack, "skills", "work"), { recursive: true });
    mkdirSync(join(pack, "pack"), { recursive: true });
    writeFileSync(
      join(pack, "pack", "pipelines.json"),
      JSON.stringify({ version: 1, pipelines: { work: [{ stage: "plan", name: "Plan", file: "skills/plan/SKILL.md", consumes: [], produces: ["plan"] }, { stage: "build", name: "Build", file: "skills/build/SKILL.md", consumes: ["plan"], produces: [] }] } }),
    );
    return { root, skillDir: join(pack, "skills", "work"), env: { RT_RUNS_ROOT: root, RT_RUN_EMIT: "0" } as NodeJS.ProcessEnv, deps: { ...realRunToolDeps, isPackRoot: () => true } };
  }
  const FLAGS_DEMO = "--repo demo --work-type work --pipeline work";

  test("run_enter, run_next, run_resolve redirect", async () => {
    const { skillDir, env, deps } = store();
    const entered = await tool(deps, "run_enter").handler({ flags: FLAGS_DEMO, skillDir }, env);
    expect(entered.ok).toBe(true);
    const e = entered.body as { mode: string; runDb: string; stages: string[]; at: { stage: string; attempt: number } };
    expect(e.mode).toBe("started");
    expect(e.stages).toEqual(["plan", "build"]);
    expect(e.at).toMatchObject({ stage: "plan", attempt: 1 });

    const set = await tool(deps, "run_field_set").handler({ runDb: e.runDb, key: "plan", value: "done", stage: "plan" }, env);
    expect(set.ok).toBe(true);
    const next = await tool(deps, "run_next").handler({ runDb: e.runDb, stage: "plan" }, env);
    expect(next.body).toMatchObject({ ok: true, ended: "done", next: { stage: "build", attempt: 1 } });

    const resolved = await tool(deps, "run_resolve").handler({ runDb: e.runDb, stage: "build", next: "redirect", to: "plan", note: "again", decidedBy: "pane" }, env);
    expect(resolved.body).toMatchObject({ ok: true, applied: "redirect", next: { stage: "plan", attempt: 2 } });
  });

  test("run_stage start on a running stage refuses and leaves the attempt running", async () => {
    const { skillDir, env, deps } = store();
    const e = (await tool(deps, "run_enter").handler({ flags: FLAGS_DEMO, skillDir }, env)).body as { runDb: string };
    const res = await tool(deps, "run_stage").handler({ runDb: e.runDb, action: "start", stage: "plan" }, env);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("stage plan attempt 1 is still running; resume it with run_enter");
    const db = new Database(e.runDb, { readonly: true });
    expect(db.query("SELECT attempt, status FROM stages WHERE name = 'plan'").all()).toEqual([{ attempt: 1, status: "running" }]);
    db.close();
  });

  test("a done run: run_hold and run_stage start both refuse until reopen, then both work", async () => {
    const { skillDir, env, deps } = store();
    const e = (await tool(deps, "run_enter").handler({ flags: FLAGS_DEMO, skillDir }, env)).body as { runDb: string };
    await tool(deps, "run_field_set").handler({ runDb: e.runDb, key: "plan", value: "done", stage: "plan" }, env);
    await tool(deps, "run_next").handler({ runDb: e.runDb, stage: "plan" }, env);
    await tool(deps, "run_next").handler({ runDb: e.runDb, stage: "build" }, env);
    expect((await tool(deps, "run_resolve").handler({ runDb: e.runDb, stage: "build", next: "done", decidedBy: "pane" }, env)).body).toMatchObject({ applied: "done" });

    const hold = () => tool(deps, "run_hold").handler({ runDb: e.runDb, stage: "build", reason: "redaction", decidedBy: "pane" }, env);
    const start = (reopen?: boolean) => tool(deps, "run_stage").handler({ runDb: e.runDb, action: "start", stage: "build", ...(reopen === undefined ? {} : { reopen }) }, env);
    expect((await hold()).error).toContain("this run is done; nothing to hold. Reopen a stage on it first with run_stage (action: start, reopen: true)");
    expect((await start()).error).toContain("this run is done; nothing to start. Reopen a stage on it first with run_stage (action: start, reopen: true)");
    expect((await start(true)).ok).toBe(true);
    expect((await hold()).body).toMatchObject({ ok: true, held: true, at: { stage: "build", attempt: 2, status: "running" } });
  });

  test("run_field_set with ifSha256 against a real run: a match writes, a stale hash refuses and keeps the value", async () => {
    const { skillDir, env, deps } = store();
    const e = (await tool(deps, "run_enter").handler({ flags: FLAGS_DEMO, skillDir }, env)).body as { runDb: string };
    const set = (value: string, ifSha256: string) => tool(deps, "run_field_set").handler({ runDb: e.runDb, key: "notes", value, stage: "plan", ifSha256 }, env);
    expect((await set("one", valueSha256(""))).ok).toBe(true);
    const stale = await set("two", valueSha256(""));
    expect(stale.ok).toBe(false);
    expect(isFieldChanged(stale.error ?? "")).toBe(true);
    expect((await set("two", valueSha256("one"))).ok).toBe(true);
    expect((await tool(deps, "run_field_get").handler({ runDb: e.runDb, key: "notes" }, env)).body).toEqual({ value: "two" });
  });

  test("a handed runDb for a running run of the repo is inherited", async () => {
    const { skillDir, env, deps } = store();
    const first = (await tool(deps, "run_enter").handler({ flags: FLAGS_DEMO, skillDir }, env)).body as { runDb: string; runId: string };
    const again = await tool(deps, "run_enter").handler({ flags: FLAGS_DEMO, skillDir, runDb: first.runDb }, env);
    expect(again.body).toMatchObject({ mode: "inherited", runId: first.runId });
  });

  test("a handed runDb that is gone (a pruned parent run) is ignored and the call continues", async () => {
    const { root, skillDir, env, deps } = store();
    const gone = join(root, "demo", "pruned-run", "state.db");
    const res = await tool(deps, "run_enter").handler({ flags: FLAGS_DEMO, skillDir, runDb: gone }, env);
    expect(res.ok).toBe(true);
    expect(res.body).toMatchObject({ mode: "started", handedRunDb: "not-running" });
  });

  test("a gone runDb outside the root or in another repo is still refused", async () => {
    const { root, skillDir, env, deps } = store();
    for (const runDb of [join(root, "..", "elsewhere", "x", "state.db"), join(root, "other", "x", "state.db"), "/nonexistent/x/state.db"]) {
      const res = await tool(deps, "run_enter").handler({ flags: FLAGS_DEMO, skillDir, runDb }, env);
      expect(res.ok, runDb).toBe(false);
      expect(res.error, runDb).toContain("runs root");
    }
  });

  test("a symlink inside the root to another repo's run is refused", async () => {
    const { root, skillDir, env, deps } = store();
    const other = (await tool(deps, "run_enter").handler({ flags: "--repo other --work-type work --pipeline work", skillDir }, env)).body as { runDb: string };
    mkdirSync(join(root, "demo"), { recursive: true });
    symlinkSync(join(other.runDb, ".."), join(root, "demo", "link"));
    const res = await tool(deps, "run_enter").handler({ flags: FLAGS_DEMO, skillDir, runDb: join(root, "demo", "link", "state.db") }, env);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("runs root");
  });
});
