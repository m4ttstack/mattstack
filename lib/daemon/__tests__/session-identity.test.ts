import { describe, expect, test } from "bun:test";
import { identifySession, sessionDisplayName, type IdentifyDeps } from "../session-identity";

const deps = (over: Partial<IdentifyDeps> = {}): IdentifyDeps => ({
  sessionForPid: () => "s-1",
  presenceForSession: () => ({ handle: "rt-555", pane: "p7" }),
  listRooms: () => [{ room: "mattstack" }, { room: "herd-x" }],
  ...over,
});

describe("identifySession", () => {
  test("full identity", () => {
    expect(identifySession(601, deps())).toEqual({
      sessionId: "s-1",
      handle: "rt-555",
      pane: "p7",
      rooms: ["mattstack", "herd-x"],
    });
  });

  test("no registry entry returns null", () => {
    expect(identifySession(601, deps({ sessionForPid: () => null }))).toBeNull();
  });

  test("no presence keeps the session id with no rooms", () => {
    expect(identifySession(601, deps({ presenceForSession: () => null }))).toEqual({
      sessionId: "s-1",
      rooms: [],
    });
  });

  test("a throwing dep returns what it had", () => {
    const out = identifySession(
      601,
      deps({
        listRooms: () => {
          throw new Error("boom");
        },
      }),
    );
    expect(out).toEqual({ sessionId: "s-1", handle: "rt-555", pane: "p7", rooms: [] });
  });
});

describe("sessionDisplayName", () => {
  test("display name falls back to pid and label", () => {
    expect(sessionDisplayName(601, "claude", null)).toBe("pid 601 (claude)");
    expect(sessionDisplayName(601, "claude", { sessionId: "s-1", rooms: [] })).toBe("pid 601 (claude)");
    expect(sessionDisplayName(601, "claude", { sessionId: "s-1", handle: "rt-555", rooms: [] })).toBe("rt-555");
  });
});
