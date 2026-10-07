import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { activeTeamFor } from "../active-team.ts";
import { teamLocalPath } from "../team-local.ts";

const HOME = "/h";
const ROOT = `${HOME}/.mattstack/orgs/acme`;
const roster = [{ username: "dev1", teams: ["widgets"] }, { username: "dev2", teams: ["widgets", "gadgets"] }];

function probes(opts: { username?: string; setting?: string; folders?: string[] }) {
  return fakeProbes({
    home: HOME,
    dirs: { [`${ROOT}/mattstack/teams`]: opts.folders ?? [] },
    files: {
      [`${ROOT}/mattstack/org/settings.org.jsonc`]: `// org\n${JSON.stringify({ "mattstack.roster": roster })}`,
      ...(opts.username ? { [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: opts.username }) } : {}),
      ...(opts.setting ? { [`${HOME}/.mattstack/user/settings.user.jsonc`]: JSON.stringify({ "mattstack.activeTeam": opts.setting }) } : {}),
    },
  });
}

describe("activeTeamFor", () => {
  test("your first team, unless the user setting names another one you are on", () => {
    expect(activeTeamFor(probes({ username: "dev2" }), "acme")).toEqual({ org: "acme", team: "widgets", reason: "first-team", username: "dev2", listedOn: ["widgets", "gadgets"] });
    expect(activeTeamFor(probes({ username: "dev2", setting: "gadgets" }), "acme")).toMatchObject({ team: "gadgets", reason: "chosen" });
  });
  test("no team lists you: none", () => {
    expect(activeTeamFor(probes({ username: "stranger" }), "acme")).toMatchObject({ team: null, reason: "no-team" });
  });
  test("no stored username: the setting alone, and only for a team folder that exists", () => {
    expect(activeTeamFor(probes({ setting: "widgets", folders: ["widgets"] }), "acme")).toMatchObject({ team: "widgets", reason: "setting-only" });
    expect(activeTeamFor(probes({ setting: "widgets" }), "acme")).toMatchObject({ team: null, reason: "identity" });
    expect(activeTeamFor(probes({}), "acme")).toMatchObject({ team: null, reason: "identity" });
  });
  test("a missing org store reads as no roster", () => {
    expect(activeTeamFor(fakeProbes({ home: HOME, files: { [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: "dev1" }) } }), "acme")).toMatchObject({ team: null, reason: "no-team" });
  });
});
