import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readSection } from "../../../packages/rt-client/src/settings/migrate.ts";
import { getDef } from "../../../packages/rt-client/src/settings/registry-machinery.ts";
import { readStore } from "../../../packages/rt-client/src/settings/stores.ts";
import { setSettingsNoticeSink } from "../../../packages/rt-client/src/settings/write.ts";
import { seedOrg, type SeedOrg } from "../../../packages/rt-client/test/org-fixture.ts";
import type { ApplyContext } from "../apply.ts";
import { MIGRATIONS } from "../migrations/index.ts";
import { entryFromTeamStore, teamDirectoryMigration, withoutRetired } from "../migrations/team-directory.ts";
import { createRealProbes } from "../probes.ts";

const run = () => teamDirectoryMigration.run({ p: { ...createRealProbes(), home: process.env.HOME! } } as Partial<ApplyContext> as ApplyContext);
function seedClone(opts: SeedOrg) {
  const seeded = seedOrg(opts);
  const dir = join(process.env.HOME!, ".mattstack", "orgs", seeded.org);
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "config"), "");
  return seeded;
}
const store = (file: string) => readStore(file).global as Record<string, unknown>;
const tabsIn = (file: string) => readSection(getDef("board.tabs")!, store(file), { layer: false }).value as Array<Record<string, unknown>>;

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
const adminRoles = { admins: ["me"], teams: { claim: { owners: ["me"] } } };
const roster = [{ username: "me", teams: ["claim"] }];

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

describe("2026-10-08-team-directory", () => {
  const origHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "dir-mig-")));
    process.env.HOME = home;
    setSettingsNoticeSink(() => {});
  });
  afterEach(() => {
    setSettingsNoticeSink(null);
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  test("is the last migration in the list", () => {
    expect(MIGRATIONS[MIGRATIONS.length - 1]).toBe(teamDirectoryMigration);
  });

  test("an admin's Mac seeds the directory and deletes what moved", async () => {
    const { orgStore, teamStores } = seedClone({
      username: "me",
      roles: adminRoles,
      roster,
      settings: { "board.slack": { channel: "org-old" } },
      teams: { claim: CLAIM_STORE },
    });
    const result = await run();
    expect(result.state).toBe("done");
    expect(store(orgStore)["mattstack.directory"]).toEqual({ teams: { claim: ENTRY } });
    expect(store(orgStore)["board.slack"]).toBeUndefined();
    const team = store(teamStores.claim!);
    expect(team["board.slack"]).toEqual({ singleTemplate: "{title}: {url}" });
    expect(team["mattstack.integrations"]).toBeUndefined();
    expect(team["board.ticketPrefixes"]).toBeUndefined();
    expect(team["board.tabs"]).toBeUndefined();
    expect(tabsIn(teamStores.claim!).map((t) => t.slackChannel)).toEqual([undefined, undefined, "pod-acme"]);
  });

  test("a second run changes nothing", async () => {
    seedClone({ username: "me", roles: adminRoles, roster, teams: { claim: CLAIM_STORE } });
    await run();
    expect((await run()).state).toBe("skipped");
  });

  test("an existing entry is never overwritten, and its team's old values are still deleted", async () => {
    const { orgStore, teamStores } = seedClone({
      username: "me",
      roles: adminRoles,
      roster,
      settings: { "mattstack.directory": { teams: { claim: { linear: { team: "KEEP" } } } } },
      teams: { claim: CLAIM_STORE },
    });
    await run();
    expect(store(orgStore)["mattstack.directory"]).toEqual({ teams: { claim: { linear: { team: "KEEP" } } } });
    expect(store(teamStores.claim!)["mattstack.integrations"]).toBeUndefined();
  });

  test("a team whose code owners channel another entry claims is skipped, and keeps its values", async () => {
    const other = { slack: { codeOwnersChannel: "#Pod-Claim" } };
    const { orgStore, teamStores } = seedClone({
      username: "me",
      roles: adminRoles,
      roster,
      settings: { "mattstack.directory": { teams: { other } } },
      teams: { claim: CLAIM_STORE },
    });
    await run();
    expect(store(orgStore)["mattstack.directory"]).toEqual({ teams: { other } });
    const team = store(teamStores.claim!);
    expect(team["board.slack"]).toEqual(CLAIM_STORE["board.slack"]);
    expect(team["mattstack.integrations"]).toEqual(CLAIM_STORE["mattstack.integrations"]);
    expect(team["board.ticketPrefixes"]).toEqual(CLAIM_STORE["board.ticketPrefixes"]);
    expect(tabsIn(teamStores.claim!).map((t) => t.slackChannel)).toEqual([undefined, "pod-claim", "pod-acme"]);
  });

  test("a Mac that cannot write the org store leaves every shared store alone", async () => {
    const { orgStore, teamStores } = seedClone({
      username: "me",
      roles: { admins: ["someone-else"], teams: { claim: { owners: ["someone-else"] } } },
      roster,
      teams: { claim: CLAIM_STORE },
    });
    const result = await run();
    expect(result.state).toBe("skipped");
    expect(store(orgStore)["mattstack.directory"]).toBeUndefined();
    expect(store(teamStores.claim!)["board.slack"]).toEqual(CLAIM_STORE["board.slack"]);
  });

  test("a team owner who is not an admin moves nothing, even in their own team", async () => {
    const { orgStore, teamStores } = seedClone({
      username: "me",
      roles: { admins: ["someone-else"], teams: { claim: { owners: ["me"] } } },
      roster,
      teams: { claim: CLAIM_STORE },
    });
    const result = await run();
    expect(result.state).toBe("skipped");
    expect(store(orgStore)["mattstack.directory"]).toBeUndefined();
    const team = store(teamStores.claim!);
    expect((team["board.slack"] as Record<string, unknown>).channel).toBe("claim-internal");
    expect(team["mattstack.integrations"]).toEqual({ linear: { teamKey: "CV" } });
    expect(tabsIn(teamStores.claim!).map((t) => t.slackChannel)).toEqual([undefined, "pod-claim", "pod-acme"]);
  });

  test("a legacy channel with a leading # seeds the bare name and is still deleted from its tab", async () => {
    const tabs = [TABS[0], { ...TABS[1]!, slackChannel: "#pod-claim" }, TABS[2]];
    const { orgStore, teamStores } = seedClone({ username: "me", roles: adminRoles, roster, teams: { claim: { ...CLAIM_STORE, "board.tabs": tabs } } });
    await run();
    expect(store(orgStore)["mattstack.directory"]).toEqual({ teams: { claim: ENTRY } });
    expect(tabsIn(teamStores.claim!).map((t) => t.slackChannel)).toEqual([undefined, undefined, "pod-acme"]);
  });
});
