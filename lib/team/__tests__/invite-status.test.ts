import { describe, test, expect } from "bun:test";
import { readInviteStatuses } from "../invite-status.ts";
import { inviteRecordsPath, type InviteRecord } from "../invite-records.ts";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";

const HOME = "/fake-home";
const SLUG = "acme";
const NOW = Date.parse("2026-11-12T00:00:00.000Z");
const FUTURE = "2026-12-01T00:00:00.000Z";
const PAST = "2026-11-01T00:00:00.000Z";
const AGE_KEY = "age1g7smmpu6s9480mmmczw9vvcukwetteh3s7grduzr2zw74d8j99msrdyzhx";

function rec(id: string, expiresAt: string): InviteRecord {
  return { id, creatorSecret: `secret-${id}`, keyB64: "a2V5", expiresAt };
}

function probesWith(records: Record<string, InviteRecord> | null) {
  const files = records === null ? {} : { [inviteRecordsPath(HOME, SLUG)]: JSON.stringify(records) };
  return fakeProbes({ home: HOME, files });
}

const replyFor = (ids: string[]) => ({
  readReply: async (id: string) => (ids.includes(id) ? { blob: "blob" } : ("none" as const)),
});
const opensTo = (agePublicKey: string) => async () => ({ v: 1 as const, agePublicKey });

describe("readInviteStatuses", () => {
  test("replied when the reply opens to a valid age key", async () => {
    const r = await readInviteStatuses(probesWith({ alice: rec("a1", FUTURE) }), SLUG, {
      relay: replyFor(["a1"]),
      roster: [{ username: "Alice", teams: ["core", "web"] }],
      now: NOW,
      open: opensTo(AGE_KEY),
    });
    expect(r).toEqual({ invites: [{ handle: "alice", teams: ["core", "web"], expiresAt: FUTURE, state: "replied" }], relayFailed: false });
  });

  test("invited when the relay has no reply", async () => {
    const r = await readInviteStatuses(probesWith({ alice: rec("a1", FUTURE) }), SLUG, {
      relay: replyFor([]),
      roster: [],
      now: NOW,
      open: opensTo(AGE_KEY),
    });
    expect(r.invites[0]).toMatchObject({ state: "invited", teams: [] });
  });

  test("expired when no reply and expiresAt is past", async () => {
    const r = await readInviteStatuses(probesWith({ alice: rec("a1", PAST) }), SLUG, {
      relay: replyFor([]),
      roster: [],
      now: NOW,
      open: opensTo(AGE_KEY),
    });
    expect(r.invites[0]!.state).toBe("expired");
  });

  test("a reply on an expired invite still reads replied", async () => {
    const r = await readInviteStatuses(probesWith({ alice: rec("a1", PAST) }), SLUG, {
      relay: replyFor(["a1"]),
      roster: [],
      now: NOW,
      open: opensTo(AGE_KEY),
    });
    expect(r.invites[0]!.state).toBe("replied");
  });

  test("invited when the reply does not open", async () => {
    const r = await readInviteStatuses(probesWith({ alice: rec("a1", FUTURE) }), SLUG, {
      relay: replyFor(["a1"]),
      roster: [],
      now: NOW,
      open: async () => {
        throw new Error("bad tag");
      },
    });
    expect(r.invites[0]!.state).toBe("invited");
  });

  test("invited when the opened key is not age1", async () => {
    const r = await readInviteStatuses(probesWith({ alice: rec("a1", FUTURE) }), SLUG, {
      relay: replyFor(["a1"]),
      roster: [],
      now: NOW,
      open: opensTo("not-an-age-key"),
    });
    expect(r.invites[0]!.state).toBe("invited");
  });

  test("relay failure reads invited and sets relayFailed", async () => {
    const r = await readInviteStatuses(probesWith({ bob: rec("b1", FUTURE), alice: rec("a1", FUTURE) }), SLUG, {
      relay: {
        readReply: async (id: string) => {
          if (id === "b1") throw new Error("relay down");
          return { blob: "blob" };
        },
      },
      roster: [],
      now: NOW,
      open: opensTo(AGE_KEY),
    });
    expect(r.relayFailed).toBe(true);
    expect(r.invites.map((i) => [i.handle, i.state])).toEqual([
      ["alice", "replied"],
      ["bob", "invited"],
    ]);
  });

  test("no records file gives an empty list", async () => {
    const r = await readInviteStatuses(probesWith(null), SLUG, { relay: replyFor([]), roster: [], now: NOW });
    expect(r).toEqual({ invites: [], relayFailed: false });
  });
});
