import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { bgRelease, bgStatus, bgStatusBlocks, bgStop } from "../bg.ts";
import { reconcilerClear, reconcilerStatus, reconcilerStatusBlocks } from "../reconciler.ts";

let home: string;
let origHome: string | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let seen: Array<{ cmd: string; payload: unknown }> = [];
let replies: Record<string, unknown> = {};

beforeEach(() => {
  origHome = process.env.HOME;
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-bg-cli-")));
  process.env.HOME = home;
  const sockDir = join(home, ".mattstack", "rt");
  mkdirSync(sockDir, { recursive: true });
  seen = [];
  server = Bun.serve({
    unix: join(sockDir, "rt.sock"),
    async fetch(req) {
      const cmd = new URL(req.url).pathname.slice(1);
      const payload = req.method === "POST" ? await req.json() : {};
      seen.push({ cmd, payload });
      return Response.json(replies[cmd] ?? { ok: false, error: `unknown command: ${cmd}` });
    },
  });
});

afterEach(() => {
  server?.stop(true);
  process.env.HOME = origHome;
});

async function run(fn: (args: string[]) => Promise<void>, args: string[]) {
  const io = captureOut({ console: true });
  ui.__test__.setHuman(() => false);
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
  return { code, stdout: io.stdout(), stderr: io.stderr() };
}

// ─── status ─────────────────────────────────────────────────────────────────

test("bg status: the server state, then its claims, with no socket path", () => {
  const text = renderPlain(bgStatusBlocks({ up: true, socket: "/tmp/bg.sock", claims: [{ owner: "runner", pane: "bg:w1:p1", createdAt: 0 }] }, 42_000));
  expect(text).toStartWith("[running] The background server is running\n");
  expect(text).toMatch(/runner +bg:w1:p1 +42s/);
  expect(text).not.toContain("/tmp/bg.sock");
  expect(renderPlain(bgStatusBlocks({ up: false, socket: "/s", claims: [] }, 0))).toBe("[off] The background server is stopped\n[skipped] No live claims\n");
});

test("bg status clamps a future claim's age and uses a missing-pane placeholder", () => {
  expect(renderPlain(bgStatusBlocks({ up: true, socket: "/s", claims: [{ owner: "runner", pane: null, createdAt: 1000 }] }, 0))).toMatch(/runner +- +0s/);
});

test("reconciler status: the sweep, herdr, and each executor's state as a word", () => {
  const text = renderPlain(reconcilerStatusBlocks({ sweptAt: 0, herdrReachable: false, executors: [{ agentId: "ag-1", state: "blocked", paneRef: "w1:p2" }, { agentId: "ag-2", state: "gone", paneRef: null }] } as never));
  expect(text).toContain("last sweep: never");
  expect(text).toContain("[warning] herdr is not reachable");
  expect(text).toMatch(/ag-1 +waiting on you +w1:p2/);
  expect(text).toMatch(/ag-2 +gone +-/);
});

test("reconciler status assigns each state its status role and handles unknown keys safely", () => {
  const states = ["live", "blocked", "hidden", "gone", "cleared", "unknown", "future", "constructor", "__proto__"];
  const blocks = reconcilerStatusBlocks({ sweptAt: 0, herdrReachable: true, executors: states.map((state) => ({ agentId: state, state, paneRef: null })) } as never);
  const table = blocks.at(-1);
  expect(table?.t).toBe("table");
  if (table?.t !== "table") throw new Error("missing executors table");
  expect(table.rows.map((row) => "cells" in row ? row.cells[1] : null)).toEqual([
    [{ text: "live", role: "running" }],
    [{ text: "waiting on you", role: "needs-you" }],
    [{ text: "hidden", role: "off" }],
    [{ text: "gone", role: "warn" }],
    [{ text: "cleared", role: "skipped" }],
    [{ text: "unknown", role: "skipped" }],
    [{ text: "unknown", role: "skipped" }],
    [{ text: "unknown", role: "skipped" }],
    [{ text: "unknown", role: "skipped" }],
  ]);
});

test("reconciler status renders a local sweep time and an empty executor list", () => {
  const sweptAt = 1_700_000_000_000;
  const text = renderPlain(reconcilerStatusBlocks({ sweptAt, herdrReachable: true, executors: [] }));
  expect(text).toContain(`last sweep: ${new Date(sweptAt).toLocaleString()}`);
  expect(text).toContain("[ok] herdr is reachable\n[skipped] No known executors\n");
});

test("bg status --json prints the raw record; plain prints the rendering", async () => {
  const data = { up: false, socket: "/tmp/bg.sock", claims: [] };
  replies = { "bg:status": { ok: true, data } };
  const json = await run(bgStatus, ["--json"]);
  expect(JSON.parse(json.stdout)).toEqual({ ok: true, ...data });
  const plain = await run(bgStatus, []);
  expect(plain.stdout).toContain("[off] The background server is stopped");
});

