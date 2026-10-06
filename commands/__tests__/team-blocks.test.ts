import { test, expect } from "bun:test";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import type { InviteResult } from "../../lib/team/invite.ts";
import type { JoinResult } from "../../lib/team/join.ts";
import { inviteBlocks, joinBlocks, membersRemoveBlocks, membersSyncBlocks } from "../team.ts";

const invite = (extra: Partial<InviteResult> = {}): InviteResult => ({
  code: "CODE123",
  link: "https://join.example.test/join#CODE123",
  expiresAt: "2026-01-08T00:00:00.000Z",
  pasteBlock: "You have been invited to the Acme mattstack team.\n\nCODE123",
  forgeAccess: "granted",
  manualSteps: [],
  peering: "none",
  ...extra,
});

test("an invite is two copy blocks: the link, then the message to send, neither wrapped nor indented", () => {
  expect(renderPlain(inviteBlocks("zaphod", invite()))).toBe(
    "invite link:\nhttps://join.example.test/join#CODE123\nmessage to send:\nYou have been invited to the Acme mattstack team.\n\nCODE123\n",
  );
});

test("an invite rt could not grant access for says who has to, with every manual step", () => {
  const text = renderPlain(inviteBlocks("zaphod", invite({ forgeAccess: "skipped", manualSteps: ["Add zaphod at https://forge.example.test/acme/team/members", "Ask whoever runs the team repo to give zaphod read access."] })));
  expect(text).toContain("[needs you] zaphod cannot see the team repo yet  forge access: skipped\n");
  expect(text).toContain("  fix: Add zaphod at https://forge.example.test/acme/team/members\n       Ask whoever runs the team repo to give zaphod read access.\n");
});

test("an invite GitHub is still waiting on the invitee to accept reads as not yet visible, with the accept step", () => {
  const text = renderPlain(
    inviteBlocks("zaphod", invite({ forgeAccess: "manual", manualSteps: ["zaphod has to accept GitHub's invite to the repo, on github.com/acme/team/invitations or by email"] })),
  );
  expect(text).toContain("[needs you] zaphod cannot see the team repo yet  forge access: manual\n");
  expect(text).toContain("  fix: zaphod has to accept GitHub's invite to the repo, on github.com/acme/team/invitations or by email\n");
  expect(text).not.toContain("yourself");
});

const join = (extra: Partial<JoinResult> = {}): JoinResult => ({
  teams: [],
  team: { slug: "acme", name: "Acme", owner: "zaphod" },
  access: "ok",
  peering: "idle",
  message: "Joined Acme, owned by zaphod.",
  intent: "written",
  ...extra,
});

test("a join line takes its status from the result and its words from the message", () => {
  expect(renderPlain(joinBlocks(join()))).toBe("[ok] Joined Acme, owned by zaphod.\n");
  expect(renderPlain(joinBlocks(join({ access: "denied", message: "Ask zaphod to let you into Acme, since you don't have access yet." })))).toBe(
    "[needs you] Ask zaphod to let you into Acme, since you don't have access yet.\n",
  );
  expect(renderPlain(joinBlocks(join({ access: "no-account", message: "Joining Acme, owned by zaphod. Connect your GitHub account so rt can reach the team repo." })))).toStartWith("[needs you] ");
  expect(renderPlain(joinBlocks(join({ access: "deferred", message: "Joining Acme, owned by zaphod." })))).toStartWith("[not yet] ");
  expect(renderPlain(joinBlocks(join({ access: "unreachable", message: "rt could not reach the invite service. Check your network, then try again." })))).toStartWith("[warning] ");
  expect(
    renderPlain(joinBlocks(join({ peering: "unavailable", peeringFix: "Ask zaphod for a new invite and join with it.", message: "Joined Acme, owned by zaphod. Your board is not connected yet. Ask zaphod for a new invite and join with it." }))),
  ).toStartWith("[warning] ");
});

test("a message carrying a newline or an escape still prints as one row", () => {
  const text = renderPlain(joinBlocks(join({ message: "Joined Acme\n[ok] forged row\x1b[2J" })));
  expect(text).toBe("[ok] Joined Acme [ok] forged row\n");
});

test("members sync says what was added, who is still pending and what was locked again", () => {
  expect(renderPlain(membersSyncBlocks({ added: ["age1aaa", "age1bbb"], addedHandles: ["bob"], pending: ["carol"], reencrypted: ["rt.json"] }))).toBe(
    "[ok] Added 2 keys\n[not yet] Still waiting on a reply  carol\n[ok] Locked the team's secrets to the new keys  rt.json\n",
  );
  expect(renderPlain(membersSyncBlocks({ added: ["age1aaa"], addedHandles: [], pending: [], reencrypted: [] }))).toBe("[ok] Added 1 key\n");
  expect(renderPlain(membersSyncBlocks({ added: [], addedHandles: [], pending: [], reencrypted: [] }))).toBe("[skipped] No new keys to add\n");
});

test("members remove names the member, what is left to do by hand, and a next step that says why to rotate and how", () => {
  const text = renderPlain(
    membersRemoveBlocks("alice", "acme", {
      forgeAccess: "skipped",
      boardPeering: "revoked",
      manualSteps: ["alice can still see the team repo. Remove them there too: mattstack does not manage who can see this repo."],
      reencrypted: [],
      rosterRemoved: true,
      residueNote: "Removed members keep any secrets they already opened. Rotate those values to shut them out.",
    }),
  );
  expect(text).toBe(
    "[ok] Removed alice from the team  forge access: skipped\n" +
      "[ok] Disconnected their board  alice\n" +
      "  fix: alice can still see the team repo. Remove them there too: mattstack does not manage who can see this repo.\n" +
      "  note: Removed members keep any secrets they already opened. Rotate those values to shut them out.\n" +
      "  next: rt secrets rotate --team acme <domain> <key>\n",
  );
  expect(renderPlain(membersRemoveBlocks("alice", "acme", { forgeAccess: "revoked", boardPeering: "left-peered", manualSteps: [], reencrypted: [], rosterRemoved: false, residueNote: "n" }))).toBe(
    "[skipped] alice was not on the team list  forge access: revoked\n[needs you] Their board is still connected  alice\n  note: n\n  next: rt secrets rotate --team acme <domain> <key>\n",
  );
});


test("a join shows the invite's teams in order", () => {
  expect(renderPlain(joinBlocks(join({ teams: ["gadgets", "widgets"] })))).toBe("[ok] Joined Acme, owned by zaphod.\nteams: gadgets, widgets\n");
});
