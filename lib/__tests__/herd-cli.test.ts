import { describe, test, expect, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildAskPayload, buildBriefInputs, buildSpawnPayload, buildWrapUpPayload, brief, jobEnv, renderAnswer, renderHerdRow, renderResumed, renderStatus, soleHerdId, withCallerAccount, workerEnv } from "../../commands/herd.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import type { Commands, HerdListRow, HerdStatusData } from "../../packages/rt-client/src/index.ts";

async function run(fn: (args: string[]) => Promise<void>, args: string[]) {
  const io = captureOut({ console: true });
  out.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit sentinel"); });
  let code = 0;
  try {
    await fn(args);
  } catch (e) {
    if (e instanceof Error && e.message === "process.exit sentinel") code = (exitSpy.mock.calls.at(-1)?.[0] as number | undefined) ?? 1;
    else throw e;
  } finally {
    exitSpy.mockRestore();
    io.restore();
  }
  return { code, stdout: io.stdout().replace(/\n$/, ""), stderr: io.stderr().replace(/\n$/, "") };
}

describe("rt herd payload builders", () => {
  test("workerEnv reads HERD_ID, HERD_JOB, CLAUDE_CODE_SESSION_ID, HERDR_PANE_ID", () => {
    expect(workerEnv({ HERD_ID: "h", HERD_JOB: "j", CLAUDE_CODE_SESSION_ID: "s", HERDR_PANE_ID: "p" })).toEqual({ herd: "h", job: "j", session: "s", pane: "p" });
    expect(() => workerEnv({})).toThrow(/HERD_ID/);
  });

  test("buildAskPayload parses --questions JSON and carries --context", () => {
    const p = buildAskPayload(["--questions", '[{"id":"q","label":"?","multi":false,"options":["a"]}]', "--context", "why"], { HERD_ID: "h", HERD_JOB: "j", CLAUDE_CODE_SESSION_ID: "s" });
    expect(p).toMatchObject({ herd: "h", job: "j", session: "s", context: "why" });
    expect(p.questions).toHaveLength(1);
    expect(() => buildAskPayload(["--questions", "nope"], { HERD_ID: "h", HERD_JOB: "j", CLAUDE_CODE_SESSION_ID: "s" })).toThrow(/JSON/);
  });

  test("buildSpawnPayload reads the brief file", () => {
    const dir = require("os").tmpdir();
    const file = require("path").join(dir, `brief-${process.pid}.md`);
    require("fs").writeFileSync(file, "# brief");
    const p = buildSpawnPayload(["--herd", "h", "--job", "job-a", "--brief", file, "--model", "opus"]);
    expect(p).toMatchObject({ herd: "h", job: "job-a", brief: "# brief", model: "opus" });
  });

  test("withCallerAccount fills a missing account from the caller's cswap account", async () => {
    const resolve = async () => "alex@acme.test";
    expect(await withCallerAccount({ herd: "h", job: "j" }, resolve)).toEqual({ herd: "h", job: "j", account: "alex@acme.test" });
  });

  test("withCallerAccount keeps an explicit --account and never asks cswap", async () => {
    let asked = false;
    const resolve = async () => { asked = true; return "alex@acme.test"; };
    expect(await withCallerAccount({ herd: "h", job: "j", account: "other@example.com" }, resolve)).toEqual({ herd: "h", job: "j", account: "other@example.com" });
    expect(asked).toBe(false);
  });

  test("withCallerAccount leaves the payload alone when the caller has no cswap account", async () => {
    expect(await withCallerAccount({ herd: "h", job: "j" }, async () => undefined)).toEqual({ herd: "h", job: "j" });
  });

  test("buildSpawnPayload: --harness is the user's explicit assignment and carries the options; --mode rides beside it", () => {
    expect(buildSpawnPayload(["--herd", "h", "--job", "j", "--harness", "codex", "--model", "gpt-5.1", "--mode", "headless"]))
      .toEqual({ herd: "h", job: "j", assignment: { harness: "codex", model: "gpt-5.1" }, mode: "headless" });
    expect(() => buildSpawnPayload(["--herd", "h", "--job", "j", "--mode", "tmux"])).toThrow("--mode must be herdr or headless");
  });

  test("withCallerAccount with integrations on fills the account only for a spawn that names Claude Code", async () => {
    const resolve = async () => "alex@acme.test";
    const on = () => true;
    expect(await withCallerAccount({ herd: "h", job: "j" }, resolve, on)).toEqual({ herd: "h", job: "j" });
    expect(await withCallerAccount({ herd: "h", job: "j", assignment: { harness: "codex" } }, resolve, on)).toEqual({ herd: "h", job: "j", assignment: { harness: "codex" } });
    expect(await withCallerAccount({ herd: "h", job: "j", assignment: { harness: "claude" } }, resolve, on))
      .toEqual({ herd: "h", job: "j", assignment: { harness: "claude", account: "alex@acme.test" } });
  });

  test("buildWrapUpPayload collects repeated --dispose values and booleans", () => {
    expect(buildWrapUpPayload(["h-1", "--close-panes", "--dispose", "a", "--dispose", "b", "--archive-room"])).toEqual({ herd: "h-1", closePanes: true, dispose: ["a", "b"], deleteJobDirs: false, archiveRoom: true });
  });

  test("jobEnv needs the job identity only, not a session", () => {
    expect(jobEnv({ HERD_ID: "h", HERD_JOB: "j" })).toEqual({ herd: "h", job: "j" });
    expect(() => jobEnv({ HERD_JOB: "j" })).toThrow(/HERD_ID/);
  });
});

