import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { herdToolDefs, type HerdToolDeps } from "../herd-tools.ts";

/** A real directory standing in for the Claude Code temp root -- checkTempRootPath realpaths the parent, so the root must actually exist on disk. */
const FAKE_TEMP_ROOT = realpathSync(mkdtempSync(join(tmpdir(), "rt-herd-brief-out-")));
/** Stands in for an installed plugin root; the read guard realpaths each file, so they must exist. */
const FAKE_PLUGIN_ROOT = realpathSync(mkdtempSync(join(tmpdir(), "rt-herd-brief-plugin-")));
const OUTSIDE = realpathSync(mkdtempSync(join(tmpdir(), "rt-herd-brief-outside-")));
const TEMPLATE = join(FAKE_PLUGIN_ROOT, "job-template.md");
const STRATEGIES = join(FAKE_PLUGIN_ROOT, "strategies.md");
const METHOD = join(FAKE_TEMP_ROOT, "method.md");
const SECRET = join(OUTSIDE, "id_ed25519");
const ESCAPE_LINK = join(FAKE_PLUGIN_ROOT, "escape.md");
const BRIEF = join(FAKE_TEMP_ROOT, "brief.md");
const BRIEF_BODY = "# Job j\n\nShip the widget.\n";
const OUTSIDE_MD = join(OUTSIDE, "notes.md");
const DASH_BRIEF = join(FAKE_TEMP_ROOT, "dash-brief.md");
for (const f of [TEMPLATE, STRATEGIES, METHOD, OUTSIDE_MD]) writeFileSync(f, "body");
writeFileSync(BRIEF, BRIEF_BODY);
writeFileSync(SECRET, "PRIVATE KEY");
symlinkSync(SECRET, ESCAPE_LINK);

afterAll(() => {
  for (const dir of [FAKE_TEMP_ROOT, FAKE_PLUGIN_ROOT, OUTSIDE]) rmSync(dir, { recursive: true, force: true });
});

const GATE_ROW = { id: "g1", questions: [{ id: "next", label: "Next?", multi: false, options: [{ value: "ship", label: "Ship" }, "hold"] }, { id: "free", label: "Notes", multi: false, options: [] }] };

function fake(opts: { statusError?: string; statusData?: unknown; pluginListError?: string; answerResult?: unknown; parkedGate?: boolean; gatesError?: string } = {}) {
  const tempRoots = [FAKE_TEMP_ROOT];
  // A failed plugin listing leaves only the temp root, as the real resolver does.
  const readRoots = opts.pluginListError
    ? { roots: [FAKE_TEMP_ROOT], pluginListError: opts.pluginListError }
    : { roots: [FAKE_TEMP_ROOT, FAKE_PLUGIN_ROOT] };
  const calls: Array<{ fn: string; a: any; o: any }> = [];
  const rec = (fn: string) => (async (a: unknown, o: unknown) => { calls.push({ fn, a, o }); return { ok: true, data: { fn } }; }) as any;
  const status = (async (a: { herd: string }) => {
    calls.push({ fn: "status", a, o: undefined });
    if (opts.statusError) return { ok: false, error: opts.statusError };
    if (opts.statusData !== undefined) return { ok: true, data: opts.statusData };
    return { ok: true, data: { herd: { id: a.herd, shepherdSession: "s1" }, jobs: [] } };
  }) as any;
  const deps: HerdToolDeps = {
    start: rec("start"), spawn: rec("spawn"), close: rec("close"), followUp: rec("followUp"), status, list: rec("list"),
    attend: rec("attend"), wrapUp: rec("wrapUp"), resume: rec("resume"), milestone: rec("milestone"),
    respawn: rec("respawn"), diagnose: rec("diagnose"), nudge: rec("nudge"), lanes: rec("lanes"), park: rec("park"),
    gates: (async (a: { includeParked?: boolean }) => {
      calls.push({ fn: "gates", a, o: undefined });
      if (opts.gatesError) return { ok: false, error: opts.gatesError };
      return { ok: true, data: { gates: opts.parkedGate && !a.includeParked ? [] : [GATE_ROW] } };
    }) as any,
    answer: (async (a: any, o: unknown) => {
      calls.push({ fn: "answer", a, o });
      return opts.answerResult ?? { ok: true, data: { row: { ...GATE_ROW, answer: { answers: a.answers, by: a.by, answeredAt: 1 } } } };
    }) as any,
    verb: (async (input: unknown) => { calls.push({ fn: "verb", a: input, o: undefined }); return { ok: true, body: { brief: "x" } }; }) as any,
    tempRoots: () => tempRoots,
    readRoots: () => readRoots,
  };
  const destructive = () => calls.filter((c) => ["spawn", "close", "followUp", "wrapUp", "resume", "attend", "respawn", "diagnose", "nudge", "lanes", "answer", "park"].includes(c.fn));
  return { calls, destructive, tool: (n: string) => herdToolDefs(deps).find((t) => t.name === n)! };
}
const tool0 = (n: string) => fake().tool(n);
const SESSION = { CLAUDE_CODE_SESSION_ID: "s1", HERDR_PANE_ID: "p1", HERDR_WORKSPACE_ID: "w1" } as NodeJS.ProcessEnv;
const WORKER = { ...SESSION, HERD_ID: "hd-1", HERD_JOB: "j" } as NodeJS.ProcessEnv;
const OTHER_SESSION = { ...SESSION, CLAUDE_CODE_SESSION_ID: "s2" } as NodeJS.ProcessEnv;
const NO_SESSION_ENV = { HERDR_PANE_ID: "p1" } as NodeJS.ProcessEnv;

