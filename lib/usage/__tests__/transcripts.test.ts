import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { indexTranscripts, readFrom, type TranscriptFile } from "../transcripts.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "usage-transcripts-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function session(config: string, id: string, project = "proj-a") {
  const p = join(dir, config, "projects", project);
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, `${id}.jsonl`), "");
  return p;
}

function entry(
  id: string,
  extra: Record<string, unknown> = {},
  model = "claude-opus-4",
  ts = "2026-01-02T00:00:00.000Z",
) {
  return JSON.stringify({
    timestamp: ts,
    sessionId: "ignored",
    message: {
      id,
      model,
      usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, ...extra },
    },
  });
}

function fixture(content: string): TranscriptFile {
  const path = join(dir, "t.jsonl");
  writeFileSync(path, content);
  return {
    path,
    sessionId: "s1",
    configDir: dir,
    subagentId: null,
    subagentType: null,
    subagentModel: null,
  };
}

test("indexes only linked sessions", () => {
  session("c1", "s1");
  session("c1", "s2");
  const files = indexTranscripts([join(dir, "c1")], new Set(["s1"]));
  expect(files.map((f) => f.sessionId)).toEqual(["s1"]);
  expect(files[0]!.subagentId).toBeNull();
});

test("finds subagent files and reads their meta", () => {
  const p = session("c1", "s1");
  const sub = join(p, "s1", "subagents");
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, "agent-a1.jsonl"), "");
  writeFileSync(join(sub, "agent-a1.meta.json"), '{"agentType":"general-purpose","model":"opus"}');
  writeFileSync(join(sub, "agent-a2.jsonl"), "");
  const files = indexTranscripts([join(dir, "c1")], new Set(["s1"]));
  const a1 = files.find((f) => f.subagentId === "a1")!;
  expect(a1.subagentType).toBe("general-purpose");
  expect(a1.subagentModel).toBe("opus");
  expect(files.find((f) => f.subagentId === "a2")!.subagentType).toBeNull();
  expect(files.length).toBe(3);
});

test("a session in two config dirs yields one file", () => {
  session("c1", "s1");
  session("c2", "s1");
  const files = indexTranscripts([join(dir, "c1"), join(dir, "c2")], new Set(["s1"]));
  expect(files.length).toBe(1);
  expect(files[0]!.configDir).toBe(join(dir, "c1"));
});

test("a missing config dir yields nothing", () => {
  expect(indexTranscripts([join(dir, "nope")], new Set(["s1"]))).toEqual([]);
});

test("maps usage fields", () => {
  const f = fixture(
    entry("m1", {
      cache_creation: { ephemeral_5m_input_tokens: 7, ephemeral_1h_input_tokens: 491 },
      output_tokens_details: { thinking_tokens: 9 },
      speed: "fast",
      service_tier: "standard",
    }) + "\n",
  );
  expect(readFrom(f, 0).messages[0]).toMatchObject({
    messageId: "m1",
    sessionId: "s1",
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite5m: 7,
    cacheWrite1h: 491,
    thinking: 9,
    speed: "fast",
    serviceTier: "standard",
  });
});

test("skips entries with no usage and the synthetic model", () => {
  const f = fixture(
    [
      JSON.stringify({ timestamp: "2026-01-02T00:00:00.000Z", message: { id: "x", model: "m" } }),
      entry("syn", {}, "<synthetic>"),
      entry("ok"),
    ].join("\n") + "\n",
  );
  const r = readFrom(f, 0);
  expect(r.messages.map((m) => m.messageId)).toEqual(["ok"]);
  expect(r.skippedLines).toBe(0);
});

test("dedupes a repeated message id within a read", () => {
  const f = fixture(
    entry("m1", { output_tokens: 5 }) + "\n" + entry("m1", { output_tokens: 8 }) + "\n",
  );
  const { messages } = readFrom(f, 0);
  expect(messages.length).toBe(1);
  expect(messages[0]!.output).toBe(8);
});

test("a partial last line stays unread", () => {
  const first = entry("m1") + "\n";
  const second = entry("m2");
  const f = fixture(first + second.slice(0, 20));
  const r = readFrom(f, 0);
  expect(r.messages.map((m) => m.messageId)).toEqual(["m1"]);
  expect(r.nextOffset).toBe(Buffer.byteLength(first));
  appendFileSync(f.path, second.slice(20) + "\n");
  expect(readFrom(f, r.nextOffset).messages.map((m) => m.messageId)).toEqual(["m2"]);
});

test("nextOffset counts bytes for multi-byte text", () => {
  const content = JSON.stringify({ note: 'héllo ✓ "usage"' }) + "\n" + entry("m1") + "\n";
  expect(readFrom(fixture(content), 0).nextOffset).toBe(Buffer.byteLength(content));
});

test("a malformed line is skipped and counted", () => {
  const r = readFrom(fixture('{"usage": broken\n' + entry("m1") + "\n"), 0);
  expect(r.skippedLines).toBe(1);
  expect(r.messages.length).toBe(1);
});

test("ts is epoch ms", () => {
  expect(readFrom(fixture(entry("m1") + "\n"), 0).messages[0]!.ts).toBe(Date.UTC(2026, 0, 2));
});

test("subagent messages carry the file's session and subagent fields", () => {
  const f = { ...fixture(entry("m1") + "\n"), subagentId: "a1", subagentType: "t", subagentModel: "opus" };
  expect(readFrom(f, 0).messages[0]).toMatchObject({
    sessionId: "s1",
    subagentId: "a1",
    subagentType: "t",
    subagentModel: "opus",
  });
});
