import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { seedRun } from "../../runs/__tests__/fixtures.ts";
import { usageMr, usageMrs } from "../queries.ts";
import type { AgentLink } from "../sources.ts";
import { openUsageDb } from "../store.ts";
import { runSweep, type SweepInput } from "../sweep.ts";

const M = "machine-a";
const REPO = "remote:github.com%2Facme%2Fwidgets";
const MR_URL = "https://github.com/acme/widgets/pull/7";
const MR_KEY = `${REPO}!7`;
const T0 = Date.parse("2026-01-02T00:00:00.000Z");
const NOW = T0 + 3_600_000;
const MINUTE = 60_000;

let dir: string;
let runs: string;
let config: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-sweep-"));
  runs = join(dir, "runs");
  config = join(dir, "config");
  dbPath = join(dir, "usage.db");
  mkdirSync(runs);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function line(id: string, offsetMs: number, output = 10): string {
  return `${JSON.stringify({
    timestamp: new Date(T0 + offsetMs).toISOString(),
    message: {
      id,
      model: "claude-opus-4",
      usage: { input_tokens: 1, output_tokens: output },
    },
  })}\n`;
}

function transcript(session: string, ...lines: string[]): string {
  const path = join(config, "projects", "proj-a", `${session}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join(""));
  return path;
}

function subagentTranscript(session: string, agent: string, ...lines: string[]): string {
  const path = join(config, "projects", "proj-a", session, "subagents", `agent-${agent}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join(""));
  return path;
}

function workRun(id: string, session: string, startedAt = T0): void {
  seedRun(runs, REPO, id, startedAt, 1, {
    status: "running",
    stages: [{ name: "build", status: "running", startedAt }],
    fields: [
      { key: "mr", value: MR_URL },
      { key: "claude-session", value: session },
    ],
  });
}

function mrAgent(session: string, id = `ag-${session}`): AgentLink {
  return { id, sessionId: session, subject: `mr:${MR_URL}`, label: null, caller: null };
}

function input(o: Partial<SweepInput> = {}): SweepInput {
  return {
    dbPath,
    runsRoot: runs,
    configDirs: [config],
    agents: [],
    machineId: async () => M,
    now: NOW,
    ...o,
  };
}

