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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-activity-"));
  dbPath = join(dir, "usage.db");
  db = openUsageDb(dbPath);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function message(id: string, ts: number, o: { runId?: string; session?: string; stage?: string } = {}): void {
  db.query(
    `INSERT INTO usage_messages (machine_id, message_id, session_id, ts, run_id, stage, attempt, attribution)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'session')`,
  ).run(M, id, o.session ?? "s", ts, o.runId ?? null, o.stage ?? null, o.stage ? 1 : null);
}

function stage(name: string, startedAt: number, endedAt: number): void {
  db.query(
    `INSERT INTO usage_stages (machine_id, run_id, name, attempt, status, started_at, ended_at)
     VALUES (?, 'r', ?, 1, 'done', ?, ?)`,
  ).run(M, name, startedAt, endedAt);
}

function transcript(lines: unknown[], session = "s", name = session): string {
  const path = join(dir, `${name}.jsonl`);
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
const assistant = (ms: number, id: string, ...content: unknown[]) => ({
  type: "assistant",
  timestamp: at(ms),
  message: { id, content },
});
const tool = (id: string, name: string, input = {}) => ({ type: "tool_use", id, name, input });
const queued = (ms: number, prompt: string, commandMode = "prompt") => ({
  type: "attachment",
  timestamp: at(ms),
  attachment: { type: "queued_command", commandMode, prompt },
});

/** One stage, then two messages after it. */
function seedRun(): void {
  stage("ship", T, T + 1000);
  message("in-stage", T + 500, { runId: "r", stage: "ship" });
  message("after-1", T + 5000, { runId: "r" });
  message("after-2", T + 9000, { runId: "r" });
}

const after = () => usageActivity(dbPath, { runId: "r", outside: "after" });
const texts = (data: Awaited<ReturnType<typeof usageActivity>>) => data?.prompts.map((p) => p.text);

test("lists the prompts, subagents and tools of an after-the-last-stage window", async () => {
  seedRun();
  transcript([
    user(T, "ship it"),
    assistant(T + 500, "in-stage", tool("a", "Bash")),
    user(T + 4000, "the reviewer wants a smaller diff"),
    assistant(T + 5000, "after-1", tool("b", "Bash"), tool("c", "Edit")),
    assistant(T + 6000, "after-2", tool("d", "Agent", { description: "Trim the diff", subagent_type: "general-purpose" })),
    user(T + 9500, "out of scope"),
    assistant(T + 9600, "later", tool("e", "Read")),
  ]);
  const data = await after();
  expect(data?.transcriptFound).toBe(true);
  expect(texts(data)).toEqual(["the reviewer wants a smaller diff"]);
  expect(data?.tools).toEqual([
    { name: "Agent", count: 1 },
    { name: "Bash", count: 1 },
    { name: "Edit", count: 1 },
  ]);
  expect(data?.agents).toEqual([{ ts: T + 6000, description: "Trim the diff", type: "general-purpose" }]);
});

test("a between row leaves out the stage that sits between its gaps", async () => {
  stage("plan", T, T + 100);
  stage("build", T + 2000, T + 3000);
  stage("ship", T + 5000, T + 6000);
  message("gap-1", T + 1000, { runId: "r" });
  message("in-build", T + 2500, { runId: "r", stage: "build" });
  message("gap-2", T + 4000, { runId: "r" });
  transcript([
    user(T + 900, "first gap"),
    assistant(T + 1000, "gap-1", tool("a", "Read")),
    user(T + 2400, "build it"),
    assistant(T + 2500, "in-build", tool("b", "Edit")),
    user(T + 3900, "second gap"),
    assistant(T + 4000, "gap-2", tool("c", "Bash")),
  ]);
  const data = await usageActivity(dbPath, { runId: "r", outside: "between" });
  expect(texts(data)).toEqual(["first gap", "second gap"]);
  expect(data?.tools.map((t) => t.name)).toEqual(["Bash", "Read"]);
});

test("counts every tool of a message split across lines", async () => {
  seedRun();
  transcript([
    assistant(T + 4000, "after-1", tool("a", "Read")),
    assistant(T + 4500, "after-1", tool("b", "Read")),
    assistant(T + 5000, "after-1", tool("c", "Read")),
  ]);
  expect((await after())?.tools).toEqual([{ name: "Read", count: 3 }]);
});

test("keeps the prompt that set a stage off, even from before its window", async () => {
  seedRun();
  transcript([
    user(T - 100, "older"),
    user(T - 50, "ship it"),
    assistant(T - 40, "earlier", tool("x", "Bash")),
    assistant(T + 500, "in-stage", tool("a", "Bash")),
  ]);
  const data = await usageActivity(dbPath, { runId: "r", stage: "ship", attempt: 1 });
  expect(texts(data)).toEqual(["ship it"]);
});

test("reads a prompt typed mid-turn, but not a queued notification", async () => {
  seedRun();
  transcript([
    queued(T + 4000, "also fix the title"),
    queued(T + 4100, "<task-notification>done</task-notification>"),
    queued(T + 4200, "bash thing", "bash"),
    assistant(T + 5000, "after-1"),
  ]);
  expect(texts(await after())).toEqual(["also fix the title"]);
});

test("rebuilds a slash command and keeps a prompt that starts with a tag", async () => {
  seedRun();
  transcript([
    user(T + 4000, "<command-message>work</command-message>\n<command-name>/acme:work</command-name>\n<command-args>WEB-1</command-args>"),
    user(T + 4100, "<command-name>/clear</command-name>"),
    user(T + 4200, "<div>why is this wrapping</div>"),
    assistant(T + 5000, "after-1"),
  ]);
  expect(texts(await after())).toEqual(["/acme:work WEB-1", "/clear", "<div>why is this wrapping</div>"]);
});

test("leaves out tool results and injected text", async () => {
  seedRun();
  transcript([
    user(T + 4000, [{ type: "tool_result", content: "secret output" }]),
    user(T + 4000, "reminder", { isMeta: true }),
    user(T + 4000, "<task-notification>done</task-notification>"),
    user(T + 4000, "<system-reminder>x</system-reminder>"),
    user(T + 4000, "side", { isSidechain: true }),
    user(T + 4000, "This session is being continued", { isCompactSummary: true }),
    user(T + 4000, "[Request interrupted by user]"),
    user(T + 4000, [{ type: "text", text: "real one" }]),
    assistant(T + 5000, "after-1"),
  ]);
  expect(texts(await after())).toEqual(["real one"]);
});

test("a prompt repeated across a forked transcript shows once", async () => {
  seedRun();
  const lines = [user(T + 4000, "same prompt"), assistant(T + 5000, "after-1", tool("a", "Bash"))];
  transcript(lines, "s", "parent");
  transcript(lines, "s", "fork");
  const data = await after();
  expect(texts(data)).toEqual(["same prompt"]);
  expect(data?.promptCount).toBe(1);
  expect(data?.tools).toEqual([{ name: "Bash", count: 1 }]);
});

test("clips a long prompt and counts past the cap", async () => {
  seedRun();
  const lines = Array.from({ length: 45 }, (_, i) => user(T + 4000 + i, `${i} ${"x".repeat(900)}`));
  transcript([...lines, assistant(T + 5000, "after-1")]);
  const data = await after();
  expect(data?.prompts).toHaveLength(40);
  expect(data?.promptCount).toBe(45);
  expect(data?.prompts[0]?.text.length).toBe(503);
});

test("says when the transcript is gone", async () => {
  seedRun();
  rmSync(transcript([]));
  const data = await after();
  expect(data?.transcriptFound).toBe(false);
  expect(data?.prompts).toEqual([]);
});

test("reads an agent-only session by its id", async () => {
  message("agent-1", T, { session: "agent" });
  transcript([user(T - 10, "fix the pipeline"), assistant(T, "agent-1")], "agent");
  expect(texts(await usageActivity(dbPath, { sessionId: "agent" }))).toEqual(["fix the pipeline"]);
});

test("reads nothing for a row with no messages", async () => {
  expect(await usageActivity(dbPath, { runId: "missing" })).toBeNull();
});
