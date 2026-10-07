import { describe, test, expect } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { parseRequirements, readPackRequirements } from "../requirements.ts";

describe("parseRequirements", () => {
  test("parses tools, keeps known integrations, and reports an unknown one", () => {
    const result = parseRequirements(
      "acme",
      '{ "tools":[{"name":"doppler","floor":"3.0.0","why":"secrets","install":{"brew":"dopplerhq/cli/doppler"},"connect":{"integration":"doppler"}}], "integrations":["gitlab","linear","bogus"] }',
    );

    expect(result.pack).toBe("acme");
    expect(result.tools).toEqual([
      { name: "doppler", floor: "3.0.0", why: "secrets", install: { brew: "dopplerhq/cli/doppler" }, connect: { integration: "doppler" } },
    ]);
    expect(result.integrations).toEqual(["gitlab", "linear"]);
    expect(result.error).toContain("bogus");
  });

  test("invalid JSON yields an empty, error-carrying result", () => {
    const result = parseRequirements("broken", "{ not json");
    expect(result).toEqual({ pack: "broken", tools: [], integrations: [], error: expect.stringContaining("invalid JSON") });
  });

  test("strips // and /* */ comments and trailing commas before parsing", () => {
    const result = parseRequirements(
      "acme",
      `{
        // a pack-side note
        "tools": [],
        "integrations": ["github",], /* trailing comma + block comment */
      }`,
    );
    expect(result.integrations).toEqual(["github"]);
    expect(result.error).toBeUndefined();
  });

  test("a tool declaring an unknown connect.integration is kept but the drop is reported, naming the tool", () => {
    const result = parseRequirements("acme", '{ "tools":[{"name":"widget","why":"builds things","connect":{"integration":"bogus"}}], "integrations":[] }');

    expect(result.tools).toEqual([{ name: "widget", why: "builds things" }]);
    expect(result.error).toContain("widget");
    expect(result.error).toContain("bogus");
  });

  test("a malformed tool entry is skipped and the error names the pack and the tool's index", () => {
    const result = parseRequirements("acme", '{ "tools":[{"name":"ok","why":"fine"}, {"name":"missing-why"}], "integrations":[] }');

    expect(result.tools).toEqual([{ name: "ok", why: "fine" }]);
    expect(result.error).toContain("acme");
    expect(result.error).toContain("tools[1]");
  });

  test("connect.verb rejects non-string elements rather than passing them through", () => {
    const result = parseRequirements("acme", '{ "tools":[{"name":"widget","why":"x","connect":{"verb":[1,2],"label":"Run it"}}], "integrations":[] }');
    expect(result.tools).toEqual([{ name: "widget", why: "x" }]);
  });

  test("connect.verb with all-string elements is kept", () => {
    const result = parseRequirements("acme", '{ "tools":[{"name":"widget","why":"x","connect":{"verb":["run","it"],"label":"Run it"}}], "integrations":[] }');
    expect(result.tools).toEqual([{ name: "widget", why: "x", connect: { verb: ["run", "it"], label: "Run it" } }]);
  });
});

describe("readPackRequirements", () => {
  const root = "/fake-home/.mattstack/orgs/acme";
  const file = `${root}/mattstack/teams/widgets/plugin/requirements.jsonc`;

  test("reads the team pack's requirements.jsonc under its team folder", () => {
    const p = fakeProbes({ home: "/fake-home", files: { [file]: '{ "tools":[], "integrations":["github"] }' } });

    const result = readPackRequirements(p, "acme", "widgets");
    expect(result).toHaveLength(1);
    expect(result[0]!.pack).toBe("widgets");
    expect(result[0]!.integrations).toEqual(["github"]);
  });

  test("an unconverted team folder is one error entry naming the fix, never a throw", () => {
    const nested = `${root}/mattstack/teams/widgets/packs/widgets/requirements.jsonc`;
    const manifest = `${root}/mattstack/teams/widgets/packs/widgets/pack/skills.jsonc`;
    const p = fakeProbes({ home: "/fake-home", files: { [nested]: '{ "tools":[], "integrations":[] }', [manifest]: "{}" } });
    expect(readPackRequirements(p, "acme", "widgets")).toEqual([{
      pack: "widgets",
      tools: [],
      integrations: [],
      error: `Your org repo still keeps the widgets pack at mattstack/teams/widgets/packs/widgets. Run bun scripts/move-team-packs-to-plugin.ts ${root} --admin <username> --write, then rt setup update`,
    }]);
  });

  test("returns [] when the team has no packs", () => {
    const p = fakeProbes({ home: "/fake-home" });
    expect(readPackRequirements(p, "acme", "widgets")).toEqual([]);
  });

  test("an unreadable file yields one error entry naming the file, not a silent skip", () => {
    const p = fakeProbes({ home: "/fake-home", files: { [file]: "{}" }, unreadable: [file] });

    const result = readPackRequirements(p, "acme", "widgets");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ pack: "widgets", tools: [], integrations: [], error: expect.stringContaining("requirements.jsonc") });
  });

  test("with no team named, the active team comes from the org's roster through probes", () => {
    const p = fakeProbes({
      home: "/fake-home",
      files: {
        [file]: '{ "tools":[], "integrations":["github"] }',
        [`${root}/mattstack/org/settings.org.jsonc`]: JSON.stringify({ "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }] }),
        "/fake-home/.mattstack/rt/teams/acme.json": JSON.stringify({ forgeUsername: "dev1" }),
      },
    });
    expect(readPackRequirements(p, "acme").map((r) => r.pack)).toEqual(["widgets"]);
    expect(readPackRequirements(fakeProbes({ home: "/fake-home", files: { [file]: "{}" } }), "acme")).toEqual([]);
  });

  describe("the active team's pack", () => {
    const REQ = JSON.stringify({ tools: [{ name: "jq", why: "parses json" }], integrations: [] });
    const files = {
      "/h/.mattstack/orgs/acme/mattstack/teams/widgets/plugin/requirements.jsonc": REQ,
      "/h/.mattstack/orgs/acme/mattstack/teams/gadgets/plugin/requirements.jsonc": JSON.stringify({ tools: [{ name: "yq", why: "parses yaml" }], integrations: [] }),
    };
    test("reads only the named team's pack", () => {
      const reqs = readPackRequirements(fakeProbes({ home: "/h", files }), "acme", "widgets");
      expect(reqs.map((r) => [r.pack, r.tools.map((t) => t.name)])).toEqual([["widgets", ["jq"]]]);
    });
    test("no active team, or a pack with no requirements file, is no requirements", () => {
      expect(readPackRequirements(fakeProbes({ home: "/h", files }), "acme", null)).toEqual([]);
      expect(readPackRequirements(fakeProbes({ home: "/h", files }), "acme", "sprockets")).toEqual([]);
    });
  });
});
