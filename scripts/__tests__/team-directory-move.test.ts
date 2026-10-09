import { describe, expect, test } from "bun:test";
import { DirectoryRefusal, entryFromTeamStore, planDirectoryMove, withoutRetired } from "../lib/team-directory-move.ts";

const TABS = [
  { id: "team", label: "Team", source: { kind: "authors" } },
  { id: "q", label: "Q", source: { kind: "codeowners", section: "Claim - #pod-claim" }, slackChannel: "pod-claim" },
  { id: "w", label: "W", source: { kind: "codeowners", section: "Acme - #pod-acme" }, slackChannel: "pod-acme" },
];
// The v1 store name, as the live team store holds it today.
const CLAIM_STORE = {
  "mattstack.integrations": { linear: { teamKey: "CV" } },
  "board.slack": { channel: "claim-internal", singleTemplate: "{title}: {url}" },
  "board.tabs": TABS,
  "board.ticketPrefixes": ["CV"],
};
const ENTRY = {
  linear: { team: "CV" },
  slack: { codeOwnersChannel: "pod-claim", channels: [{ name: "claim-internal", kind: "review" }] },
};

describe("entryFromTeamStore", () => {
  test("builds an entry from the Linear key, the board channel and the first codeowners tab channel", () => {
    expect(entryFromTeamStore(CLAIM_STORE, {})).toEqual(ENTRY);
  });
  test("reads tabs stored under the current versioned name too", () => {
    const { "board.tabs": tabs, ...rest } = CLAIM_STORE;
    expect(entryFromTeamStore({ ...rest, "board.tabs@2": tabs }, {})).toEqual(ENTRY);
  });
  test("takes the org's board channel when the team has none", () => {
    expect(entryFromTeamStore({}, { "board.slack": { channel: "org-review" } })).toEqual({
      slack: { channels: [{ name: "org-review", kind: "review" }] },
    });
  });
  test("copies legacy channel names bare, in their own case", () => {
    const tabs = [{ ...TABS[1]!, slackChannel: "#pod-claim" }];
    expect(entryFromTeamStore({ "board.slack": { channel: " #Claim-Internal " }, "board.tabs": tabs }, {})).toEqual({
      slack: { codeOwnersChannel: "pod-claim", channels: [{ name: "Claim-Internal", kind: "review" }] },
    });
  });
  test("a store with nothing to move gives no entry", () => {
    expect(entryFromTeamStore({}, {})).toBeNull();
  });
});

describe("withoutRetired", () => {
  test("drops the moved fields and keeps everything else", () => {
    expect(withoutRetired(CLAIM_STORE, ENTRY)).toEqual([
      { key: "board.slack", value: { singleTemplate: "{title}: {url}" } },
      { key: "mattstack.integrations", value: undefined },
      { key: "board.tabs", value: [TABS[0], { id: "q", label: "Q", source: TABS[1]!.source }, TABS[2]] },
      { key: "board.ticketPrefixes", value: undefined },
    ]);
  });
  test("drops a tab channel that names the entry's channel with a leading #", () => {
    const tabs = [{ ...TABS[1]!, slackChannel: "#Pod-Claim" }];
    expect(withoutRetired({ "board.tabs": tabs }, ENTRY)).toEqual([{ key: "board.tabs", value: [{ id: "q", label: "Q", source: TABS[1]!.source }] }]);
  });
  test("keeps ticket prefixes that add to the Linear key", () => {
    expect(withoutRetired({ "board.ticketPrefixes": ["CV", "PLA"] }, ENTRY).find((w) => w.key === "board.ticketPrefixes")).toBeUndefined();
  });
});