describe("rt herd list", () => {
  const row = (over: Partial<HerdListRow> = {}): HerdListRow => ({
    id: "hd-1", repo: "r", room: "herd-hd-1", workspace: "w", shepherdSession: "s", shepherdHandle: "shep", shepherdName: "shep",
    herdrSocket: null, hidden: false, status: "active", createdAt: 0, wrappedAt: null, jobs: 2, ...over,
  });

  test("a row carries the id, status, room and job count", () => {
    expect(renderHerdRow(row())).toBe("hd-1  active  room herd-hd-1  2 jobs");
    expect(renderHerdRow(row({ jobs: 1 }))).toBe("hd-1  active  room herd-hd-1  1 job");
    expect(renderHerdRow(row({ jobs: 0 }))).toBe("hd-1  active  room herd-hd-1  0 jobs");
  });

  test("exactly one herd is the fallback; zero or two are not", () => {
    expect(soleHerdId([row()])).toBe("hd-1");
    expect(soleHerdId([])).toBeNull();
    expect(soleHerdId([row(), row({ id: "hd-2" })])).toBeNull();
  });
});

function answerData(over: Partial<Commands["herd:answer"]["data"]>): Commands["herd:answer"]["data"] {
  return { gate: "gt-1", status: "open", answer: null, closedReason: null, ...over };
}

describe("renderAnswer", () => {
  test("an open gate is not an answer", () => {
    expect(renderAnswer("gt-1", answerData({ status: "open" }))).toContain("is still open");
  });

  test("a closed gate warns against inventing an answer", () => {
    const out = renderAnswer("gt-1", answerData({ status: "closed", closedReason: "abandoned" }));
    expect(out).toContain("do not invent an answer");
    expect(out).toContain("abandoned");
  });

  test("a parked gate warns against inventing an answer", () => {
    expect(renderAnswer("gt-1", answerData({ status: "parked" }))).toContain("do not invent an answer");
  });

  test("answered with a null answer never renders as an empty answer", () => {
    const out = renderAnswer("gt-1", answerData({ status: "answered", answer: null }));
    expect(out).toContain("carries no answer");
    expect(out).not.toContain("{}");
  });

  test("answered renders the answerer and the answers", () => {
    const out = renderAnswer("gt-1", answerData({ status: "answered", answer: { answers: { q1: "yes" }, by: "human", answeredAt: 1 } }));
    expect(out).toContain("answered by human:");
    expect(out).toContain("\"q1\": \"yes\"");
  });
});

function statusData(over: Partial<HerdStatusData>): HerdStatusData {
  return {
    herd: { id: "hd-1", repo: "r", room: "herd-1", workspace: "w1", shepherdSession: "s", shepherdHandle: "shep", shepherdName: "shep", herdrSocket: null, hidden: false, status: "active", createdAt: 0, wrappedAt: null },
    jobs: [],
    unread: 0,
    lifecycleConnected: true,
    hiddenUp: null,
    subscription: { id: "sub-1", dead: false, lastDelivery: null },
    push: { state: "reachable", lastDelivery: null },
    ...over,
  };
}