const SHEPHERD_ONLY: Array<[string, Record<string, unknown>]> = [
  ["herd_spawn", { herd: "hd-1", job: "j" }],
  ["herd_close", { herd: "hd-1", job: "j" }],
  ["herd_follow_up", { herd: "hd-1", job: "j" }],
  ["herd_wrap_up", { herd: "hd-1", closePanes: true }],
  ["herd_attend", { herd: "hd-1", job: "j" }],
  ["herd_respawn", { herd: "hd-1", job: "j" }],
  ["herd_gate_answer", { herd: "hd-1", gate: "g1", answers: { next: "ship", free: "anything" } }],
  ["herd_gate_park", { herd: "hd-1", gate: "g1" }],
  ["herd_diagnose", { herd: "hd-1", job: "j" }],
  ["herd_nudge", { herd: "hd-1", job: "j", gate: "g1" }],
  ["herd_lanes", { herd: "hd-1" }],
];
const NEW_TOOLS = ["herd_respawn", "herd_gate_answer", "herd_gate_park", "herd_diagnose", "herd_nudge", "herd_lanes"];

describe("herd tools refuse a caller that does not own the herd", () => {
  test("herd_spawn, herd_close, herd_follow_up, herd_wrap_up, herd_attend and herd_resume refuse in a worker pane, with zero daemon calls", async () => {
    for (const [name, input] of [...SHEPHERD_ONLY, ["herd_resume", { herd: "hd-1" }] as [string, Record<string, unknown>]]) {
      const { tool, calls } = fake();
      const r = await tool(name).handler(input, WORKER);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("HERD_JOB");
      expect(calls, name).toEqual([]);
    }
  });

  test("herd_spawn, herd_close, herd_follow_up, herd_wrap_up and herd_attend refuse without a Claude Code session, with zero destructive calls", async () => {
    for (const [name, input] of SHEPHERD_ONLY) {
      const { tool, destructive } = fake();
      const r = await tool(name).handler(input, NO_SESSION_ENV);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("CLAUDE_CODE_SESSION_ID");
      expect(destructive(), name).toEqual([]);
    }
  });

  test("herd_spawn, herd_close, herd_follow_up, herd_wrap_up and herd_attend refuse a session that is not the herd's shepherd, with zero destructive calls", async () => {
    for (const [name, input] of SHEPHERD_ONLY) {
      const { tool, destructive } = fake();
      const r = await tool(name).handler(input, OTHER_SESSION);
      expect(r.ok, name).toBe(false);
      expect(r.error, name).toContain("not the shepherd");
      expect(r.error, name).toContain("herd_resume");
      expect(destructive(), name).toEqual([]);
    }
  });

  test("herd_spawn, herd_close, herd_follow_up, herd_wrap_up and herd_attend run for the herd's own shepherd session", async () => {
    for (const [name, input] of SHEPHERD_ONLY) {
      const { tool, destructive } = fake();
      const r = await tool(name).handler(input, SESSION);
      expect(r.ok, name).toBe(true);
      expect(destructive().length, name).toBe(1);
    }
  });

  test("an unknown herd surfaces the status error and runs nothing destructive", async () => {
    const { tool, destructive } = fake({ statusError: 'unknown herd "hd-x"' });
    const r = await tool("herd_close").handler({ herd: "hd-x", job: "j" }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown herd");
    expect(destructive()).toEqual([]);
  });

  test("herd_follow_up sends the herd and job to the daemon verb", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_follow_up").handler({ herd: "hd-1", job: "j" }, SESSION);
    expect(r.ok).toBe(true);
    expect(calls.find((c) => c.fn === "followUp")!.a).toEqual({ herd: "hd-1", job: "j" });
  });

  test("herd_resume stays open to a session that is not the current shepherd, so a new session can take over", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_resume").handler({ herd: "hd-1" }, OTHER_SESSION);
    expect(r.ok).toBe(true);
    expect(calls.find((c) => c.fn === "resume")!.a).toMatchObject({ herd: "hd-1", session: "s2" });
  });

  test("herd_wrap_up requires herd, even with HERD_ID set", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_wrap_up").handler({ closePanes: true }, { ...SESSION, HERD_ID: "hd-1" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("herd");
    expect(calls).toEqual([]);
    expect(tool("herd_wrap_up").inputSchema.required).toEqual(["herd"]);
  });
});