describe("planDirectoryMove", () => {
  test("seeds the directory and plans the deletion of what moved", () => {
    const plan = planDirectoryMove({ "board.slack": { channel: "org-old" } }, { claim: CLAIM_STORE });
    expect(plan.directory).toEqual({ teams: { claim: ENTRY } });
    expect(plan.teamWrites).toEqual({ claim: withoutRetired(CLAIM_STORE, ENTRY) });
    expect(plan.orgWrites).toEqual([{ key: "board.slack", value: undefined }]);
  });

  test("the report names every key deleted per store and one line per entry added", () => {
    const plan = planDirectoryMove({ "board.slack": { channel: "org-old" } }, { claim: CLAIM_STORE });
    expect(plan.report).toEqual([
      "directory: add claim (linear CV, review #claim-internal, code owners #pod-claim)",
      "team claim: remove board.slack.channel, mattstack.integrations.linear.teamKey, board.tabs[].slackChannel, board.ticketPrefixes",
      "org: remove board.slack.channel",
    ]);
  });

  test("an input with nothing left to move plans nothing", () => {
    const plan = planDirectoryMove({}, { claim: {}, other: { "board.slack": { singleTemplate: "{title}" } } });
    expect(plan).toEqual({ directory: null, teamWrites: {}, orgWrites: [], report: [] });
  });

  test("a store already moved plans nothing", () => {
    const moved = { "board.slack": { singleTemplate: "{title}: {url}" }, "board.tabs": [TABS[0], { id: "q", label: "Q", source: TABS[1]!.source }, TABS[2]] };
    const plan = planDirectoryMove({ "mattstack.directory": { teams: { claim: ENTRY } } }, { claim: moved });
    expect(plan).toEqual({ directory: null, teamWrites: {}, orgWrites: [], report: [] });
  });

  test("an existing entry is never overwritten, and its team's old values are still planned for deletion", () => {
    const plan = planDirectoryMove({ "mattstack.directory": { teams: { claim: { linear: { team: "KEEP" } } } } }, { claim: CLAIM_STORE });
    expect(plan.directory).toBeNull();
    expect(plan.teamWrites.claim?.map((w) => w.key)).toContain("mattstack.integrations");
  });

  test("a team added to an existing directory keeps the entries already there", () => {
    const other = { linear: { team: "OT" } };
    const plan = planDirectoryMove({ "mattstack.directory": { teams: { other } } }, { claim: CLAIM_STORE });
    expect(plan.directory).toEqual({ teams: { other, claim: ENTRY } });
  });

  test("a team whose code owners channel another entry claims is skipped, and keeps its values", () => {
    const other = { slack: { codeOwnersChannel: "#Pod-Claim" } };
    const plan = planDirectoryMove({ "mattstack.directory": { teams: { other } } }, { claim: CLAIM_STORE });
    expect(plan.directory).toBeNull();
    expect(plan.teamWrites).toEqual({});
    expect(plan.report).toEqual([]);
  });

  test("two new teams on one code owners channel: only the first in input order gets the entry", () => {
    const plan = planDirectoryMove({}, { a: CLAIM_STORE, b: CLAIM_STORE });
    expect(Object.keys(plan.directory?.teams ?? {})).toEqual(["a"]);
    expect(Object.keys(plan.teamWrites)).toEqual(["a"]);
  });

  test("a directory entry with no team folder gets no team writes", () => {
    const plan = planDirectoryMove({ "mattstack.directory": { teams: { ghost: { linear: { team: "GH" } } } } }, { claim: CLAIM_STORE });
    expect(Object.keys(plan.teamWrites)).toEqual(["claim"]);
  });

  test("a directory that already has two teams on one code owners channel is refused, naming it", () => {
    const dup = { teams: { a: { slack: { codeOwnersChannel: "pod-x" } }, b: { slack: { codeOwnersChannel: "pod-x" } } } };
    let refusal: unknown;
    try {
      planDirectoryMove({ "mattstack.directory": dup }, { claim: CLAIM_STORE });
    } catch (err) {
      refusal = err;
    }
    expect(refusal).toBeInstanceOf(DirectoryRefusal);
    expect((refusal as DirectoryRefusal).message).toBe("Two teams claim #pod-x as their code owners channel");
    expect((refusal as DirectoryRefusal).why).toBe("a and b both claim it. Fix the team directory, then run this again.");
  });

  test("a legacy channel with a leading # seeds the bare name and is still planned for deletion from its tab", () => {
    const tabs = [TABS[0], { ...TABS[1]!, slackChannel: "#pod-claim" }, TABS[2]];
    const plan = planDirectoryMove({}, { claim: { ...CLAIM_STORE, "board.tabs": tabs } });
    expect(plan.directory).toEqual({ teams: { claim: ENTRY } });
    const written = plan.teamWrites.claim?.find((w) => w.key === "board.tabs")?.value as Array<Record<string, unknown>>;
    expect(written.map((t) => t.slackChannel)).toEqual([undefined, undefined, "pod-acme"]);
  });

  test("planning does not change its input", () => {
    const before = JSON.stringify(CLAIM_STORE);
    planDirectoryMove({ "board.slack": { channel: "org-old" } }, { claim: CLAIM_STORE });
    expect(JSON.stringify(CLAIM_STORE)).toBe(before);
  });
});
