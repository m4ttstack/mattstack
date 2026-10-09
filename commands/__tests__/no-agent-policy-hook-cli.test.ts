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
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { createSessionStore } from "../../lib/agent-integrations/session-store.ts";
import { stopReason } from "../../lib/agent-integrations/policy.ts";
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

async function hook(event: "PreToolUse" | "Stop", stdin: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const env: Record<string, string | undefined> = { ...childEnv(), HOME: home, RT_RUNS_ROOT: runsRoot, RT_SKIP_SETUP: "1", CI: "true" };
  for (const key of ["CODEX_THREAD_ID", "CODEX_HOME", "CLAUDE_CODE_SESSION_ID", "RT_GATE_SUBJECT", "HERDR_PANE_ID"]) delete env[key];
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "agent", "policy-hook", "--installation", INSTALLATION, "--event", event], {
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

  test("another thread's Stop passes", async () => {
    const other = stopPayload(home).replace(THREAD, "019a0000-0000-7000-8000-0000000000ff");
    expect(await hook("Stop", other)).toEqual({ code: 0, stdout: "{}\n", stderr: "" });
  }, 30_000);
});