// ─── release ────────────────────────────────────────────────────────────────

test("bg release <owner> forwards the claim and prints the outcome", async () => {
  replies = { "bg:release": { ok: true, data: { released: true } } };
  const r = await run(bgRelease, ["herd:hd-1"]);
  expect(seen[0]).toEqual({ cmd: "bg:release", payload: { claim: "herd:hd-1" } });
  expect(r.stdout).toBe("[ok] Released herd:hd-1\n");
  expect(r.code).toBe(0);
});

test("bg release <owner> --json prints the raw record", async () => {
  replies = { "bg:release": { ok: true, data: { released: false } } };
  const r = await run(bgRelease, ["herd:hd-1", "--json"]);
  expect(JSON.parse(r.stdout)).toEqual({ ok: true, released: false });
});

test("bg release with no owner and no TTY fails with usage (never spawns a picker)", async () => {
  const r = await run(bgRelease, []);
  expect(r.code).toBe(1);
  expect(r.stderr).toBe("Which claim?\n  next: rt bg release <owner>\n");
  expect(seen).toEqual([]);
});

test("bg release --json with no owner fails with usage even under RT_BATCH-less env", async () => {
  const r = await run(bgRelease, ["--json"]);
  expect(r.code).toBe(1);
  expect(r.stderr).toBe("Which claim?\n  next: rt bg release <owner>\n");
});

test("bg release exits non-zero when the daemon refuses", async () => {
  replies = { "bg:release": { ok: false, error: "no such claim" } };
  const r = await run(bgRelease, ["herd:hd-1"]);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("no such claim");
});

// ─── stop ───────────────────────────────────────────────────────────────────

test("bg stop prints stopped on success", async () => {
  replies = { "bg:stop": { ok: true, data: { stopped: true } } };
  const r = await run(bgStop, []);
  expect(r.stdout).toBe("[ok] Stopped the background server\n");
  expect(r.code).toBe(0);
});

test("bg stop --json prints the raw record", async () => {
  replies = { "bg:stop": { ok: true, data: { stopped: true } } };
  const r = await run(bgStop, ["--json"]);
  expect(JSON.parse(r.stdout)).toEqual({ ok: true, stopped: true });
});

test("stop with live claims is a refusal that names the release command", async () => {
  replies = { "bg:stop": { ok: false, error: "bg server has live claims: herd:hd-1, runner:123" } };
  const r = await run(bgStop, []);
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toBe("[refused] Left the background server running  it still has live claims: herd:hd-1, runner:123\n  next: rt bg release herd:hd-1\n");
});

test("bg stop --json with live claims keeps stdout empty and shows the refusal", async () => {
  replies = { "bg:stop": { ok: false, error: "bg server has live claims: runner" } };
  const r = await run(bgStop, ["--json"]);
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("[refused] Left the background server running");
  expect(r.stderr).toContain("next: rt bg release runner");
});

test("bg release of a missing claim is skipped", async () => {
  replies = { "bg:release": { ok: true, data: { released: false } } };
  const r = await run(bgRelease, ["runner"]);
  expect(r).toEqual({ code: 0, stdout: "[skipped] runner was not claimed\n", stderr: "" });
});

test("bg stop daemon errors are failures rather than refusals", async () => {
  replies = { "bg:stop": { ok: false, error: "could not stop the server" } };
  expect(await run(bgStop, [])).toEqual({ code: 1, stdout: "", stderr: "could not stop the server\n" });
});

test("reconciler status prints its blocks and clear reports success", async () => {
  replies = { "reconciler:status": { ok: true, data: { sweptAt: 0, herdrReachable: true, executors: [] } } };
  expect((await run(reconcilerStatus, [])).stdout).toBe("last sweep: never\n[ok] herdr is reachable\n[skipped] No known executors\n");
  replies = { "reconciler:clear": { ok: true, data: { cleared: true } } };
  expect(await run(reconcilerClear, ["ag-1"])).toEqual({ code: 0, stdout: "[ok] Cleared ag-1\n", stderr: "" });
});

test("reconciler clear asks for the missing agent without calling the daemon", async () => {
  expect(await run(reconcilerClear, [])).toEqual({ code: 1, stdout: "", stderr: "Which agent?\n  next: rt reconciler clear <agentId>\n" });
  expect(seen).toEqual([]);
});

test("reconciler daemon errors print a failure without a verb prefix", async () => {
  replies = { "reconciler:clear": { ok: false, error: "agent could not be cleared" } };
  expect(await run(reconcilerClear, ["ag-1"])).toEqual({ code: 1, stdout: "", stderr: "agent could not be cleared\n" });
});
