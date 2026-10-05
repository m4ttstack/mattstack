import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import * as policy from "../cases/policy";
import { run as questions } from "../cases/questions";
import { createEvidence } from "../evidence";

test("async item emission already buffered before an answer cannot prove completion", async () => {
  const request = {
    kind: "request",
    method: "item/tool/requestUserInput",
    id: 1,
    connection: "C",
    params: { threadId: "T", turnId: "U", itemId: "I", isBlocking: false },
  };
  const emitted = {
    method: "item/completed",
    params: { threadId: "T", turnId: "U", item: { id: "I" } },
  };
  let n = 0;
  let responses = 0;
  const c = {
    call: async (method: string) =>
      method === "thread/read"
        ? { thread: { status: { type: "idle" } } }
        : method === "thread/resume"
          ? { model: "test" }
          : { turn: { id: "U" } },
    next: async () => (n++ === 0 ? request : emitted),
    respond: () => {
      responses++;
    },
    close: () => {},
  };
  const rows = await questions(
    {
      launchWorker: async () => ({ threadId: "T" }),
      connect: async () => c,
    } as any,
    { record: () => {} } as any,
    ["G4"]
  );
  expect(rows[0]!.verdict).toBe("partial");
  expect(responses).toBe(0);
});

test("stop hook rows alone never establish native continuation", () => {
  const rows = [
    {
      event: "Stop",
      at: 1100,
      payload: { session_id: "T" },
      decision: { exitCode: 2, consumeOnce: true },
    },
    {
      event: "Stop",
      at: 3100,
      payload: { session_id: "T" },
      decision: { exitCode: 0 },
    },
  ];
  const hook = (status: string, start: number) => ({
    method: "hook/completed",
    params: {
      threadId: "T",
      turnId: "U",
      run: {
        eventName: "stop",
        status,
        sourcePath: "/probe/config",
        displayOrder: 0,
        startedAt: start,
        completedAt: start,
        entries: [{ text: "Harness spike refused this action." }],
      },
    },
  });
  const blocked = hook("blocked", 1),
    allowed = hook("completed", 3);
  const continuation = {
    method: "item/completed",
    params: {
      threadId: "T",
      turnId: "U",
      item: { type: "agentMessage", text: "CONTINUED" },
    },
  };
  const completed = {
    method: "turn/completed",
    params: { threadId: "T", turn: { id: "U", status: "completed" } },
  };
  expect(
    policy.stopContinuationObserved(
      rows,
      [blocked, allowed, completed] as any,
      "T"
    )
  ).toBe(false);
  expect(
    policy.stopContinuationObserved(
      rows,
      [blocked, continuation, allowed, completed] as any,
      "T"
    )
  ).toBe(true);
  expect(
    policy.stopContinuationObserved(
      rows,
      [
        blocked,
        {
          ...continuation,
          params: { ...continuation.params, turnId: "foreign" },
        },
        allowed,
        completed,
      ] as any,
      "T"
    )
  ).toBe(false);
  expect(
    policy.stopContinuationObserved(
      rows.map(r => ({ ...r, payload: { session_id: "foreign" } })),
      [blocked, continuation, allowed, completed] as any,
      "T"
    )
  ).toBe(false);
});

test("repeated output directory is refused without overwriting prior evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-reuse-"));
  const ev = createEvidence(dir, { codex: "first" });
  ev.record("ping", { ok: true });
  const report = ev.write();
  const before = readFileSync(report, "utf8");
  expect(() => createEvidence(dir, { codex: "second" })).toThrow("empty");
  expect(readFileSync(report, "utf8")).toBe(before);
});
