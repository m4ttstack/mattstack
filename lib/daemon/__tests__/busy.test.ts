import { describe, expect, test } from "bun:test";
import { busyReasons, createBusyTracker, LONG_COMMANDS } from "../busy.ts";

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

  test("running is sorted", () => {
    const tracker = createBusyTracker();
    tracker.begin("worktree:create");
    tracker.begin("mr:fetch-job-trace");
    expect(tracker.running()).toEqual(["mr:fetch-job-trace", "worktree:create"]);
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
