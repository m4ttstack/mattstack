import { describe, expect, test } from "bun:test";
import { liveSelfPaneRef, selfPaneRef } from "../self-pane.ts";

describe("selfPaneRef", () => {
  test("undefined with no HERDR_PANE_ID", () => {
    expect(selfPaneRef({})).toBeUndefined();
  });
  test("bare ref on the visible server (no HERDR_SESSION)", () => {
    expect(selfPaneRef({ HERDR_PANE_ID: "w1:p1" })).toBe("w1:p1");
  });
  test("bare ref when HERDR_SESSION is set to anything but mattstack-bg", () => {
    expect(selfPaneRef({ HERDR_PANE_ID: "w1:p1", HERDR_SESSION: "bg" })).toBe("w1:p1");
  });
  test("bg: ref when HERDR_SESSION is mattstack-bg", () => {
    expect(selfPaneRef({ HERDR_PANE_ID: "w1:p1", HERDR_SESSION: "mattstack-bg" })).toBe("bg:w1:p1");
  });
});

describe("liveSelfPaneRef", () => {
  type Call = { sessionId: string; paneId?: string };
  type Reply = { ok: true; data: { paneId: string | null } } | { ok: false; error: string };
  const lookup = (reply: Reply) => {
    const calls: Call[] = [];
    return { calls, fn: async (a: Call) => { calls.push(a); return reply; } };
  };

  test("asks the daemon for the pane running this session and returns its answer", async () => {
    const l = lookup({ ok: true, data: { paneId: "w154:p2" } });
    expect(await liveSelfPaneRef({ HERDR_PANE_ID: "w14H:pE", CLAUDE_CODE_SESSION_ID: "s1" }, l.fn)).toBe("w154:p2");
    expect(l.calls).toEqual([{ sessionId: "s1", paneId: "w14H:pE" }]);
  });

  test("keeps the env ref when the daemon cannot answer", async () => {
    const l = lookup({ ok: false, error: "rt daemon unreachable" });
    expect(await liveSelfPaneRef({ HERDR_PANE_ID: "w1:p1", CLAUDE_CODE_SESSION_ID: "s1" }, l.fn)).toBe("w1:p1");
  });

  test("skips the daemon outside a Claude session or outside herdr", async () => {
    const l = lookup({ ok: true, data: { paneId: "w9:p9" } });
    expect(await liveSelfPaneRef({ HERDR_PANE_ID: "w1:p1" }, l.fn)).toBe("w1:p1");
    expect(await liveSelfPaneRef({ CLAUDE_CODE_SESSION_ID: "s1" }, l.fn)).toBeUndefined();
    expect(l.calls).toEqual([]);
  });

  test("sends a bg pane's claim as a bg: ref", async () => {
    const l = lookup({ ok: true, data: { paneId: "bg:w1:p1" } });
    await liveSelfPaneRef({ HERDR_PANE_ID: "w1:p1", HERDR_SESSION: "mattstack-bg", CLAUDE_CODE_SESSION_ID: "s1" }, l.fn);
    expect(l.calls).toEqual([{ sessionId: "s1", paneId: "bg:w1:p1" }]);
  });
});