function inDb<T>(fn: (db: Database) => T): T {
  const db = openUsageDb(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

const rows = () =>
  inDb((db) => db.query("SELECT * FROM usage_messages ORDER BY message_id").all()) as Record<
    string,
    unknown
  >[];

const meta = (key: string) =>
  inDb(
    (db) =>
      (db.query("SELECT value FROM usage_meta WHERE key = ?").get(key) as { value: string } | null)
        ?.value ?? null,
  );

function setMeta(key: string, value: string): void {
  inDb((db) => db.query("INSERT INTO usage_meta (key, value) VALUES (?, ?)").run(key, value));
}

test("each kind of link lands its messages on the MR", async () => {
  workRun("run-work", "s-work", T0);
  workRun("run-respond-1", "s-respond-1", T0 + 10 * MINUTE);
  workRun("run-respond-2", "s-respond-2", T0 + 20 * MINUTE);
  seedRun(runs, REPO, "run-shared-a", T0 + 30 * MINUTE, 1, {
    status: "running",
    fields: [
      { key: "mr", value: MR_URL },
      { key: "claude-session", value: "s-shared" },
    ],
  });
  seedRun(runs, REPO, "run-shared-b", T0 + 35 * MINUTE, 1, {
    status: "running",
    fields: [
      { key: "mr", value: MR_URL },
      { key: "claude-session", value: "s-shared" },
    ],
  });
  transcript("s-work", line("m-1", 1 * MINUTE, 100), line("m-2", 2 * MINUTE, 200));
  transcript("s-respond-1", line("m-3", 11 * MINUTE, 40));
  transcript("s-respond-2", line("m-4", 21 * MINUTE, 8));
  transcript("s-shared", line("m-5", 31 * MINUTE, 3000), line("m-6", 36 * MINUTE, 500));
  transcript("s-doctor", line("m-7", 40 * MINUTE, 7));

  const result = await runSweep(input({ agents: [mrAgent("s-doctor")] }));

  expect(result).toMatchObject({ ran: true, files: 5, messages: 7, conflicts: 0, skippedLines: 0 });
  const totals = inDb((db) =>
    db
      .query(
        "SELECT mr_key, SUM(output) AS output, COUNT(*) AS n FROM usage_messages GROUP BY mr_key",
      )
      .all(),
  );
  expect(totals).toEqual([{ mr_key: MR_KEY, output: 3855, n: 7 }]);
  expect(rows().map((r) => r.machine_id)).toEqual(Array(7).fill(M));
});

test("a rerun with no new bytes changes nothing", async () => {
  workRun("run-1", "s-1");
  transcript("s-1", line("m-1", 1000), line("m-2", 2000));
  await runSweep(input());
  const before = rows();
  const second = await runSweep(input({ now: NOW + MINUTE }));
  expect(second).toMatchObject({ ran: true, files: 1, messages: 0, conflicts: 0, skippedLines: 0 });
  expect(rows()).toEqual(before);
});

test("new bytes are read from the offset", async () => {
  workRun("run-1", "s-1");
  const path = transcript("s-1", line("m-1", 1000));
  await runSweep(input());
  appendFileSync(path, line("m-2", 2000));
  expect((await runSweep(input({ now: NOW + MINUTE }))).messages).toBe(1);
  const scanned = inDb((db) => db.query('SELECT "offset", size FROM usage_files').get());
  const size = statSync(path).size;
  expect(scanned).toEqual({ offset: size, size });
});

test("a repeat of an id in new bytes counts as one changed row, last write wins", async () => {
  workRun("run-1", "s-1");
  const path = transcript("s-1", line("m-1", 1000, 10));
  await runSweep(input());
  appendFileSync(path, line("m-1", 1000, 25));
  expect((await runSweep(input({ now: NOW + MINUTE }))).messages).toBe(1);
  expect(rows()).toMatchObject([{ message_id: "m-1", output: 25 }]);
});

test("a partial last line finishes next sweep", async () => {
  workRun("run-1", "s-1");
  const whole = line("m-2", 2000);
  const path = transcript("s-1", line("m-1", 1000), whole.slice(0, 20));
  expect((await runSweep(input())).messages).toBe(1);
  appendFileSync(path, whole.slice(20));
  expect((await runSweep(input({ now: NOW + MINUTE }))).messages).toBe(1);
  expect(rows().map((r) => r.message_id)).toEqual(["m-1", "m-2"]);
});

test("a shrunken file is reread from 0 without duplicating rows", async () => {
  workRun("run-1", "s-1");
  transcript("s-1", line("m-1", 1000), line("m-2", 2000));
  await runSweep(input());
  const before = rows();
  transcript("s-1", line("m-1", 1000));
  expect((await runSweep(input({ now: NOW + MINUTE }))).messages).toBe(0);
  expect(rows()).toEqual(before);
  const path = join(config, "projects", "proj-a", "s-1.jsonl");
  const scanned = inDb((db) => db.query('SELECT "offset" FROM usage_files').get());
  expect(scanned).toEqual({ offset: statSync(path).size });
});

test("a backward mtime rereads the file from 0", async () => {
  workRun("run-1", "s-1");
  const path = transcript("s-1", line("m-1", 1000, 10));
  await runSweep(input());
  writeFileSync(path, line("m-1", 1000, 99));
  utimesSync(path, new Date(T0), new Date(T0));
  expect((await runSweep(input({ now: NOW + MINUTE }))).messages).toBe(1);
  expect(rows()).toMatchObject([{ output: 99 }]);
});

test("rewritten bytes before the offset are not read again", async () => {
  workRun("run-1", "s-1");
  const path = transcript("s-1", line("m-1", 1000, 10));
  await runSweep(input());
  const before = rows();

  writeFileSync(path, line("m-1", 1000, 99));
  expect(await runSweep(input({ now: NOW + MINUTE }))).toMatchObject({ messages: 0, conflicts: 0 });
  expect(rows()).toEqual(before);

  appendFileSync(path, line("m-2", 2000, 20));
  expect((await runSweep(input({ now: NOW + 2 * MINUTE }))).messages).toBe(1);
  expect(rows()).toMatchObject([
    { message_id: "m-1", output: 10 },
    { message_id: "m-2", output: 20 },
  ]);
});

test("deleting a run DB and transcript keeps its rows", async () => {
  workRun("run-1", "s-1");
  const path = transcript("s-1", line("m-1", 1000));
  await runSweep(input());
  const before = rows();
  rmSync(join(runs, REPO, "run-1"), { recursive: true });
  rmSync(path);
  const second = await runSweep(input({ now: NOW + MINUTE }));
  expect(second).toMatchObject({ ran: true, files: 0, messages: 0 });
  expect(rows()).toEqual(before);
  expect(inDb((db) => db.query("SELECT run_id FROM usage_runs").all())).toEqual([
    { run_id: "run-1" },
  ]);
});

for (const order of ["earlier copy first", "later copy first"]) {
  test(`a message id in two files keeps the earlier copy, whichever is read first: ${order}`, async () => {
    workRun("run-1", "s-early", T0);
    workRun("run-2", "s-late", T0 + 10 * MINUTE);
    const earlier = line("m-1", 1000, 11);
    const later = line("m-1", 15 * MINUTE, 22);
    const [firstRead, secondRead] =
      order === "earlier copy first"
        ? [() => transcript("s-early", earlier), () => transcript("s-late", later)]
        : [() => transcript("s-late", later), () => transcript("s-early", earlier)];

    firstRead();
    const first = await runSweep(input());
    secondRead();
    const second = await runSweep(input({ now: NOW + MINUTE }));

    expect(first.conflicts).toBe(0);
    expect(second.conflicts).toBe(1);
    expect(meta("conflicts")).toBe("1");
    expect(rows()).toMatchObject([
      { message_id: "m-1", session_id: "s-early", output: 11, ts: T0 + 1000, run_id: "run-1" },
    ]);
  });
}

test("an earlier copy from another subagent of the session keeps its attribution", async () => {
  workRun("run-1", "s-1");
  subagentTranscript("s-1", "aaa", line("m-1", 5000, 22));
  await runSweep(input());
  const [attributed] = rows();
  subagentTranscript("s-1", "bbb", line("m-1", 1000, 11));
  const second = await runSweep(input({ now: NOW + MINUTE }));
  expect(second).toMatchObject({ conflicts: 1, messages: 1 });
  expect(rows()).toEqual([
    { ...attributed, subagent_id: "bbb", ts: T0 + 1000, output: 11 },
  ]);
});

test("an earlier copy from a different session attributes to that session's run", async () => {
  workRun("run-1", "s-late", T0);
  seedRun(runs, REPO, "run-2", T0, 1, {
    status: "running",
    stages: [],
    fields: [{ key: "claude-session", value: "s-early" }],
  });
  transcript("s-late", line("m-1", 15 * MINUTE, 22));
  await runSweep(input());
  expect(rows()).toMatchObject([{ session_id: "s-late", mr_key: MR_KEY, stage: "build" }]);
  transcript("s-early", line("m-1", 1000, 11));
  await runSweep(input({ now: NOW + MINUTE }));
  expect(rows()).toMatchObject([
    {
      session_id: "s-early",
      run_id: "run-2",
      stage: null,
      attempt: null,
      mr_key: null,
      attribution: "run",
    },
  ]);
});

test("an earlier copy from a different session clears attribution held by a final run", async () => {
  seedRun(runs, REPO, "run-1", T0, 1, {
    status: "completed",
    stages: [
      { name: "build", status: "completed", startedAt: T0, endedAt: T0 + 10 * MINUTE },
      {
        name: "review",
        status: "completed",
        startedAt: T0 + 10 * MINUTE,
        endedAt: T0 + 20 * MINUTE,
      },
    ],
    fields: [{ key: "claude-sessions", value: JSON.stringify(["s-late", "s-early"]) }],
  });
  const runDb = new Database(join(runs, REPO, "run-1", "state.db"));
  runDb.exec(`UPDATE runs SET ended_at = ${T0 + 20 * MINUTE}`);
  runDb.close();

  transcript("s-late", line("m-1", 15 * MINUTE));
  await runSweep(input());
  expect(rows()).toMatchObject([{ session_id: "s-late", stage: "review" }]);

  transcript("s-early", line("m-1", 1000));
  await runSweep(input({ now: NOW + MINUTE }));
  expect(rows()).toMatchObject([{ session_id: "s-early", ts: T0 + 1000, stage: "build" }]);
});

test("a machine id failure on a later sweep does not fork the rows", async () => {
  workRun("run-1", "s-1");
  const path = transcript("s-1", line("m-1", 1000));
  await runSweep(input());
  appendFileSync(path, line("m-2", 2000));
  await runSweep(input({ machineId: async () => null, now: NOW + MINUTE }));
  expect(rows().map((r) => [r.machine_id, r.message_id])).toEqual([
    [M, "m-1"],
    [M, "m-2"],
  ]);
});

test("a session linked later is read from byte 0", async () => {
  transcript("s-1", line("m-1", 1000), line("m-2", 2000));
  expect((await runSweep(input())).messages).toBe(0);
  const second = await runSweep(input({ agents: [mrAgent("s-1")], now: NOW + MINUTE }));
  expect(second).toMatchObject({ files: 1, messages: 2 });
});

test("sessions linked to nothing are not read", async () => {
  workRun("run-1", "s-1");
  transcript("s-1", line("m-1", 1000));
  transcript("s-stranger", line("m-2", 2000));
  await runSweep(input());
  expect(rows().map((r) => r.message_id)).toEqual(["m-1"]);
  expect(inDb((db) => db.query("SELECT session_id FROM usage_files").all())).toEqual([
    { session_id: "s-1" },
  ]);
});

test("a session whose run is a test run is not read", async () => {
  seedRun(runs, REPO, "run-test", T0, 1, {
    fields: [
      { key: "test", value: "1" },
      { key: "claude-session", value: "s-1" },
    ],
  });
  transcript("s-1", line("m-1", 1000));
  await runSweep(
    input({
      agents: [{ id: "ag-1", sessionId: "s-1", subject: "run:run-test", label: null, caller: null }],
    }),
  );
  expect(rows()).toEqual([]);
});

test("agents link only after runs are snapshotted", async () => {
  workRun("run-1", "s-1");
  transcript("s-2", line("m-1", 1000));
  await runSweep(
    input({
      agents: [{ id: "ag-1", sessionId: "s-2", subject: "run:run-1", label: null, caller: null }],
    }),
  );
  expect(rows()).toMatchObject([{ session_id: "s-2", run_id: "run-1", mr_key: MR_KEY }]);
});

test("a doctor session is classified from its transcript in the same sweep", async () => {
  const head = `${JSON.stringify({ message: { content: "<command-name>/board:doctor</command-name>" } })}\n`;
  transcript("s-1", head, line("m-1", 1000));
  await runSweep(input({ agents: [mrAgent("s-1")] }));
  expect(inDb((db) => db.query("SELECT agent_kind FROM usage_sessions").all())).toEqual([
    { agent_kind: "doctor" },
  ]);
});

test("a held lock makes a second sweep return ran: false", async () => {
  workRun("run-1", "s-1");
  transcript("s-1", line("m-1", 1000));
  setMeta("sweep_lock", String(NOW - MINUTE));
  let asked = false;
  const result = await runSweep(
    input({
      machineId: async () => {
        asked = true;
        return M;
      },
    }),
  );
  expect(result).toEqual({
    ran: false,
    files: 0,
    messages: 0,
    skippedLines: 0,
    conflicts: 0,
    durationMs: 0,
  });
  expect(asked).toBe(false);
  expect(meta("sweep_lock")).toBe(String(NOW - MINUTE));
  expect(meta("last_sweep_at")).toBeNull();
  expect(rows()).toEqual([]);
  expect(inDb((db) => db.query("SELECT COUNT(*) AS n FROM usage_runs").get())).toEqual({ n: 0 });
});

test("a lock exactly 30 minutes old still holds", async () => {
  setMeta("sweep_lock", String(NOW - 30 * MINUTE));
  expect((await runSweep(input())).ran).toBe(false);
});

test("a lock older than 30 minutes is taken over", async () => {
  workRun("run-1", "s-1");
  transcript("s-1", line("m-1", 1000));
  setMeta("sweep_lock", String(NOW - 30 * MINUTE - 1));
  const result = await runSweep(input());
  expect(result).toMatchObject({ ran: true, messages: 1 });
  expect(meta("sweep_lock")).toBeNull();
});

test("two sweeps at once: only one takes the lock", async () => {
  workRun("run-1", "s-1");
  transcript("s-1", line("m-1", 1000));
  const results = await Promise.all([runSweep(input()), runSweep(input())]);
  expect(results.map((r) => r.ran).sort()).toEqual([false, true]);
  expect(meta("sweep_lock")).toBeNull();
});

test("a sweep whose lock was taken over leaves the new holder's lock", async () => {
  await runSweep(
    input({
      machineId: async () => {
        inDb((db) =>
          db.query("UPDATE usage_meta SET value = ? WHERE key = 'sweep_lock'").run(String(NOW + 1)),
        );
        return M;
      },
    }),
  );
  expect(meta("sweep_lock")).toBe(String(NOW + 1));
});

test("a writer holding usage.db past the busy timeout reads as a held lock", async () => {
  openUsageDb(dbPath).close();
  const holder = new Database(dbPath);
  holder.exec("BEGIN IMMEDIATE");
  try {
    expect((await runSweep(input())).ran).toBe(false);
  } finally {
    holder.exec("ROLLBACK");
    holder.close();
  }
}, 10_000);

test("a failed sweep releases the lock and does not advance last_sweep_at", async () => {
  workRun("run-1", "s-1");
  transcript("s-1", line("m-1", 1000));
  inDb((db) =>
    db.exec(`
      CREATE TRIGGER block_attribution BEFORE UPDATE OF attribution ON usage_messages
      BEGIN SELECT RAISE(ABORT, 'attribution blocked'); END;
    `),
  );
  await expect(runSweep(input())).rejects.toThrow("attribution blocked");
  expect(meta("sweep_lock")).toBeNull();
  expect(meta("last_sweep_at")).toBeNull();
});

test("a sweep records its start time and its status", async () => {
  workRun("run-1", "s-1");
  transcript("s-1", line("m-1", 1000));
  const result = await runSweep(input());
  expect(meta("last_sweep_at")).toBe(String(NOW));
  expect(meta("last_sweep_ms")).toBe(String(result.durationMs));
  expect(meta("skipped_lines")).toBe("0");
  expect(meta("conflicts")).toBe("0");
  expect(meta("sweep_lock")).toBeNull();
});

test("skipped lines and conflicts add up across sweeps", async () => {
  workRun("run-1", "s-1");
  const path = transcript("s-1", line("m-1", 1000), `{"type":"assistant"}\n`);
  expect((await runSweep(input())).skippedLines).toBe(1);
  appendFileSync(path, `{"type":"assistant"}\n{"type":"assistant"}\n`);
  expect((await runSweep(input({ now: NOW + MINUTE }))).skippedLines).toBe(2);
  expect(meta("skipped_lines")).toBe("3");
});

test("a file that throws is logged and the next file is still read", async () => {
  workRun("run-1", "s-bad", T0);
  workRun("run-2", "s-good", T0);
  transcript("s-bad", line("m-ok", 1000), line("m-boom", 2000));
  transcript("s-good", line("m-good", 3000));
  inDb((db) =>
    db.exec(`
      CREATE TRIGGER boom BEFORE INSERT ON usage_messages WHEN NEW.message_id = 'm-boom'
      BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `),
  );
  const warnings: Array<[Record<string, unknown>, string]> = [];
  const result = await runSweep(
    input({
      log: { warn: (c, m) => warnings.push([c, m]), debug: () => {} },
    }),
  );
  expect(result).toMatchObject({ ran: true, messages: 1 });
  expect(rows().map((r) => r.message_id)).toEqual(["m-good"]);
  expect(inDb((db) => db.query("SELECT session_id FROM usage_files").all())).toEqual([
    { session_id: "s-good" },
  ]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.[0]).toMatchObject({ path: expect.stringContaining("s-bad") });
});

test("more than 1% skipped lines logs a warning, and 1% does not", async () => {
  workRun("run-1", "s-1");
  const ok = Array.from({ length: 99 }, (_, i) => line(`m-${i}`, i));
  const path = transcript("s-1", ...ok, `{"type":"assistant"}\n`);
  const warnings: string[] = [];
  const log = { warn: (_: object, m: string) => warnings.push(m), debug: () => {} };
  await runSweep(input({ log }));
  expect(warnings).toEqual([]);
  appendFileSync(path, `${line("m-a", 1000)}{"type":"assistant"}\n`);
  await runSweep(input({ log, now: NOW + MINUTE }));
  expect(warnings).toHaveLength(1);
});

test("an unresolved MR is logged at debug", async () => {
  seedRun(runs, REPO, "run-1", T0, 1, {
    fields: [{ key: "mr", value: "not an mr" }],
  });
  const debug: Array<[Record<string, unknown>, string]> = [];
  await runSweep(input({ log: { warn: () => {}, debug: (c, m) => debug.push([c, m]) } }));
  expect(debug).toHaveLength(1);
  expect(debug[0]?.[0]).toEqual({ unresolvedMr: 1 });
});

describe("one MR, swept and read back", () => {
  const FINISHED = T0 + 90 * MINUTE;
  const AFTER = FINISHED + MINUTE;

  function kindRun(
    id: string,
    workType: string,
    startMin: number,
    sessions: string[],
    stage: string,
    mr: string | null = MR_URL,
  ): void {
    const startedAt = T0 + startMin * MINUTE;
    seedRun(runs, REPO, id, startedAt, 1, {
      status: "running",
      stages: [{ name: stage, status: "running", startedAt }],
      fields: [
        ...(mr ? [{ key: "mr", value: mr }] : []),
        { key: "claude-session", value: sessions.at(-1) ?? "" },
        { key: "claude-sessions", value: JSON.stringify(sessions) },
      ],
    });
    const db = new Database(join(runs, REPO, id, "state.db"));
    db.run("UPDATE runs SET work_type = ?", [workType]);
    db.close();
  }

  function finish(id: string, endMin: number): void {
    const db = new Database(join(runs, REPO, id, "state.db"));
    db.run("UPDATE runs SET status = 'done', ended_at = ?", [T0 + endMin * MINUTE]);
    db.run("UPDATE stages SET status = 'done', ended_at = ?", [T0 + endMin * MINUTE]);
    db.close();
  }

  const DOCTOR_HEAD = `${JSON.stringify({
    type: "user",
    message: { content: "<command-name>/board:doctor</command-name>" },
  })}\n`;

  function seedMr(): AgentLink[] {
    kindRun("run-work", "feature", 10, ["s-work", "s-work-2"], "build");
    transcript("s-work", line("m-setup", 5 * MINUTE, 1), line("m-build", 12 * MINUTE, 2));
    subagentTranscript("s-work", "aaa", line("m-sub", 13 * MINUTE, 4));
    transcript("s-work-2", line("m-build", 12 * MINUTE, 2), line("m-resumed", 23 * MINUTE, 8));

    kindRun("run-r1", "receive-review", 40, ["s-r1"], "respond");
    transcript("s-r1", line("m-r1", 41 * MINUTE, 16));
    kindRun("run-r2", "receive-review", 50, ["s-r2"], "respond", null);
    transcript("s-r2", line("m-r2", 51 * MINUTE, 32));

    kindRun("run-shared-a", "review", 60, ["s-shared"], "review");
    kindRun("run-shared-b", "review", 65, ["s-shared"], "review");
    transcript("s-shared", line("m-sh1", 61 * MINUTE, 64), line("m-sh2", 66 * MINUTE, 128));

    transcript("s-doctor", DOCTOR_HEAD, line("m-doc", 70 * MINUTE, 256));
    return [mrAgent("s-r2"), mrAgent("s-doctor")];
  }
  const OUTPUT = 511;

  const byRun = (key: string) =>
    usageMr(dbPath, key)?.runs.map((r) => [r.runId, r.kind, r.round, r.totals.output]);

  async function sweepFinished(agents: AgentLink[]): Promise<void> {
    for (const [id, end] of [
      ["run-work", 30],
      ["run-r1", 45],
      ["run-r2", 55],
      ["run-shared-a", 62],
      ["run-shared-b", 68],
    ] as const) {
      finish(id, end);
    }
    await runSweep(input({ agents, now: AFTER }));
    await runSweep(input({ agents, now: AFTER + MINUTE }));
  }

  test("every kind of run counts once on one MR", async () => {
    const agents = seedMr();
    const result = await runSweep(input({ agents, now: FINISHED }));
    // The resumed session replays m-build, which the conflict count reports.
    expect(result).toMatchObject({ conflicts: 1, skippedLines: 0 });

    const expected = [
      ["run-work", "work", null, 15],
      ["run-r1", "respond", 1, 16],
      ["run-r2", "respond", 2, 32],
      ["run-shared-a", "review", null, 64],
      ["run-shared-b", "review", null, 128],
      [null, "doctor", null, 256],
    ];
    expect(byRun(MR_KEY)).toEqual(expected);
    expect(usageMr(dbPath, MR_KEY)?.totals.output).toBe(OUTPUT);
    expect(rows().length).toBe(9);

    const list = usageMrs(dbPath, { now: FINISHED });
    expect(list.summary.mrCount).toBe(1);
    expect(list.mrs[0]).toMatchObject({ mrKey: MR_KEY, runCount: 5, roundCount: 2 });
    expect(list.summary.totals.output).toBe(OUTPUT);
  });

  test("final totals survive deleting the run DBs and transcripts", async () => {
    const agents = seedMr();
    await runSweep(input({ agents, now: FINISHED }));
    await sweepFinished(agents);
    const settled = usageMr(dbPath, MR_KEY);
    const listed = usageMrs(dbPath, { now: AFTER });
    expect(settled?.totals.output).toBe(OUTPUT);

    rmSync(runs, { recursive: true, force: true });
    mkdirSync(runs);
    rmSync(join(config, "projects"), { recursive: true, force: true });
    await runSweep(input({ now: AFTER + 2 * MINUTE }));

    expect(usageMr(dbPath, MR_KEY)).toEqual(settled);
    expect(usageMrs(dbPath, { now: AFTER })).toEqual(listed);
  });

  test("a reopened run re-attributes and the total holds", async () => {
    kindRun("run-work", "feature", 10, ["s-work"], "build");
    transcript("s-work", line("m-1", 12 * MINUTE, 2), line("m-late", 40 * MINUTE, 4));
    finish("run-work", 30);
    await runSweep(input({ now: AFTER }));
    await runSweep(input({ now: AFTER + MINUTE }));
    const late = () => rows().find((r) => r.message_id === "m-late");
    expect(late()).toMatchObject({ attribution: "session", stage: null });

    const db = new Database(join(runs, REPO, "run-work", "state.db"));
    db.run("UPDATE runs SET status = 'running', ended_at = NULL");
    db.run(
      "INSERT INTO stages (run_id, name, status, attempt, started_at) VALUES ('run-work', 'build', 'running', 2, ?)",
      [T0 + 35 * MINUTE],
    );
    db.close();
    await runSweep(input({ now: AFTER + 2 * MINUTE }));

    expect(late()).toMatchObject({ attribution: "stage", stage: "build", attempt: 2 });
    expect(usageMr(dbPath, MR_KEY)?.totals.output).toBe(6);
    expect(rows().length).toBe(2);
  });
});

test("a new row starts unattributed", async () => {
  transcript("s-1", line("m-1", 1000));
  const agent = { id: "ag-1", sessionId: "s-1", subject: "mr:unknown", label: null, caller: null };
  await runSweep(input({ agents: [agent] }));
  expect(rows()).toMatchObject([{ attribution: "none", run_id: null, mr_key: null }]);
});
