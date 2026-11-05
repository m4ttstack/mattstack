import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { recordIdentity } from "../identity.ts";
import { createRunDb } from "../write.ts";

function dbWithRun(): Database {
  const db = createRunDb(join(mkdtempSync(join(tmpdir(), "rt-ident-")), "state.db"));
  db.run("INSERT INTO runs (id, repo, work_type, pipeline, status, started_at) VALUES ('r1', 'demo', 'fix', 'default', 'running', 1)");
  return db;
}

function field(db: Database, key: string): { value: string; produced_by: string; at: number } | undefined {
  return db.query("SELECT value, produced_by, at FROM fields WHERE key=?").get(key) as any;
}

describe("recordIdentity", () => {
  test("records claude-session and herdr-pane from env under producer run", () => {
    const db = dbWithRun();
    recordIdentity(db, { CLAUDE_CODE_SESSION_ID: "sess-1", HERDR_PANE_ID: "w1:p2" }, 100);
    expect(field(db, "claude-session")).toEqual({ value: "sess-1", produced_by: "run", at: 100 });
    expect(field(db, "herdr-pane")).toEqual({ value: "w1:p2", produced_by: "run", at: 100 });
    db.close();
  });

  test("refreshes a changed value but never bumps at for an unchanged one", () => {
    const db = dbWithRun();
    recordIdentity(db, { CLAUDE_CODE_SESSION_ID: "sess-1", HERDR_PANE_ID: "w1:p2" }, 100);
    recordIdentity(db, { CLAUDE_CODE_SESSION_ID: "sess-1", HERDR_PANE_ID: "w1:p9" }, 200);
    expect(field(db, "claude-session")!.at).toBe(100);
    expect(field(db, "herdr-pane")).toEqual({ value: "w1:p9", produced_by: "run", at: 200 });
    db.close();
  });

  test("records RT_RUN_TEST as the test field", () => {
    const db = dbWithRun();
    recordIdentity(db, { RT_RUN_TEST: "replay" }, 100);
    expect(field(db, "test")).toEqual({ value: "replay", produced_by: "run", at: 100 });
    db.close();
  });

  test("absent env vars record nothing", () => {
    const db = dbWithRun();
    recordIdentity(db, {}, 100);
    expect(db.query("SELECT COUNT(*) AS n FROM fields").get()).toEqual({ n: 0 });
    db.close();
  });

  describe("claude-sessions", () => {
    const sessions = (db: Database) => JSON.parse(field(db, "claude-sessions")!.value);
    const rec = (db: Database, id: string, now: number) => recordIdentity(db, { CLAUDE_CODE_SESSION_ID: id }, now);

    test("a first session records a one-item list", () => {
      const db = dbWithRun();
      rec(db, "s1", 100);
      expect(sessions(db)).toEqual(["s1"]);
      expect(field(db, "claude-sessions")!.produced_by).toBe("run");
      db.close();
    });

    test("a new session appends", () => {
      const db = dbWithRun();
      rec(db, "s1", 100);
      rec(db, "s2", 200);
      expect(sessions(db)).toEqual(["s1", "s2"]);
      expect(field(db, "claude-session")!.value).toBe("s2");
      db.close();
    });

    test("returning to an old session does not duplicate it", () => {
      const db = dbWithRun();
      rec(db, "s1", 100);
      rec(db, "s2", 200);
      rec(db, "s1", 300);
      expect(sessions(db)).toEqual(["s1", "s2"]);
      db.close();
    });

    test("an unchanged session leaves fields.at alone", () => {
      const db = dbWithRun();
      rec(db, "s1", 100);
      rec(db, "s1", 500);
      expect(field(db, "claude-session")!.at).toBe(100);
      expect(field(db, "claude-sessions")!.at).toBe(100);
      db.close();
    });

    test("an existing claude-session seeds the list", () => {
      const db = dbWithRun();
      db.run("INSERT INTO fields (run_id, key, value, produced_by, at) VALUES ('r1', 'claude-session', 's0', 'run', 50)");
      rec(db, "s1", 100);
      expect(sessions(db)).toEqual(["s0", "s1"]);
      db.close();
    });

    test("a lone existing claude-session seen again writes no list", () => {
      const db = dbWithRun();
      db.run("INSERT INTO fields (run_id, key, value, produced_by, at) VALUES ('r1', 'claude-session', 's0', 'run', 50)");
      rec(db, "s0", 100);
      expect(field(db, "claude-sessions") ?? null).toBeNull();
      db.close();
    });
  });
});
