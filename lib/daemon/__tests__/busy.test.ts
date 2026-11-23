import { describe, expect, test } from "bun:test";
import { daemonBusyDataSchema } from "../../../packages/rt-client/src/command-schemas.ts";
import { busyReasons, createBusyTracker, LONG_COMMANDS } from "../busy.ts";
import { COMMAND_NAMES } from "../../../packages/rt-client/src/commands.ts";
import { createBusyHandlers } from "../handlers/busy.ts";

describe("busy tracker", () => {
  test("a long command counts from begin until its end function runs", () => {
    const tracker = createBusyTracker();
    const end = tracker.begin("worktree:provision");
    expect(tracker.running()).toEqual(["worktree:provision"]);
    end();
    expect(tracker.running()).toEqual([]);
  });

  test("a command outside LONG_COMMANDS is never counted", () => {
    const tracker = createBusyTracker();
    for (const cmd of ["chat:post", "events:wait", "daemon:busy"]) {
      expect(LONG_COMMANDS.has(cmd)).toBe(false);
      tracker.begin(cmd);
    }
    expect(tracker.running()).toEqual([]);
  });

  test("two runs of the same command report it once and clear only when both end", () => {
    const tracker = createBusyTracker();
    const a = tracker.begin("mr:action");
    const b = tracker.begin("mr:action");
    tracker.begin("mr:upload")();
    expect(tracker.running()).toEqual(["mr:action"]);
    a();
    expect(tracker.running()).toEqual(["mr:action"]);
    b();
    expect(tracker.running()).toEqual([]);
  });

  test("the end function is safe to call twice", () => {
    const tracker = createBusyTracker();
    const a = tracker.begin("mr:action");
    const b = tracker.begin("mr:action");
    a();
    a();
    expect(tracker.running()).toEqual(["mr:action"]);
    b();
    expect(tracker.running()).toEqual([]);
  });

  test("a branch sync, a push and a triage dispose count", () => {
    for (const cmd of ["worktree:sync", "worktree:push-branch", "worktree:triage-dispose"]) expect(LONG_COMMANDS.has(cmd)).toBe(true);
  });

  test("every long command is a real daemon verb", () => {
    for (const cmd of LONG_COMMANDS) expect(COMMAND_NAMES as readonly string[]).toContain(cmd);
  });

  test("running is sorted", () => {
    const tracker = createBusyTracker();
    tracker.begin("worktree:create");
    tracker.begin("mr:fetch-job-trace");
    expect(tracker.running()).toEqual(["mr:fetch-job-trace", "worktree:create"]);
  });
});

describe("daemon:busy", () => {
  test("the reply says busy with its reasons, and matches the verb's schema", async () => {
    const tracker = createBusyTracker();
    tracker.begin("worktree:create");
    const reply = await createBusyHandlers({ tracker, pendingReady: () => 1, creating: () => false })["daemon:busy"]();
    expect(reply).toEqual({ ok: true, data: { busy: true, reasons: ["command:worktree:create", "worktree-install"] } });
    expect(daemonBusyDataSchema.parse(reply.ok ? reply.data : null)).toEqual({ busy: true, reasons: ["command:worktree:create", "worktree-install"] });
  });

  test("nothing running replies not busy", async () => {
    const reply = await createBusyHandlers({ tracker: createBusyTracker(), pendingReady: () => 0, creating: () => false })["daemon:busy"]();
    expect(reply).toEqual({ ok: true, data: { busy: false, reasons: [] } });
  });

  test("the schema refuses a reply without reasons", () => {
    expect(daemonBusyDataSchema.safeParse({ busy: true }).success).toBe(false);
  });
});

describe("busyReasons", () => {
  test("busyReasons lists commands, then worktree-install, then worktree-create", () => {
    const tracker = createBusyTracker();
    tracker.begin("mr:action");
    expect(busyReasons({ tracker, pendingReady: () => 2, creating: () => true }))
      .toEqual(["command:mr:action", "worktree-install", "worktree-create"]);
  });

  test("nothing running gives no reasons", () => {
    expect(busyReasons({ tracker: createBusyTracker(), pendingReady: () => 0, creating: () => false })).toEqual([]);
  });
});