describe("herd shepherd tools", () => {
  test("herd_start uses the session and pane from env", async () => {
    const { tool, calls } = fake();
    await tool("herd_start").handler({ name: "n", repo: "remote:gitlab.com%2Facme%2Facme-dev" }, SESSION);
    expect(calls[0]!.a).toMatchObject({ name: "n", session: "s1", callerPane: "p1" });
  });
  test("herd_start without a session errors", async () => {
    const { tool } = fake();
    const r = await tool("herd_start").handler({ name: "n", repo: "remote:gitlab.com%2Facme%2Facme-dev" }, {} as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
  });
  test("herd_start refuses in a worker pane, before resolving the repo or calling the daemon", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_start").handler({ name: "n", repo: "remote:gitlab.com%2Fexample%2Fapp" }, WORKER);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("HERD_JOB");
    expect(calls).toEqual([]);
  });
  test("herd_spawn passes every option and a minutes-long timeout, sending the brief file's CONTENTS, not its path", async () => {
    const { tool, destructive } = fake();
    await tool("herd_spawn").handler({ herd: "hd-1", job: "j", brief: BRIEF, model: "opus", effort: "high", account: "a", disposable: true }, SESSION);
    expect(destructive()[0]!.a).toEqual({ herd: "hd-1", job: "j", brief: BRIEF_BODY, model: "opus", effort: "high", account: "a", disposable: true });
    expect(destructive()[0]!.o.timeoutMs).toBeGreaterThanOrEqual(180_000);
  });
  test("herd_spawn refuses a brief outside every read root, with zero daemon calls", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j", brief: OUTSIDE_MD }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("brief: ");
    expect(r.error).toContain("plugin or pack root");
    expect(calls).toEqual([]);
  });
  test("herd_spawn refuses a relative or non-normalized brief path, with zero daemon calls", async () => {
    for (const [brief, cause] of [["brief.md", "absolute"], [`${FAKE_TEMP_ROOT}/sub/../brief.md`, "normalized"], [`${FAKE_TEMP_ROOT}/./brief.md`, "normalized"]]) {
      const { tool, calls } = fake();
      const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j", brief }, SESSION);
      expect(r.ok, brief).toBe(false);
      expect(r.error, brief).toContain(cause);
      expect(calls, brief).toEqual([]);
    }
  });
  test("herd_spawn refuses a brief whose content starts with a dash (it would be parsed as a claude option), with zero daemon calls", async () => {
    for (const body of ["--settings={}\n", "  \n\t--dangerously-skip-permissions\n# JOB"]) {
      writeFileSync(DASH_BRIEF, body);
      const { tool, calls } = fake();
      const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j", brief: DASH_BRIEF }, SESSION);
      expect(r.ok, JSON.stringify(body)).toBe(false);
      expect(r.error).toContain("must not start with");
      expect(calls).toEqual([]);
    }
  });
  test("herd_spawn passes a brief that opens with a heading", async () => {
    writeFileSync(DASH_BRIEF, "# JOB\n\n- first bullet\n");
    const { tool, destructive } = fake();
    const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j", brief: DASH_BRIEF }, SESSION);
    expect(r.ok).toBe(true);
    expect(destructive()[0]!.a.brief).toBe("# JOB\n\n- first bullet\n");
  });
  test("herd_spawn refuses dir outright, so it never reaches the payload", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j", dir: FAKE_TEMP_ROOT }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("dir");
    expect(calls).toEqual([]);
    const schema = tool("herd_spawn").inputSchema as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(schema.properties.dir).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
  });
  test("herd_spawn refuses an account, model or effort that is not a plain token, with zero daemon calls", async () => {
    for (const [k, v] of [["account", "--help"], ["model", "-x"], ["effort", "high --dangerously-skip-permissions"], ["model", ""], ["account", "a/b"]] as const) {
      const { tool, calls } = fake();
      const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j", [k]: v }, SESSION);
      expect(r.ok, `${k}=${v}`).toBe(false);
      expect(r.error, `${k}=${v}`).toContain(k);
      expect(calls, `${k}=${v}`).toEqual([]);
    }
  });
  test("herd_spawn passes plain-token account, model and effort values", async () => {
    const { tool, destructive } = fake();
    const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j", account: "matt@acme.com", model: "claude-opus-4-6[1m]", effort: "high" }, SESSION);
    expect(r.ok).toBe(true);
    expect(destructive()[0]!.a).toMatchObject({ account: "matt@acme.com", model: "claude-opus-4-6[1m]", effort: "high" });
  });
  test("herd_spawn's description says brief is a path whose contents become the prompt", () => {
    const { tool } = fake();
    const d = tool("herd_spawn").description;
    expect(d).toContain("brief is an absolute path");
    expect(d).toContain("its contents");
  });
  test("a status reply with no herd in it refuses rather than throwing, with zero destructive calls", async () => {
    const { tool, destructive } = fake({ statusData: {} });
    const r = await tool("herd_close").handler({ herd: "hd-1", job: "j" }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not the shepherd");
    expect(destructive()).toEqual([]);
  });
  test("herd_brief surfaces a failed plugin listing as the cause, calling the verb runner zero times", async () => {
    const { tool, calls } = fake({ pluginListError: "claude plugin list timed out after 10s" });
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, methodFile: METHOD }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("installed plugins could not be listed (claude plugin list timed out after 10s)");
    expect(calls).toEqual([]);
  });
  test("herd_brief's description names every path confinement", () => {
    const { tool } = fake();
    const d = tool("herd_brief").description;
    expect(d).toContain("out must be an absolute path inside the Claude Code temp root");
    expect(d).toContain("template, strategies and methodFile must be absolute paths inside the Claude Code temp root or an installed plugin or pack root");
  });
  test("herd defaults to HERD_ID when omitted", async () => {
    const { tool, calls } = fake();
    await tool("herd_status").handler({}, { HERD_ID: "hd-9" } as NodeJS.ProcessEnv);
    expect(calls[0]!.a).toEqual({ herd: "hd-9" });
  });
  test("herd_brief spawns rt herd brief through the verb runner with repeated --fill", async () => {
    const { tool, calls } = fake();
    const out = join(FAKE_TEMP_ROOT, "o.md");
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, strategy: "direct-tdd", strategies: STRATEGIES, fill: ["goal=ship", "fence=src/"], out }, SESSION);
    expect(r.ok).toBe(true);
    expect(calls[0]!.a).toEqual({ args: ["herd", "brief", "--job", "j", "--template", TEMPLATE, "--strategy", "direct-tdd", "--strategies", STRATEGIES, "--fill", "goal=ship", "--fill", "fence=src/", "--out", out] });
  });

  test("herd_brief passes a methodFile inside the temp root through", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, methodFile: METHOD }, SESSION);
    expect(r.ok).toBe(true);
    expect(calls[0]!.a).toEqual({ args: ["herd", "brief", "--job", "j", "--template", TEMPLATE, "--method-file", METHOD] });
  });

  test("herd_brief refuses an out path outside the Claude Code temp root, calling the verb runner zero times", async () => {
    const { tool, calls } = fake();
    const out = join(realpathSync(homedir()), ".zshrc");
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, methodFile: METHOD, out }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("temp root");
    expect(calls).toEqual([]);
  });

  test("herd_brief refuses a relative out path, calling the verb runner zero times", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, methodFile: METHOD, out: "relative/brief.md" }, SESSION);
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  test("herd_brief refuses a template, strategies or methodFile outside every read root, calling the verb runner zero times", async () => {
    for (const input of [
      { job: "j", template: SECRET, methodFile: METHOD },
      { job: "j", template: TEMPLATE, strategy: "direct-tdd", strategies: SECRET },
      { job: "j", template: TEMPLATE, methodFile: SECRET },
    ]) {
      const { tool, calls } = fake();
      const r = await tool("herd_brief").handler(input, SESSION);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      expect(r.error).toContain("plugin or pack root");
      expect(calls).toEqual([]);
    }
  });

  test("herd_brief refuses a relative template, calling the verb runner zero times", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: "job-template.md", methodFile: METHOD }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("absolute");
    expect(calls).toEqual([]);
  });

  test("herd_brief refuses a methodFile symlinked inside a read root to a file outside, calling the verb runner zero times", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_brief").handler({ job: "j", template: TEMPLATE, methodFile: ESCAPE_LINK }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("plugin or pack root");
    expect(calls).toEqual([]);
  });
  test("herd_attend needs HERDR_WORKSPACE_ID", async () => {
    const { tool, destructive } = fake();
    const r = await tool("herd_attend").handler({ herd: "hd-1", job: "j" }, { CLAUDE_CODE_SESSION_ID: "s1" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("HERDR_WORKSPACE_ID");
    expect(destructive()).toEqual([]);
    await tool("herd_attend").handler({ herd: "hd-1", job: "j" }, SESSION);
    expect(destructive()[0]!.a).toEqual({ herd: "hd-1", job: "j", callerWorkspace: "w1" });
  });
  test("herd_wrap_up forwards the wrap-up form's answers", async () => {
    const { tool, destructive } = fake();
    await tool("herd_wrap_up").handler({ herd: "hd-1", closePanes: true, dispose: ["t1"], deleteJobDirs: false, archiveRoom: true }, SESSION);
    expect(destructive()[0]!.a).toEqual({ herd: "hd-1", closePanes: true, dispose: ["t1"], deleteJobDirs: false, archiveRoom: true });
  });
  test("herd_resume passes the session", async () => {
    const { tool, calls } = fake();
    await tool("herd_resume").handler({ herd: "hd-1" }, SESSION);
    expect(calls[0]!.a).toMatchObject({ herd: "hd-1", session: "s1", callerPane: "p1" });
  });
});