function job(over: Partial<HerdStatusData["jobs"][number]>): HerdStatusData["jobs"][number] {
  return {
    herd: "hd-1", name: "job-a", worktree: "/tmp/job-a", branch: null, tree: null, pane: "w1:p1",
    agentSession: null, agentId: null, handle: "job-a", handleName: "job-a", status: "active", disposable: false,
    lastGate: null, lastReport: null, createdAt: 0, updatedAt: 0,
    openGate: null, paneStatus: "idle", sessionDead: false, lastGateStatus: null, lastGateDelivery: null, lastGateConsumed: null,
    ...over,
  };
}

describe("rt herd brief", () => {
  function tmpFile(name: string, content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "rt-herd-brief-cli-"));
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  }

  const TEMPLATE = [
    "# Job: <name>",
    "",
    "Goal: <goal>",
    "",
    "## Method",
    "",
    "<REQUIRED: describe the approach here>",
    "",
  ].join("\n");

  const STRATEGIES = ["## trivial", "", "```", "Do the trivial thing.", "```", ""].join("\n");

  test("buildBriefInputs requires --job and --template", () => {
    expect(() => buildBriefInputs([])).toThrow(/usage: rt herd brief/);
    expect(() => buildBriefInputs(["--job", "x"])).toThrow(/usage: rt herd brief/);
  });

  test("buildBriefInputs enforces --method-file xor --strategy/--strategies", () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const strategies = tmpFile("s.md", STRATEGIES);
    expect(() => buildBriefInputs(["--job", "x", "--template", template])).toThrow(/pass either/);
    expect(() =>
      buildBriefInputs(["--job", "x", "--template", template, "--strategy", "trivial", "--method-file", methodFile]),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      buildBriefInputs(["--job", "x", "--template", template, "--strategy", "trivial"]),
    ).toThrow(/pass either/); // --strategy without --strategies
    const inputs = buildBriefInputs(["--job", "x", "--template", template, "--strategy", "trivial", "--strategies", strategies]);
    expect(inputs.method).toEqual({ kind: "strategy", strategies: STRATEGIES, name: "trivial" });
  });

  test("buildBriefInputs collects repeated --fill, splitting on the first '=' only", () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const inputs = buildBriefInputs([
      "--job", "x", "--template", template, "--method-file", methodFile,
      "--fill", "goal=ship a=b",
      "--fill", "paths=/tmp/x",
    ]);
    expect(inputs.fills).toEqual({ goal: "ship a=b", paths: "/tmp/x" });
  });

  test("buildBriefInputs rejects a --fill with no '='", () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    expect(() =>
      buildBriefInputs(["--job", "x", "--template", template, "--method-file", methodFile, "--fill", "no-equals-sign"]),
    ).toThrow(/--fill must be name=value/);
  });

  test("brief prints the assembled text plain, or as JSON with --json", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const args = ["--job", "widget", "--template", template, "--method-file", methodFile, "--fill", "goal=ship it"];

    const plain = await run(brief, args);
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain("# Job: widget");
    expect(plain.stdout).toContain("Do the thing.");

    const json = await run(brief, [...args, "--json"]);
    expect(json.code).toBe(0);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.brief).toContain("# Job: widget");
  });

  test("brief stays a payload at a terminal", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const io = captureOut();
    out.__test__.setHuman(() => true);
    try {
      await brief(["--job", "widget", "--template", template, "--method-file", methodFile, "--fill", "goal=ship it"]);
      expect(io.stdout().startsWith("# Job: widget\n")).toBe(true);
      expect(io.stdout()).not.toContain("\x1b");
      expect(io.stderr()).toBe("");
    } finally {
      io.restore();
    }
  });

  test("brief --out writes the file and always prints {ok:true,path}, --json or not", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const outPath = join(mkdtempSync(join(tmpdir(), "rt-herd-brief-out-")), "brief.md");
    const args = ["--job", "widget", "--template", template, "--method-file", methodFile, "--fill", "goal=ship it", "--out", outPath];

    const r = await run(brief, args);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed).toEqual({ ok: true, path: outPath });
    expect(readFileSync(outPath, "utf8")).toContain("# Job: widget");
  });

  test("brief exits 1 with the leftover-markers error when a slot is unfilled", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const r = await run(brief, ["--job", "widget", "--template", template, "--method-file", methodFile]); // goal unfilled
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unfilled markers: goal");
  });

  test("brief exits 1 naming available strategies on an unknown --strategy", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const strategies = tmpFile("s.md", STRATEGIES);
    const r = await run(brief, ["--job", "widget", "--template", template, "--strategy", "nope", "--strategies", strategies, "--fill", "goal=x"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("unknown strategy 'nope'; available: trivial");
  });

  test("brief exits 1 with a clear message when --out cannot be written", async () => {
    const template = tmpFile("t.md", TEMPLATE);
    const methodFile = tmpFile("m.md", "Do the thing.");
    const badOut = join(mkdtempSync(join(tmpdir(), "rt-herd-brief-bad-")), "no-such-dir", "brief.md");
    const r = await run(brief, ["--job", "widget", "--template", template, "--method-file", methodFile, "--fill", "goal=x", "--out", badOut]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cannot write --out");
  });

  test("brief exits 1 on an unclosed author note and writes no --out file", async () => {
    const template = tmpFile("t.md", ["<!-- author -->", TEMPLATE].join("\n"));
    const methodFile = tmpFile("m.md", "Do the thing.");
    const outPath = join(mkdtempSync(join(tmpdir(), "rt-herd-brief-out-")), "brief.md");
    const r = await run(brief, ["--job", "widget", "--template", template, "--method-file", methodFile, "--fill", "goal=x", "--out", outPath]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("author note opened at template line 1 is never closed");
    expect(existsSync(outPath)).toBe(false);
  });
});

describe("renderStatus", () => {
  test("a job parked at the trust modal says so and names the remedy", () => {
    const data = statusData({ jobs: [job({ status: "stuck-at-modal", paneStatus: "blocked" })] });
    const out = renderStatus(data);
    expect(out).toContain("stuck-at-modal");
    expect(out).toContain("STUCK AT TRUST MODAL");
    expect(out).toContain("accept it in pane w1:p1");
  });

  test("an ordinary job carries no modal marker", () => {
    expect(renderStatus(statusData({ jobs: [job({})] }))).not.toContain("STUCK AT TRUST MODAL");
  });

  test("a job whose worker session died says so and names the remedy", () => {
    const data = statusData({ jobs: [job({ status: "active", paneStatus: null, sessionDead: true })] });
    const out = renderStatus(data);
    expect(out).toContain("SESSION DEAD");
    expect(out).toContain("rt herd spawn");
  });

  test("a live worker carries no dead marker", () => {
    expect(renderStatus(statusData({ jobs: [job({})] }))).not.toContain("SESSION DEAD");
  });

  test("a pane herdr cannot see is not reported dead", () => {
    expect(renderStatus(statusData({ jobs: [job({ sessionDead: null, paneStatus: null })] }))).not.toContain("SESSION DEAD");
  });

  test("a missing subscription names its own remedy", () => {
    expect(renderStatus(statusData({ subscription: null }))).toContain("subscription MISSING (run rt herd resume)");
  });

  test("an answered gate delivered to a dead pane tells the shepherd to DM the worker", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "dead-pane", handle: "job-a" })] });
    expect(renderStatus(data)).toContain("answered, worker not woken: rt chat dm job-a");
  });

  test("a CLOSED gate whose doorbell died is just as unwoken and says so", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "closed", lastGateDelivery: "dead-pane", handle: "job-a" })] });
    expect(renderStatus(data)).toContain("gate gt-9 closed, worker not woken: rt chat dm job-a");
  });

  test("a delivered gate carries no not-woken warning", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "delivered" })] });
    expect(renderStatus(data)).not.toContain("worker not woken");
  });

  test("an answered, nudged gate no one has read yet prints UNCONSUMED", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "delivered", lastGateConsumed: false })] });
    expect(renderStatus(data)).toContain("gate gt-9 UNCONSUMED");
  });

  test("a consumed gate carries no UNCONSUMED marker", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "delivered", lastGateConsumed: true })] });
    expect(renderStatus(data)).not.toContain("UNCONSUMED");
  });

  test("nothing to consume (no last gate) carries no UNCONSUMED marker", () => {
    const data = statusData({ jobs: [job({ lastGateConsumed: null })] });
    expect(renderStatus(data)).not.toContain("UNCONSUMED");
  });

  test("a dead-pane row that is also unconsumed prints both suffixes", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "dead-pane", lastGateConsumed: false, handle: "job-a" })] });
    const out = renderStatus(data);
    expect(out).toContain("worker not woken");
    expect(out).toContain("gate gt-9 UNCONSUMED");
  });

  test("a job the watchdog has poked prints the strike count and how long ago", () => {
    const out = renderStatus(statusData({ jobs: [job({ watchdog: { strikes: 2, lastPokeAt: Date.now() - 3 * 60_000 } })] }));
    expect(out).toContain("poked 2x 3m ago");
    const hours = renderStatus(statusData({ jobs: [job({ watchdog: { strikes: 1, lastPokeAt: Date.now() - 2 * 60 * 60_000 } })] }));
    expect(hours).toContain("poked 1x 2h ago");
  });

  test("a job off the ladder, or on it with no strike yet, carries no poked marker", () => {
    expect(renderStatus(statusData({ jobs: [job({})] }))).not.toContain("poked");
    expect(renderStatus(statusData({ jobs: [job({ watchdog: { strikes: 0, lastPokeAt: null } })] }))).not.toContain("poked");
  });

  test("prints the push probe's reachability and delivery age instead of headlining dead", () => {
    const reachable = renderStatus(statusData({ push: { state: "reachable", lastDelivery: null } }));
    expect(reachable).toContain("push: reachable (last delivery never)");
    expect(reachable).not.toContain("DEAD");

    const unreachable = renderStatus(statusData({ push: { state: "unreachable", lastDelivery: { outcome: "delivered", at: Date.now() - 5 * 60_000 } } }));
    expect(unreachable).toContain("push: unreachable (last delivery 5m ago)");
  });

  test("the dead-pane remedy DMs the worker by name, never by id", () => {
    const data = statusData({ jobs: [job({ lastGate: "gt-9", lastGateStatus: "answered", lastGateDelivery: "dead-pane", handle: "job-a.w001", handleName: "job-a" })] });
    const out = renderStatus(data);
    expect(out).toContain("worker not woken: rt chat dm job-a");
    expect(out).not.toContain("job-a.w001");
  });

  test("renderResumed names the shepherd by name", () => {
    const status = statusData({ herd: { ...statusData({}).herd, shepherdHandle: "shep.k3f9", shepherdName: "shep" } });
    const line = renderResumed("hd-1", { subscription: "sub-1", gates: [], unread: 2, status, handle: "shep.k3f9" });
    expect(line).toBe("resumed hd-1 as shep: subscription sub-1, 0 open gate(s), 2 unread");
  });
});

