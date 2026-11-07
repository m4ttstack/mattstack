import { describe, expect, test } from "bun:test";
import { SUPPORT_ID } from "../../state/identity-store";
import { type MilestoneDeps, renderMilestone, type SlackMilestone, sendMilestone } from "../milestones";

const all: SlackMilestone[] = [
  { kind: "declined", person: "Sam" },
  { kind: "expired", person: "Sam" },
  { kind: "opened", person: "Sam", room: "slack-sam", agentPane: "p1" },
  { kind: "open-failed", person: "Sam", reason: "no free pane" },
  { kind: "ticket", id: "SUP-4", title: "Login loop", url: "https://linear.app/x/SUP-4" },
  { kind: "closed", person: "Sam", reason: "idle", summary: "Fixed the login loop", tickets: [] },
  { kind: "closed", person: "Sam", reason: "operator", summary: null, tickets: ["SUP-4", "SUP-5"] },
  { kind: "resume-offered", person: "Sam", text: "Sam wrote again", conversation: 7 },
  { kind: "resume-expired", person: "Sam" },
  { kind: "resumed", person: "Sam", agent: "same" },
  { kind: "resumed", person: "Sam", agent: "fresh" },
];

test("a resume offer names the chat to resume", () => {
  expect(renderMilestone({ kind: "resume-offered", person: "Sam", text: "hi", conversation: 7 })).toBe("Sam wrote again after the chat closed: hi (chat 7)");
});

test("a resume that expired reads as a resume, not a chat request", () => {
  expect(renderMilestone({ kind: "resume-expired", person: "Sam" })).toBe("Sam's request to pick the chat back up expired without a reply");
});

function fakeDeps(online: boolean) {
  const dms: Array<[string, string, string]> = [];
  const desk: string[] = [];
  const deps: MilestoneDeps = {
    isOnline: () => online,
    postDm: async (f, t, b) => void dms.push([f, t, b]),
    desk: async (b) => void desk.push(b),
  };
  return { deps, dms, desk };
}

describe("milestones", () => {
  test("a milestone to an online requester is a DM from rt.support", async () => {
    const { deps, dms, desk } = fakeDeps(true);
    const m = all[0]!;
    expect(await sendMilestone(deps, { handle: "me", session: "s" }, m)).toBe("dm");
    expect(dms).toEqual([[SUPPORT_ID, "me", renderMilestone(m)]]);
    expect(desk).toEqual([]);
  });

  test("a DM that fails falls back to the desk with the same text", async () => {
    const { deps, desk } = fakeDeps(true);
    deps.postDm = async () => {
      throw new Error("no room");
    };
    const m: SlackMilestone = { kind: "ticket", id: "SUP-4", title: "Login loop", url: "https://linear.app/x/SUP-4" };
    expect(await sendMilestone(deps, { handle: "sam", session: null }, m)).toBe("desk");
    expect(desk).toEqual([renderMilestone(m)]);
  });

  test("an offline or missing requester falls back to the desk notification with the same text", async () => {
    const m = all[0]!;
    const cases = [
      { to: { handle: "me", session: null }, online: false },
      { to: { handle: null, session: null }, online: true },
    ];
    for (const { to, online } of cases) {
      const { deps, dms, desk } = fakeDeps(online);
      expect(await sendMilestone(deps, to, m)).toBe("desk");
      expect(dms).toEqual([]);
      expect(desk).toEqual([renderMilestone(m)]);
    }
  });

  test("a ticket milestone carries id and url", () => {
    const line = renderMilestone(all[4]!);
    expect(line.startsWith("SUP-4")).toBe(true);
    expect(line).toContain("https://linear.app/x/SUP-4");
  });

  test("a closed milestone lists tickets when there are some and omits them otherwise", () => {
    expect(renderMilestone(all[5]!)).not.toContain("SUP-");
    const line = renderMilestone(all[6]!);
    expect(line).toContain("SUP-4");
    expect(line).toContain("SUP-5");
  });

  test("a closed milestone ends each part with one terminal mark and joins them with a space", () => {
    expect(renderMilestone({ kind: "closed", person: "Sam", reason: "idle", summary: "All sorted!", tickets: ["SUP-4"] })).toBe(
      "Sam's chat closed: it went quiet. All sorted! Tickets: SUP-4.",
    );
  });

  test("renderMilestone never contains a dash or a dot separator", () => {
    for (const m of all) expect(renderMilestone(m)).not.toMatch(/[—–·]/);
  });

  test("every line starts with the person's name", () => {
    for (const m of all) if ("person" in m) expect(renderMilestone(m).startsWith("Sam")).toBe(true);
  });
});
