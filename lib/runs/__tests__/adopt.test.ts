import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { DAEMON_SOCK_PATH } from "../../daemon-config.ts";
import { runWriteVerb } from "../../../commands/runs-write.ts";
import { adoptRunSession } from "../adopt.ts";
import { createRunDb } from "../write.ts";

type Seen = { path: string; body: Record<string, unknown> };

async function withFakeDaemon<T>(reply: (path: string) => object, body: (seen: Seen[]) => Promise<T>): Promise<T> {
  mkdirSync(dirname(DAEMON_SOCK_PATH), { recursive: true });
  if (existsSync(DAEMON_SOCK_PATH)) rmSync(DAEMON_SOCK_PATH);
  const seen: Seen[] = [];
  const server = Bun.serve({
    unix: DAEMON_SOCK_PATH,
    async fetch(req) {
      const path = new URL(req.url).pathname.slice(1);
      seen.push({ path, body: (await req.json()) as Record<string, unknown> });
      return new Response(JSON.stringify(reply(path)));
    },
  });
  try {
    return await body(seen);
  } finally {
    server.stop(true);
    if (existsSync(DAEMON_SOCK_PATH)) rmSync(DAEMON_SOCK_PATH);
  }
}

function dbWithRun(fields: Record<string, [string, number]> = {}): Database {
  const db = createRunDb(join(mkdtempSync(join(tmpdir(), "rt-adopt-run-")), "state.db"));
  db.run("INSERT INTO runs (id, repo, work_type, pipeline, status, started_at) VALUES ('r1', 'demo', 'fix', 'default', 'running', 1)");
  for (const [key, [value, at]] of Object.entries(fields)) {
    db.run("INSERT INTO fields (run_id, key, value, produced_by, at) VALUES ('r1', ?, ?, 'run', ?)", [key, value, at]);
  }
  return db;
}

function agentField(db: Database): string | undefined {
  return (db.query("SELECT value FROM fields WHERE key='agent'").get() as { value: string } | null)?.value;
}

const ADOPTED = (path: string) => (path === "agent:adopt" ? { ok: true, data: { id: "ag-1" } } : { ok: true });

describe("adoptRunSession", () => {
  test("adopts a recorded session and records the agent id", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      const db = dbWithRun({ "claude-session": ["sess-1", 100], ticket: ["ABC-1", 100] });
      await adoptRunSession(db, {});
      expect(seen).toEqual([{ path: "agent:adopt", body: { sessionId: "sess-1", repo: "demo", subject: "run:r1", label: "ABC-1" } }]);
      expect(agentField(db)).toBe("ag-1");
    });
  });

  test("skips when the agent field is newer than the session", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      const db = dbWithRun({ "claude-session": ["sess-1", 100], agent: ["ag-0", 200] });
      await adoptRunSession(db, {});
      expect(seen).toEqual([]);
    });
  });

  test("re-adopts when a newer session took over the run", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      const db = dbWithRun({ "claude-session": ["sess-2", 300], agent: ["ag-0", 200] });
      await adoptRunSession(db, {});
      expect(seen.map((s) => s.body.sessionId)).toEqual(["sess-2"]);
      expect(agentField(db)).toBe("ag-1");
    });
  });

  test("no session recorded, no call", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      await adoptRunSession(dbWithRun(), {});
      expect(seen).toEqual([]);
    });
  });

  test("RT_RUN_EMIT=0 skips the call", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      await adoptRunSession(dbWithRun({ "claude-session": ["sess-1", 100] }), { RT_RUN_EMIT: "0" });
      expect(seen).toEqual([]);
    });
  });

  test("a refused adopt writes nothing and does not throw", async () => {
    await withFakeDaemon(() => ({ ok: false, error: "no transcript for this session on this Mac" }), async () => {
      const db = dbWithRun({ "claude-session": ["sess-1", 100] });
      await adoptRunSession(db, {});
      expect(agentField(db)).toBeUndefined();
    });
  });

  test("a downed daemon is swallowed", async () => {
    if (existsSync(DAEMON_SOCK_PATH)) rmSync(DAEMON_SOCK_PATH);
    const db = dbWithRun({ "claude-session": ["sess-1", 100] });
    await adoptRunSession(db, {}, 200);
    expect(agentField(db)).toBeUndefined();
  });
});

describe("run write verbs adopt the session", () => {
  test("run-start adopts and keeps its output", async () => {
    await withFakeDaemon(ADOPTED, async (seen) => {
      const root = mkdtempSync(join(tmpdir(), "rt-runs-cli-"));
      const r = await runWriteVerb("run-start", ["--repo", "demo", "--work-type", "fix", "--pipeline", "default"],
        { RT_RUNS_ROOT: root, CLAUDE_CODE_SESSION_ID: "sess-1" });
      expect(r.code).toBe(0);
      expect(Object.keys(JSON.parse(r.out))).toEqual(["ok", "runId", "runDb"]);
      expect(seen.map((s) => s.path)).toContain("agent:adopt");
    });
  });

  test("stage-start registers a session the daemon missed at run-start", async () => {
    const root = mkdtempSync(join(tmpdir(), "rt-runs-cli-"));
    const started = await runWriteVerb("run-start", ["--repo", "demo", "--work-type", "fix", "--pipeline", "default"],
      { RT_RUNS_ROOT: root, CLAUDE_CODE_SESSION_ID: "sess-1", RT_RUN_EMIT: "0" });
    const runDb = JSON.parse(started.out).runDb as string;
    await withFakeDaemon(ADOPTED, async (seen) => {
      const r = await runWriteVerb("stage-start", ["--stage", "plan"], { RT_RUN_DB: runDb, CLAUDE_CODE_SESSION_ID: "sess-1" });
      expect(r.code).toBe(0);
      expect(seen.filter((s) => s.path === "agent:adopt").map((s) => s.body.sessionId)).toEqual(["sess-1"]);
    });
  });
});
