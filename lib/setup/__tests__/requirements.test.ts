import { describe, test, expect } from "bun:test";
import { fakeProbes } from "./fakes.ts";
import { mergeOrgRequirements, parseRequirements, readPackRequirements } from "../requirements.ts";

describe("parseRequirements", () => {
  test("parses tools, keeps known integrations, and reports an unknown one", () => {
    const result = parseRequirements(
      "acme",
      '{ "tools":[{"name":"doppler","floor":"3.0.0","why":"secrets","install":{"url":"https://docs.doppler.com/docs/install-cli"},"connect":{"integration":"doppler"}}], "integrations":["gitlab","linear","bogus"] }',
    );

    expect(result.pack).toBe("acme");
    expect(result.tools).toEqual([
      { name: "doppler", floor: "3.0.0", why: "secrets", install: { url: "https://docs.doppler.com/docs/install-cli" }, connect: { integration: "doppler" } },
    ]);
    expect(result.integrations).toEqual(["gitlab", "linear"]);
    expect(result.error).toContain("bogus");
  });

  describe("install.download", () => {
    const pin = { url: "https://example.com/doppler_darwin_arm64.tar.gz", sha256: "a".repeat(64), extract: "doppler" };
    const parseWith = (download: unknown) =>
      parseRequirements("acme", JSON.stringify({ tools: [{ name: "doppler", why: "secrets", install: { download } }] }));

    test("keeps a pin per processor, defaulting extract to the download itself", () => {
      const result = parseWith({ arm64: pin, x86_64: { url: "https://example.com/doppler_amd64", sha256: "b".repeat(64) } });
      expect(result.error).toBeUndefined();
      expect(result.tools[0]!.install!.download).toEqual({ arm64: pin, x86_64: { url: "https://example.com/doppler_amd64", sha256: "b".repeat(64), extract: "" } });
    });

    test("an older pack's install.brew is ignored", () => {
      const result = parseRequirements("acme", '{ "tools":[{"name":"jq","why":"json","install":{"brew":"jq"}}] }');
      expect(result.tools[0]!.install).toEqual({});
      expect(result.error).toBeUndefined();
    });

    test.each([
      ["not https", { arm64: { ...pin, url: "http://example.com/x" } }, "arm64.url must be an https link"],
      ["a bad sha256", { arm64: { ...pin, sha256: "abc" } }, "arm64.sha256"],
      ["an extract leaving the archive", { arm64: { ...pin, extract: "../../bin/sh" } }, "arm64.extract"],
      ["an unknown processor", { ppc: pin }, 'unknown processor "ppc"'],
      ["not an object", "https://example.com", "must be an object"],
    ])("reports %s and keeps the tool without the pins", (_label, download, message) => {
      const result = parseWith(download);
      expect(result.error).toContain(message);
      expect(result.tools[0]!.install!.download).toBeUndefined();
    });
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

  test.each(["/tmp/run-me", "./run-me", "../run-me", "bin/run-me", "-run-me", "run me", ""])("a tool name that is not a bare command is skipped: %p", (name) => {
    const result = parseRequirements("acme", JSON.stringify({ tools: [{ name, why: "fine" }, { name: "ok", why: "fine" }], integrations: [] }));

    expect(result.tools).toEqual([{ name: "ok", why: "fine" }]);
    expect(result.error).toBe('pack "acme": tools[0] name must be a plain command like "gh", with no path or spaces, skipped');
  });

  test.each(["gh", "acme-api", "node20", "python3.12", "g++", "foo_bar"])("a bare command name is kept: %p", (name) => {
    expect(parseRequirements("acme", JSON.stringify({ tools: [{ name, why: "fine" }], integrations: [] })).tools).toEqual([{ name, why: "fine" }]);
  });

  test("connect.verb rejects non-string elements rather than passing them through", () => {
    const result = parseRequirements("acme", '{ "tools":[{"name":"widget","why":"x","connect":{"verb":[1,2],"label":"Run it"}}], "integrations":[] }');
    expect(result.tools).toEqual([{ name: "widget", why: "x" }]);
  });

  test("parses excludeOrg and reports a non-string entry", () => {
    const result = parseRequirements("acme", '{ "excludeOrg": ["doppler", 3] }');
    expect(result.excludeOrg).toEqual(["doppler"]);
    expect(result.error).toContain("excludeOrg");
    expect("excludeOrg" in parseRequirements("acme", "{}")).toBe(false);
  });

  test("connect.verb with all-string elements is kept", () => {
    const result = parseRequirements("acme", '{ "tools":[{"name":"widget","why":"x","connect":{"verb":["run","it"],"label":"Run it"}}], "integrations":[] }');
    expect(result.tools).toEqual([{ name: "widget", why: "x", connect: { verb: ["run", "it"], label: "Run it" } }]);
  });
});

describe("mergeOrgRequirements", () => {
  const doppler = { name: "doppler", why: "secrets", connect: { integration: "doppler" as const } };
  const orgReq = { pack: "org", tools: [doppler], integrations: ["doppler" as const] };

  test("team tools come first and a tool the team names is replaced whole, taking its integration with it", () => {
    const team = { pack: "widgets", tools: [{ ...doppler, optional: true }], integrations: [] };
    const merged = mergeOrgRequirements(team, "widgets", orgReq);
    expect(merged.tools).toEqual([{ ...doppler, optional: true }]);
    expect(merged.integrations).toEqual([]);
  });

  test("excludeOrg removes the org tool and the integration it connects", () => {
    const team = { pack: "widgets", tools: [], integrations: [], excludeOrg: ["doppler"] };
    const merged = mergeOrgRequirements(team, "widgets", orgReq);
    expect(merged.tools).toEqual([]);
    expect(merged.integrations).toEqual([]);
  });

  test("excludeOrg removes an org integration of that name no tool connects", () => {
    const team = { pack: "widgets", tools: [], integrations: [], excludeOrg: ["linear"] };
    const merged = mergeOrgRequirements(team, "widgets", { pack: "org", tools: [], integrations: ["linear" as const] });
    expect(merged.integrations).toEqual([]);
  });

  test("an excludeOrg name matching nothing changes nothing and reports nothing", () => {
    const team = { pack: "widgets", tools: [], integrations: [], excludeOrg: ["nope"] };
    const merged = mergeOrgRequirements(team, "widgets", orgReq);
    expect(merged.tools).toEqual([doppler]);
    expect(merged.error).toBeUndefined();
    expect(merged.orgError).toBeUndefined();
  });

  test("the team's pack, error, chrome and workType survive; org chrome and workType do not", () => {
    const team = { pack: "widgets", tools: [], integrations: [], error: "bad", workType: "feature" };
    const merged = mergeOrgRequirements(team, "widgets", { ...orgReq, workType: "other", chrome: { required: true } });
    expect(merged).toMatchObject({ pack: "widgets", error: "bad", workType: "feature" });
    expect(merged.chrome).toBeUndefined();
  });

  test("no team entry yields an orgOnly entry under the team's name", () => {
    expect(mergeOrgRequirements(null, "widgets", orgReq)).toMatchObject({ pack: "widgets", orgOnly: true, tools: [doppler] });
  });

  test("org parse errors land on orgError, never error", () => {
    const merged = mergeOrgRequirements(null, "widgets", { ...orgReq, error: "tools[1] is malformed" });
    expect(merged.error).toBeUndefined();
    expect(merged.orgError).toContain("tools[1]");
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

  describe("the org file", () => {
    const orgFile = `${root}/mattstack/org/requirements.jsonc`;
    const teamReq = JSON.stringify({ tools: [{ name: "jq", why: "parses json" }], integrations: [] });
    const orgReq = JSON.stringify({ tools: [{ name: "doppler", why: "secrets", connect: { integration: "doppler" } }], integrations: ["doppler"] });

    test("reads org/requirements.jsonc and folds it into the team's one entry", () => {
      const result = readPackRequirements(fakeProbes({ home: "/fake-home", files: { [file]: teamReq, [orgFile]: orgReq } }), "acme", "widgets");
      expect(result).toHaveLength(1);
      expect(result[0]!.pack).toBe("widgets");
      expect(result[0]!.tools.map((t) => t.name)).toEqual(["jq", "doppler"]);
    });

    test("an org file and no team file yields one orgOnly entry", () => {
      const result = readPackRequirements(fakeProbes({ home: "/fake-home", files: { [orgFile]: orgReq } }), "acme", "widgets");
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ pack: "widgets", orgOnly: true });
      expect(result[0]!.tools.map((t) => t.name)).toEqual(["doppler"]);
    });

    test("no org file returns what it returned before", () => {
      const result = readPackRequirements(fakeProbes({ home: "/fake-home", files: { [file]: teamReq } }), "acme", "widgets");
      expect(result).toEqual([{ pack: "widgets", tools: [{ name: "jq", why: "parses json" }], integrations: [] }]);
      expect("orgOnly" in result[0]!).toBe(false);
      expect("orgError" in result[0]!).toBe(false);
    });

    test("no active team returns [] even with an org file", () => {
      expect(readPackRequirements(fakeProbes({ home: "/fake-home", files: { [orgFile]: orgReq } }), "acme", null)).toEqual([]);
    });

    test("an empty org slug returns []", () => {
      expect(readPackRequirements(fakeProbes({ home: "/fake-home", files: { [orgFile]: orgReq } }), "")).toEqual([]);
    });

    test("an unreadable org file sets orgError and keeps the team's entry", () => {
      const p = fakeProbes({ home: "/fake-home", files: { [file]: teamReq, [orgFile]: "{}" }, unreadable: [orgFile] });
      const result = readPackRequirements(p, "acme", "widgets");
      expect(result).toHaveLength(1);
      expect(result[0]!.orgError).toContain("could not read");
      expect(result[0]!.error).toBeUndefined();
      expect(result[0]!.tools.map((t) => t.name)).toEqual(["jq"]);
    });

    test("one malformed org tool keeps the rest and names the bad one on orgError", () => {
      const bad = JSON.stringify({ tools: [{ name: "doppler", why: "secrets" }, { nope: 1 }], integrations: [] });
      const result = readPackRequirements(fakeProbes({ home: "/fake-home", files: { [file]: teamReq, [orgFile]: bad } }), "acme", "widgets");
      expect(result[0]!.tools.map((t) => t.name)).toEqual(["jq", "doppler"]);
      expect(result[0]!.orgError).toBe("tools[1] is malformed, skipped");
      expect(result[0]!.error).toBeUndefined();
    });

    test("every org error drops the pack label, and a team's own error keeps it", () => {
      const bad = JSON.stringify({ tools: [{ nope: 1 }, { name: "doppler", why: "secrets", connect: { integration: "nope" } }], integrations: [] });
      const badTeam = JSON.stringify({ tools: [{ nope: 1 }], integrations: [] });
      const [merged] = readPackRequirements(fakeProbes({ home: "/fake-home", files: { [file]: badTeam, [orgFile]: bad } }), "acme", "widgets");
      expect(merged!.orgError).toBe('tools[0] is malformed, skipped; tool "doppler" declares unknown integration "nope"');
      expect(merged!.error).toBe('pack "widgets": tools[0] is malformed, skipped');
    });

    test("an unconverted team folder keeps its error entry and still folds org tools", () => {
      const nested = `${root}/mattstack/teams/widgets/packs/widgets/requirements.jsonc`;
      const manifest = `${root}/mattstack/teams/widgets/packs/widgets/pack/skills.jsonc`;
      const p = fakeProbes({ home: "/fake-home", files: { [nested]: teamReq, [manifest]: "{}", [orgFile]: orgReq } });
      const result = readPackRequirements(p, "acme", "widgets");
      expect(result).toHaveLength(1);
      expect(result[0]!.error).toContain("move-team-packs-to-plugin.ts");
      expect(result[0]!.tools.map((t) => t.name)).toEqual(["doppler"]);
    });
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
