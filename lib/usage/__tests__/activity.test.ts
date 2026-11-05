import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { usageActivity } from "../activity.ts";
import { openUsageDb } from "../store.ts";

const M = "machine-a";
const T = new Date(2026, 9, 8, 12).getTime();

let dir: string;
let dbPath: string;
let db: ReturnType<typeof openUsageDb>;
let seq = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-activity-"));
  dbPath = join(dir, "usage.db");
  db = openUsageDb(dbPath);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function message(ts: number, o: { runId?: string; session?: string; stage?: string } = {}): void {
  db.query(
    `INSERT INTO usage_messages (machine_id, message_id, session_id, ts, run_id, stage, attempt, attribution)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'session')`,
  ).run(M, `m-${++seq}`, o.session ?? "s", ts, o.runId ?? null, o.stage ?? null, o.stage ? 1 : null);
}

function transcript(lines: unknown[], session = "s"): string {
  const path = join(dir, `${session}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  db.query("INSERT INTO usage_files (path, session_id) VALUES (?, ?)").run(path, session);
  return path;
}

const at = (ms: number) => new Date(ms).toISOString();
const user = (ms: number, content: unknown, extra = {}) => ({
  type: "user",
  timestamp: at(ms),
  message: { content },
  ...extra,
});
const assistant = (ms: number, ...content: unknown[]) => ({
  type: "assistant",
  timestamp: at(ms),
  message: { content },
});
const tool = (id: string, name: string, input = {}) => ({ type: "tool_use", id, name, input });

function seedRun(): void {
  db.query(
    `INSERT INTO usage_stages (machine_id, run_id, name, attempt, status, started_at, ended_at)
     VALUES (?, 'r', 'ship', 1, 'done', ?, ?)`,
  ).run(M, T, T + 1000);
  message(T + 500, { runId: "r", stage: "ship" });
  message(T + 5000, { runId: "r" });
  message(T + 9000, { runId: "r" });
}

test("lists the prompts, subagents and tools of an after-the-last-stage window", async () => {
  seedRun();
  transcript([
    user(T, "ship it"),
    assistant(T + 500, tool("a", "Bash")),
    user(T + 4000, "the reviewer wants a smaller diff"),
    assistant(T + 5000, tool("b", "Bash"), tool("c", "Edit")),
    assistant(T + 6000, tool("d", "Agent", { description: "Trim the diff", subagent_type: "general-purpose" })),
    user(T + 9500, "after the window"),
  ]);
  const data = await usageActivity(dbPath, { runId: "r", outside: "after" });
  expect(data?.transcriptFound).toBe(true);
  expect(data?.prompts.map((p) => p.text)).toEqual(["the reviewer wants a smaller diff"]);
  expect(data?.tools).toEqual([
    { name: "Agent", count: 1 },
    { name: "Bash", count: 1 },
    { name: "Edit", count: 1 },
  ]);
  expect(data?.agents).toEqual([{ ts: T + 6000, description: "Trim the diff", type: "general-purpose" }]);
});

test("keeps the prompt that set a stage off, even from before its window", async () => {
  seedRun();
  transcript([user(T - 100, "older"), user(T, "ship it"), assistant(T + 500, tool("a", "Bash"))]);
  const data = await usageActivity(dbPath, { runId: "r", stage: "ship", attempt: 1 });
  expect(data?.prompts.map((p) => p.text)).toEqual(["ship it"]);
});

test("leaves out tool results, injected text and wrapped commands", async () => {
  seedRun();
  transcript([
    user(T + 5000, [{ type: "tool_result", content: "secret output" }]),
    user(T + 5000, "reminder", { isMeta: true }),
    user(T + 5000, "<task-notification>done</task-notification>"),
    user(T + 5000, "side", { isSidechain: true }),
    user(T + 5000, "This session is being continued", { isCompactSummary: true }),
    user(T + 5000, "[Request interrupted by user]"),
    user(T + 5000, [{ type: "text", text: "real one" }]),
  ]);
  const data = await usageActivity(dbPath, { runId: "r", outside: "after" });
  expect(data?.prompts.map((p) => p.text)).toEqual(["real one"]);
});

test("clips a long prompt and counts past the cap", async () => {
  seedRun();
  const lines = Array.from({ length: 45 }, (_, i) => user(T + 5000 + i, "x".repeat(900)));
  transcript(lines);
  const data = await usageActivity(dbPath, { runId: "r", outside: "after" });
  expect(data?.prompts).toHaveLength(40);
  expect(data?.promptCount).toBe(45);
  expect(data?.prompts[0]?.text.length).toBe(503);
});

test("says when the transcript is gone", async () => {
  seedRun();
  const path = transcript([]);
  rmSync(path);
  const data = await usageActivity(dbPath, { runId: "r", outside: "after" });
  expect(data?.transcriptFound).toBe(false);
  expect(data?.prompts).toEqual([]);
});

test("reads an agent-only session by its id", async () => {
  message(T, { session: "agent" });
  transcript([user(T - 10, "fix the pipeline")], "agent");
  const data = await usageActivity(dbPath, { sessionId: "agent" });
  expect(data?.prompts.map((p) => p.text)).toEqual(["fix the pipeline"]);
});

test("reads nothing for a row with no messages", async () => {
  expect(await usageActivity(dbPath, { runId: "missing" })).toBeNull();
});
