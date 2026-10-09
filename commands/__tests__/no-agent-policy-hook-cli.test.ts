/**
 * rt agent policy-hook driven as Codex drives it: `bun cli.ts agent
 * policy-hook ...` with the native payload piped on stdin, through the real
 * dispatcher, under an isolated HOME holding a bound Codex thread and its
 * run. In-process tests call the verb with their own io and cannot see what
 * the dispatcher passes it.
 *
 * Named no-* per AGENTS.md: a test that spawns cli.ts is not selected by
 * `bun test --changed`, so it must carry this prefix to run on a PR at all.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { codexPolicyManifest } from "../../lib/agent-integrations/codex/hook-manifest.ts";
import { createSessionStore } from "../../lib/agent-integrations/session-store.ts";
import { forkDenyReason, stopReason } from "../../lib/agent-integrations/policy.ts";
import { runStart } from "../../lib/runs/start.ts";
import { openRunDb, stageStart } from "../../lib/runs/write.ts";
import { setSetting } from "../../lib/settings/write.ts";
import { insertAgent } from "../../lib/state/agents-store.ts";
import { openStateDb } from "../../lib/state/db.ts";
import { childEnv } from "../../lib/subprocess.ts";

const CLI_PATH = join(import.meta.dir, "..", "..", "cli.ts");
const THREAD = "019a0000-0000-7000-8000-0000000000c1";
const TURN = "019a0000-0000-7000-8000-0000000000c2";
const INSTALLATION = "inst-cli-test";

let home = "";
let runsRoot = "";
let runId = "";

async function hook(event: "PreToolUse" | "Stop", stdin: string, executable = "/opt/mattstack/2.30.0/Contents/Helpers/rt"): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: Record<string, string | undefined> = { ...childEnv(), HOME: home, RT_RUNS_ROOT: runsRoot };
  for (const key of ["CODEX_THREAD_ID", "CODEX_HOME", "CLAUDE_CODE_SESSION_ID", "RT_GATE_SUBJECT", "HERDR_PANE_ID", "CI", "RT_SKIP_SETUP", "RT_APP_SOCKET"]) delete env[key];
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "agent", "policy-hook", "--installation", INSTALLATION, "--event", event, "--executable", executable], {
    env, stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
}

const stopPayload = (cwd: string) => JSON.stringify({
  session_id: THREAD, turn_id: TURN, cwd, hook_event_name: "Stop", model: "test-model",
  permission_mode: "bypassPermissions", stop_hook_active: false, last_assistant_message: "DONE",
});

beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-policy-hook-cli-")));
  runsRoot = join(home, "runs");
  const priorHome = process.env.HOME;
  process.env.HOME = home;
  try {
    setSetting("agent.integrations.enabled", true, "machine");
    const db = openStateDb(join(home, ".mattstack", "rt", "state.db"));
    insertAgent({ id: "ag-cli1", repo: "remote:example.com%2Fa%2Fb", cwd: home, provider: "codex", surface: "herdr", sessionId: THREAD, createdAt: 1 }, db);
    const store = createSessionStore(db);
    const bound = store.bind(store.reserve({ identity: "agent:ag-cli1", agentId: "ag-cli1" }), { harness: "codex", profile: "default", kind: "id", value: THREAD }, { mode: "herdr", pane: "w1:p1" });
    if (!bound.ok) throw new Error(bound.error.message);
    db.close();
    const started = runStart(runsRoot, { repo: "repo-a", workType: "feature", pipeline: "feature", env: { CLAUDE_CODE_SESSION_ID: THREAD }, now: 1000 });
    if (!started.ok) throw new Error(started.error);
    runId = started.runId;
    const run = openRunDb(started.runDb);
    stageStart(run, "ship", { CLAUDE_CODE_SESSION_ID: THREAD }, 2000);
    run.close();
  } finally {
    process.env.HOME = priorHome;
  }
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("rt agent policy-hook through the dispatcher (spawned)", () => {
  test("an open run's Stop exits 2 with only the continuation on stderr", async () => {
    const result = await hook("Stop", stopPayload(home));
    expect(result).toEqual({ code: 2, stdout: "", stderr: stopReason(runId, "ship") });
  }, 30_000);

  test("an unreadable payload passes with `{}` alone on stdout", async () => {
    expect(await hook("Stop", "{not json")).toEqual({ code: 0, stdout: "{}\n", stderr: "" });
  }, 30_000);

  test("a question the gate service refuses exits 2 with only the refusal on stderr", async () => {
    const sock = join(home, ".mattstack", "rt", "rt.sock");
    const seen: string[] = [];
    const server = Bun.serve({
      unix: sock,
      async fetch(req) {
        const cmd = new URL(req.url).pathname.slice(1);
        seen.push(cmd);
        if (cmd === "gate:fork-check") return Response.json({ ok: true, data: { allow: false, subject: "run:r1" } });
        if (cmd === "agent:policy-receipt") return Response.json({ ok: true, data: { turn: "unknown", diagnostic: false } });
        return Response.json({ ok: false, error: "unknown command" });
      },
    });
    try {
      const result = await hook("PreToolUse", JSON.stringify({
        session_id: THREAD, turn_id: TURN, cwd: home, hook_event_name: "PreToolUse", model: "test-model",
        permission_mode: "bypassPermissions", tool_name: "request_user_input", tool_input: { questions: [] },
      }));
      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(forkDenyReason("run:r1").replaceAll("AskUserQuestion", "request_user_input"));
      expect(seen).toEqual(["gate:fork-check", "agent:policy-receipt"]);
    } finally {
      server.stop(true);
    }
  }, 30_000);

  test("run from source behind a wrapper script or a symlink, the receipt names the installed manifest's revision", async () => {
    const bin = join(home, "bin");
    mkdirSync(bin, { recursive: true });
    const wrapper = join(bin, "rt");
    writeFileSync(wrapper, `#!/bin/sh\nexec bun run '${CLI_PATH}' "$@"\n`);
    chmodSync(wrapper, 0o755);
    const link = join(bin, "rt-link");
    symlinkSync(wrapper, link);
    const sock = join(home, ".mattstack", "rt", "rt.sock");
    const revisions: string[] = [];
    const server = Bun.serve({
      unix: sock,
      async fetch(req) {
        const cmd = new URL(req.url).pathname.slice(1);
        if (cmd === "agent:policy-receipt") {
          revisions.push(String((await req.json() as { revision?: unknown }).revision));
          return Response.json({ ok: true, data: { turn: "unknown", diagnostic: false } });
        }
        return Response.json({ ok: false, error: "unknown command" });
      },
    });
    try {
      const bash = JSON.stringify({
        session_id: THREAD, turn_id: TURN, cwd: home, hook_event_name: "PreToolUse", model: "test-model",
        permission_mode: "bypassPermissions", tool_name: "Bash", tool_input: { command: "true" },
      });
      for (const executable of [wrapper, link]) expect((await hook("PreToolUse", bash, executable)).code).toBe(0);
    } finally {
      server.stop(true);
    }
    expect(revisions).toEqual([wrapper, link].map((executable) => codexPolicyManifest({ executable, installationId: INSTALLATION }).revision));
  }, 60_000);

  test("another thread's Stop passes", async () => {
    const other = stopPayload(home).replace(THREAD, "019a0000-0000-7000-8000-0000000000ff");
    expect(await hook("Stop", other)).toEqual({ code: 0, stdout: "{}\n", stderr: "" });
  }, 30_000);
});
