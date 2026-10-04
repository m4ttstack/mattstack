import { describe, expect, test } from "bun:test";
import { fakeProbes } from "../../setup/__tests__/fakes.ts";
import { addTeam, type AddTeamSeams } from "../add.ts";
import { teamLocalPath } from "../team-local.ts";

const HOME = "/home";
const ROOT = `${HOME}/.mattstack/teams/acme`;
const roles = { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] } } };

function world(username = "dev1") {
  const p = fakeProbes({
    home: HOME,
    // The fake knows a folder only when it is listed here; it does not infer one from the files under it.
    dirs: { [`${ROOT}/mattstack/teams`]: ["widgets"], [`${ROOT}/mattstack/teams/widgets`]: ["settings.team.jsonc"] },
    files: {
      [`${ROOT}/mattstack/mattstack.jsonc`]: `{ "role": "org", "org": "acme" }`,
      [`${ROOT}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.org": roles }),
      [`${ROOT}/mattstack/teams/widgets/settings.team.jsonc`]: "{}",
      [`${ROOT}/.claude-plugin/marketplace.json`]: JSON.stringify({ name: "acme", owner: { name: "Acme" }, plugins: [{ name: "widgets", source: "./mattstack/teams/widgets/packs/widgets" }] }, null, 2),
      [teamLocalPath(HOME, "acme")]: JSON.stringify({ forgeUsername: username }),
    },
  });
  const writes: [string, unknown][] = [];
  const seams: AddTeamSeams = { writeOrgSetting: (key, value) => { writes.push([key, value]); }, engineDescription: (e) => (e === "work" ? "Use when running a unit of work." : null) };
  return { p, seams, writes };
}

describe("addTeam", () => {
  test("creates the team folder, its settings, a pack skeleton, the marketplace entry and the owners", () => {
    const { p, seams, writes } = world();
    const out = addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams);
    const dir = `${ROOT}/mattstack/teams/gadgets`;
    expect(out.wrote).toEqual([`${dir}/settings.team.jsonc`, `${dir}/packs/gadgets/.claude-plugin/plugin.json`, `${dir}/packs/gadgets/PACK.md`, `${dir}/packs/gadgets/pack/surface.jsonc`, `${dir}/packs/gadgets/pack/stubs.jsonc`, `${dir}/packs/gadgets/pack/skills.jsonc`, `${ROOT}/.claude-plugin/marketplace.json`]);
    expect(out).toMatchObject({ org: "acme", team: "gadgets", dir, owners: ["dev2"] });
    expect(JSON.parse(p.readFile(`${dir}/settings.team.jsonc`)!.split("\n").filter((l) => !l.startsWith("//")).join("\n"))).toEqual({ "board.title": "gadgets" });
    expect(JSON.parse(p.readFile(`${dir}/packs/gadgets/.claude-plugin/plugin.json`)!)).toMatchObject({ name: "gadgets", version: "0.1.0" });
    expect(p.exists(`${dir}/packs/gadgets/pack/skills.jsonc`)).toBe(true);
    expect(p.exists(`${dir}/packs/gadgets/pack/stubs.jsonc`)).toBe(true);
    const market = JSON.parse(p.readFile(`${ROOT}/.claude-plugin/marketplace.json`)!) as { plugins: { name: string; source: string }[] };
    expect(market.plugins.map((x) => [x.name, x.source])).toEqual([["widgets", "./mattstack/teams/widgets/packs/widgets"], ["gadgets", "./mattstack/teams/gadgets/packs/gadgets"]]);
    expect(writes).toEqual([["mattstack.org", { admins: ["dev1"], teams: { widgets: { owners: ["dev1"] }, gadgets: { owners: ["dev2"] } } }]]);
  });

  test("only an org admin adds a team", () => {
    const { p, seams, writes } = world("dev2");
    expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams)).toThrow("The org's shared files belong to its admins");
    expect(p.exists(`${ROOT}/mattstack/teams/gadgets`)).toBe(false);
    expect(writes).toEqual([]);
  });

  test("a team that already exists, a bad name, no owner, or no mattstack plugin is refused before any write", () => {
    const { p, seams } = world();
    expect(() => addTeam(p, { org: "acme", team: "widgets", owners: ["dev2"] }, seams)).toThrow("The widgets team already exists");
    expect(() => addTeam(p, { org: "acme", team: "Gadgets", owners: ["dev2"] }, seams)).toThrow("cannot be a team name");
    expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: [] }, seams)).toThrow("A team needs at least one owner");
    expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, { ...seams, engineDescription: () => null })).toThrow("The mattstack plugin is not installed");
    expect(p.exists(`${ROOT}/mattstack/teams/gadgets`)).toBe(false);
  });
});


describe("addTeam write boundaries", () => {
  for (const username of ["dev2", "", "dev1-owner"]) {
    test(`non-admin ${JSON.stringify(username)} cannot create shared files`, () => {
      const { p, seams, writes } = world(username);
      p.writeFile(`${ROOT}/mattstack/org/settings.org.jsonc`, JSON.stringify({ "mattstack.org": { admins: ["dev1"], teams: { gadgets: { owners: ["dev1-owner"] } } } }));
      const before = { ...p.calls.writes };
      expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams)).toThrow();
      expect(p.calls.writes).toEqual(before);
      expect(writes).toEqual([]);
    });
  }
  test("duplicate folder has its own failure code and preserves every file", () => {
    const { p, seams, writes } = world();
    let code: string | undefined;
    try { addTeam(p, { org: "acme", team: "widgets", owners: ["dev2"] }, seams); } catch (err) { code = (err as { code: string }).code; }
    expect(code).toBe("team-folder-exists");
    expect(p.calls.writes).toEqual({});
    expect(writes).toEqual([]);
  });
  test("malformed marketplace cannot leave a partial team folder", () => {
    const { p, seams, writes } = world();
    p.writeFile(`${ROOT}/.claude-plugin/marketplace.json`, "{");
    const before = { ...p.calls.writes };
    expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams)).toThrow();
    expect(p.calls.writes).toEqual(before);
    expect(p.exists(`${ROOT}/mattstack/teams/gadgets`)).toBe(false);
    expect(writes).toEqual([]);
  });
  test("authorization is checked again if admin rights change during a write", () => {
    const { p, seams, writes } = world();
    const writeFile = p.writeFile.bind(p);
    p.writeFile = (path, text) => {
      writeFile(path, text);
      if (path.endsWith("settings.team.jsonc")) writeFile(`${ROOT}/mattstack/org/settings.org.jsonc`, JSON.stringify({ "mattstack.org": { admins: ["dev2"], teams: {} } }));
    };
    expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams)).toThrow();
    expect(p.exists(`${ROOT}/mattstack/teams/gadgets/packs/gadgets/pack/skills.jsonc`)).toBe(false);
    expect(writes).toEqual([]);
  });
});


describe("addTeam marketplace validation", () => {
  test("unreadable existing marketplace is preserved before any mutation", () => {
    const { p, seams, writes } = world();
    const readFile = p.readFile.bind(p);
    p.readFile = (path) => path === `${ROOT}/.claude-plugin/marketplace.json` ? null : readFile(path);
    expect(() => addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams)).toThrow("rt could not read your org's marketplace");
    expect(p.calls.writes).toEqual({});
    expect(writes).toEqual([]);
  });
  test("malformed marketplace raises an actionable failure", () => {
    const { p, seams } = world();
    p.writeFile(`${ROOT}/.claude-plugin/marketplace.json`, "{");
    let code: string | undefined;
    try { addTeam(p, { org: "acme", team: "gadgets", owners: ["dev2"] }, seams); } catch (err) { code = (err as { code: string }).code; }
    expect(code).toBe("team-marketplace-invalid");
  });
});