import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { Block } from "../../lib/ui/protocol.ts";
import { herdGatesBlocks, herdListBlocks, herdStatusBlocks } from "../../commands/herd.ts";

describe("herd views at a terminal", () => {
  const herd = { id: "h-sample", repo: "sample-app", room: "herd-h-sample", workspace: "w1", shepherdSession: "s", shepherdHandle: "ana.1", shepherdName: "ana", herdrSocket: null, hidden: false, status: "active" as const, createdAt: 1, wrappedAt: null };
  const job = { herd: "h-sample", name: "job-a", worktree: "/code/wt", branch: "job-a", tree: "wt", pane: "w1:p3", agentSession: "s2", agentId: null, handle: "job-a.2", handleName: "job-a", status: "active" as const, disposable: false, lastGate: null, lastReport: null, createdAt: 1, updatedAt: 1, openGate: null, paneStatus: "working", sessionDead: false, lastGateStatus: null, lastGateDelivery: null, lastGateConsumed: null };

  function statusCell(blocks: Block[]) {
    const section = blocks[0];
    if (section?.t !== "section") throw new Error("Expected the herd section");
    const table = section.blocks.find((block) => block.t === "table");
    const row = table?.rows[0];
    if (!row || !("cells" in row)) throw new Error("Expected a job row");
    return row.cells[1];
  }

  test.each(["active", "spawning"] as const)("status: a dead %s session overrides stale working text", (status) => {
    const blocks = herdStatusBlocks(statusData({ jobs: [{ ...job, status, sessionDead: true }] }));
    const row = renderPlain(blocks).split("\n").find((line) => /^job-a +/.test(line));
    expect(row).toMatch(/^job-a +session gone +pane w1:p3 *$/);
    expect(row).not.toContain("working");
  });

  test("status: each job names its harness, model and mode, and a headless worker has no pane", () => {
    const blocks = herdStatusBlocks(statusData({ jobs: [
      { ...job, harness: "claude", model: "opus", mode: "herdr" },
      { ...job, name: "job-b", pane: null, paneStatus: null, sessionDead: null, harness: "codex", model: "gpt-5.1", mode: "headless" },
    ] }));
    const lines = renderPlain(blocks).split("\n");
    expect(lines.find((l) => /^job-a +/.test(l))).toMatch(/^job-a +working +pane w1:p3 +claude opus herdr · working *$/);
    expect(lines.find((l) => /^job-b +/.test(l))).toMatch(/^job-b +working +no pane +codex gpt-5\.1 headless *$/);
  });

  test("status: a dead session uses the failed role in the job row", () => {
    const blocks = herdStatusBlocks(statusData({ jobs: [{ ...job, sessionDead: true }] }));
    expect(statusCell(blocks)).toEqual([{ text: "session gone", role: "failed" }]);
  });

  test("list: one row per herd, its status in its own word", () => {
    const text = renderPlain(herdListBlocks([{ ...herd, jobs: 2 }, { ...herd, id: "h-two", status: "wrapped", jobs: 1 }]));
    expect(text.split("\n")[0]).toMatch(/^h-sample +active +room herd-h-sample +2 jobs$/);
    expect(text.split("\n")[1]).toMatch(/^h-two +wrapped +room herd-h-sample +1 job$/);
    expect(renderPlain(herdListBlocks([]))).toBe("[skipped] No herds\n  next: rt herd list --all\n");
    expect(renderPlain(herdListBlocks([], true))).toBe("[skipped] No herds\n");
  });

  test("status: a healthy herd is a heading, its numbers and its jobs, with no problem lines", () => {
    const data = { herd, jobs: [job], unread: 0, lifecycleConnected: true, hiddenUp: null, subscription: { id: "sub-1", dead: false, lastDelivery: null }, push: { state: "reachable" as const, lastDelivery: null } };
    const blocks = herdStatusBlocks(data as never);
    const text = renderPlain(blocks);
    expect(statusCell(blocks)).toEqual([{ text: "working", role: "running" }]);
    expect(text).toContain("h-sample");
    expect(text).toMatch(/job-a +working +pane w1:p3/);
    expect(text).not.toContain("[warning]");
    expect(text).not.toContain("[needs you]");
  });

  test("status: every problem the shepherd must act on is its own line, with the command that fixes it", () => {
    const data = {
      herd,
      jobs: [
        { ...job, name: "job-b", status: "stuck-at-modal" as const, pane: "w1:p4" },
        { ...job, name: "job-c", sessionDead: true },
        { ...job, name: "job-d", status: "at-gate" as const, lastGate: "g7", lastGateStatus: "answered" as const, lastGateDelivery: "dead-pane" as const, lastGateConsumed: false },
      ],
      unread: 3,
      lifecycleConnected: false,
      hiddenUp: false,
      subscription: null,
      push: { state: "unreachable" as const, lastDelivery: null },
    };
    const text = renderPlain(herdStatusBlocks(data as never));
    expect(text).toContain("[needs you] This session is not subscribed to the herd\n  next: rt herd resume h-sample");
    expect(text).toContain("[warning] Lifecycle events are not reaching the herd");
    expect(text).toContain("[warning] The hidden herd session is down");
    expect(text).toContain("[warning] This session's inbox cannot be reached");
    expect(text).toContain("[needs you] job-b is waiting at a trust prompt  accept it in pane w1:p4");
    expect(text).toContain("[failed] job-c: the pane is open but Claude is gone\n  next: rt herd spawn --herd h-sample --job job-c");
    expect(text).toContain("[needs you] job-d did not see the update to gate g7\n  next: rt chat dm job-a 'Please read the update to gate g7.'\n");
    expect(text).toContain("[warning] job-d has not read the update to gate g7");
  });

  test("status: a closed gate has a complete DM remedy about its update", () => {
    const text = renderPlain(herdStatusBlocks(statusData({
      jobs: [{ ...job, lastGate: "gt-9", lastGateStatus: "closed", lastGateDelivery: "dead-pane", lastGateConsumed: false }],
    })));
    expect(text).toContain("[needs you] job-a did not see the update to gate gt-9\n  next: rt chat dm job-a 'Please read the update to gate gt-9.'\n");
    expect(text).toContain("[warning] job-a has not read the update to gate gt-9");
    expect(text).not.toContain("answer");
  });

  test("gates: one row per open gate; none says so", () => {
    const g = { id: "g7", subject: "herd:h-sample/job-d", kind: "decision", questions: [{ id: "q", label: "Ship it?", multi: false, options: ["yes"] }] };
    expect(renderPlain(herdGatesBlocks([g as never]))).toMatch(/^g7 +decision +herd:h-sample\/job-d +Ship it\?\n$/);
    expect(renderPlain(herdGatesBlocks([]))).toBe("[skipped] No open gates\n");
  });
});