describe("herd respawn, gate answer and park, diagnose, nudge, lanes", () => {
  test("herd_respawn passes inherited-free payload", async () => {
    const { tool, destructive } = fake();
    const r = await tool("herd_respawn").handler({ herd: "hd-1", job: "j", brief: BRIEF, model: "opus" }, SESSION);
    expect(r.ok).toBe(true);
    expect(destructive()[0]!.a).toEqual({ herd: "hd-1", job: "j", brief: BRIEF_BODY, model: "opus" });
    expect(destructive()[0]!.o.timeoutMs).toBeGreaterThanOrEqual(180_000);
    const schema = tool("herd_respawn").inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties.dir).toBeUndefined();
  });
  test("herd_respawn refuses a stray dir with zero daemon calls", async () => {
    const { tool, calls } = fake();
    const r = await tool("herd_respawn").handler({ herd: "hd-1", job: "j", dir: FAKE_TEMP_ROOT }, SESSION);
    expect(r).toMatchObject({ ok: false, error: "dir is not accepted: herd_respawn reuses the job's own worktree" });
    expect(calls).toEqual([]);
  });
  test("only the gate answer and park tools name the shepherd's gate lines as their missing CLI twin", () => {
    const reason = (name: string) => (tool0(name).shellForms as { none: string }).none;
    for (const name of ["herd_gate_answer", "herd_gate_park"]) expect(reason(name)).toContain("rt gate answer --by shepherd");
    for (const name of ["herd_respawn", "herd_diagnose", "herd_nudge", "herd_lanes"]) {
      expect(reason(name)).not.toContain("rt gate");
      expect(reason(name)).toContain("no CLI twin");
    }
  });
  test("herd_spawn's rt-herd note lists the six newer herd tools", () => {
    const forms = tool0("herd_spawn").shellForms as Array<string | { id: string; note?: string }>;
    const note = forms.find((f): f is { id: string; note?: string } => typeof f !== "string" && f.id === "rt-herd")!.note!;
    for (const name of NEW_TOOLS) expect(note).toContain(name);
  });
  test("herd_spawn's description names the reviewerRound a guest spawn returns", () => {
    expect(tool0("herd_spawn").description).toContain("reviewerRound");
  });
  test("herd_respawn keeps herd_spawn's brief confinement, dash check and token check, with zero daemon calls", async () => {
    writeFileSync(DASH_BRIEF, "--settings={}\n");
    for (const input of [{ brief: OUTSIDE_MD }, { brief: DASH_BRIEF }, { account: "--help" }]) {
      const { tool, calls } = fake();
      const r = await tool("herd_respawn").handler({ herd: "hd-1", job: "j", ...input }, SESSION);
      expect(r.ok, JSON.stringify(input)).toBe(false);
      expect(calls, JSON.stringify(input)).toEqual([]);
    }
  });
  test("herd_spawn passes tree through", async () => {
    const { tool, destructive } = fake();
    const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j", tree: "denethor" }, SESSION);
    expect(r.ok).toBe(true);
    expect(destructive()[0]!.a).toEqual({ herd: "hd-1", job: "j", tree: "denethor" });
    expect(tool("herd_spawn").description).toContain("tree");
  });
  test("herd_spawn refuses an existing job with a worktree and no tree", async () => {
    const worktree = join(FAKE_TEMP_ROOT, "wt-j");
    mkdirSync(worktree, { recursive: true });
    const statusData = { herd: { id: "hd-1", shepherdSession: "s1" }, jobs: [{ name: "j", worktree }] };
    const { tool, destructive, calls } = fake({ statusData });
    const r = await tool("herd_spawn").handler({ herd: "hd-1", job: "j" }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('job "j" already has a worktree; respawn it with herd_respawn');
    expect(destructive()).toEqual([]);
    expect(calls.filter((c) => c.fn === "status").length).toBe(1);
    const gone = fake({ statusData: { ...statusData, jobs: [{ name: "j", worktree: join(FAKE_TEMP_ROOT, "never-made") }] } });
    expect((await gone.tool("herd_spawn").handler({ herd: "hd-1", job: "j" }, SESSION)).ok).toBe(true);
    const withTree = fake({ statusData });
    expect((await withTree.tool("herd_spawn").handler({ herd: "hd-1", job: "j", tree: "t" }, SESSION)).ok).toBe(true);
  });
  test("herd_gate_answer refuses a gate outside this herd", async () => {
    const { tool, destructive } = fake();
    const r = await tool("herd_gate_answer").handler({ herd: "hd-1", gate: "g-other", answers: { next: "ship" } }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("g-other");
    expect(destructive()).toEqual([]);
  });
  test("herd_gate_answer admits a parked gate of this herd; herd_gate_park does not list parked gates", async () => {
    const answering = fake({ parkedGate: true });
    const r = await answering.tool("herd_gate_answer").handler({ herd: "hd-1", gate: "g1", answers: { next: "ship", free: "x" } }, SESSION);
    expect(r.body).toMatchObject({ status: "recorded", gate: "g1" });
    expect(answering.calls.find((c) => c.fn === "gates")!.a).toEqual({ herd: "hd-1", includeParked: true });
    const other = await answering.tool("herd_gate_answer").handler({ herd: "hd-1", gate: "g-other", answers: { next: "ship" } }, SESSION);
    expect(other.ok).toBe(false);
    const parking = fake({ parkedGate: true });
    const p = await parking.tool("herd_gate_park").handler({ herd: "hd-1", gate: "g1" }, SESSION);
    expect(p.ok).toBe(false);
    expect(parking.calls.find((c) => c.fn === "gates")!.a).toEqual({ herd: "hd-1" });
    expect(parking.destructive()).toEqual([]);
  });
  test("herd_gate_answer returns a failed gate listing's error and never calls answer", async () => {
    const { tool, destructive } = fake({ gatesError: "gates store unavailable" });
    const r = await tool("herd_gate_answer").handler({ herd: "hd-1", gate: "g1", answers: { next: "ship", free: "x" } }, SESSION);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("gates store unavailable");
    expect(destructive()).toEqual([]);
  });
  test("herd_gate_answer returns refused with validValues for a bad value and never calls answer", async () => {
    const { tool, destructive } = fake();
    const r = await tool("herd_gate_answer").handler({ herd: "hd-1", gate: "g1", answers: { next: "yolo", free: "ok" } }, SESSION);
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({ status: "refused", invalid: [{ question: "next", got: "yolo", validValues: ["ship", "hold"] }] });
    expect(destructive()).toEqual([]);
  });
  test("herd_gate_answer reports a missing answer and an unknown question as invalid", async () => {
    const { tool, destructive } = fake();
    const r = await tool("herd_gate_answer").handler({ herd: "hd-1", gate: "g1", answers: { free: "ok", bogus: "x" } }, SESSION);
    expect(r.body).toEqual({ status: "refused", invalid: [{ question: "next", got: null, validValues: ["ship", "hold"] }, { question: "bogus", got: "x", validValues: [] }] });
    expect(destructive()).toEqual([]);
  });
  test("herd_gate_answer records by shepherd with this session", async () => {
    const { tool, calls } = fake();
    const answers = { next: { value: "ship", note: "go" }, free: "anything" };
    const r = await tool("herd_gate_answer").handler({ herd: "hd-1", gate: "g1", answers }, SESSION);
    expect(calls.find((c) => c.fn === "answer")!.a).toEqual({ id: "g1", answers, by: "shepherd", session: "s1" });
    expect(r.body).toEqual({ status: "recorded", gate: "g1", answer: { answers, by: "shepherd", answeredAt: 1 } });
  });
  test("herd_gate_answer reports a conflict winner", async () => {
    const winner = { answers: { next: "hold", free: "human said" }, by: "human", answeredAt: 2 };
    const { tool } = fake({ answerResult: { ok: true, data: { row: { ...GATE_ROW, answer: winner }, conflict: true } } });
    const r = await tool("herd_gate_answer").handler({ herd: "hd-1", gate: "g1", answers: { next: "ship", free: "x" } }, SESSION);
    expect(r.ok).toBe(true);
    expect(r.body).toEqual({ status: "conflict", winner: { answers: winner.answers, by: "human" } });
  });
  test("herd_gate_answer keeps gate_answer's closed, owned-by and not-found wording, without override advice", async () => {
    const cases: Array<[unknown, string]> = [
      [{ ok: false, error: "gate-closed", reason: "superseded", supersededBy: "g2" }, "gate g1 is closed (superseded); superseded by g2"],
      [{ ok: false, error: "owned-by", owner: "pane:p9" }, "gate g1 is owned by pane:p9"],
      [{ ok: false, error: "not-found" }, "no gate g1"],
    ];
    for (const [answerResult, message] of cases) {
      const { tool } = fake({ answerResult });
      const r = await tool("herd_gate_answer").handler({ herd: "hd-1", gate: "g1", answers: { next: "ship", free: "x" } }, SESSION);
      expect(r.ok).toBe(false);
      expect(r.error).toBe(message);
    }
  });
  test("herd_gate_answer has no override property in its schema", () => {
    const { tool } = fake();
    const schema = tool("herd_gate_answer").inputSchema as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(schema.properties.override).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
  });
  test("herd_gate_park refuses a gate outside this herd and parks one inside", async () => {
    const outside = fake();
    const r1 = await outside.tool("herd_gate_park").handler({ herd: "hd-1", gate: "g-other" }, SESSION);
    expect(r1.ok).toBe(false);
    expect(outside.destructive()).toEqual([]);
    const inside = fake();
    const r2 = await inside.tool("herd_gate_park").handler({ herd: "hd-1", gate: "g1" }, SESSION);
    expect(r2.body).toEqual({ status: "parked", gate: "g1" });
    expect(inside.calls.find((c) => c.fn === "park")!.a).toEqual({ id: "g1" });
  });
  test("herd_diagnose, herd_nudge and herd_lanes send the herd and their inputs to the verb", async () => {
    const { tool, destructive } = fake();
    await tool("herd_diagnose").handler({ herd: "hd-1", job: "j" }, SESSION);
    await tool("herd_nudge").handler({ herd: "hd-1", job: "j", gate: "g1" }, SESSION);
    await tool("herd_lanes").handler({ herd: "hd-1" }, SESSION);
    await tool("herd_lanes").handler({ herd: "hd-1", job: "j" }, SESSION);
    expect(destructive().map((c) => [c.fn, c.a])).toEqual([
      ["diagnose", { herd: "hd-1", job: "j" }],
      ["nudge", { herd: "hd-1", job: "j", gate: "g1" }],
      ["lanes", { herd: "hd-1" }],
      ["lanes", { herd: "hd-1", job: "j" }],
    ]);
  });
  test("every new tool declares shellForms none", () => {
    const { tool } = fake();
    for (const name of NEW_TOOLS) {
      const forms = tool(name).shellForms as { none?: string };
      expect(Array.isArray(forms), name).toBe(false);
      expect((forms.none ?? "").length, name).toBeGreaterThan(0);
    }
  });
});

describe("herd_milestone", () => {
  test("uses the worker env and passes artifact and summary", async () => {
    const { tool, calls } = fake();
    await tool("herd_milestone").handler({ artifact: "/a.md", summary: "done" }, { ...SESSION, HERD_ID: "hd-1", HERD_JOB: "j" } as NodeJS.ProcessEnv);
    expect(calls[0]!.a).toMatchObject({ herd: "hd-1", job: "j", session: "s1", pane: "p1", artifact: "/a.md", summary: "done" });
  });
  test("outside a worker pane it errors with the worker-pane text", async () => {
    const { tool } = fake();
    const r = await tool("herd_milestone").handler({ artifact: "/a.md" }, {} as NodeJS.ProcessEnv);
    expect(r.error).toContain("HERD_ID and HERD_JOB are not set");
  });
});

describe("gate tool shell notes", () => {
  test("herd_gate_answer and herd_gate_park name no skill as still on Bash", () => {
    for (const name of ["herd_gate_answer", "herd_gate_park"]) {
      const note = JSON.stringify(tool0(name).shellForms);
      expect(note).not.toContain("until the skill moves");
      expect(note).not.toContain("stay on Bash");
    }
  });
});
