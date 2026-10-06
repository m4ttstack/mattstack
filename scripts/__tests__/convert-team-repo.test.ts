import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath } from "../../lib/rt-paths.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { readZonesFrom, type InitFs } from "../../lib/skills/init.ts";
import { parse } from "jsonc-parser";
import { parse as parseYaml } from "yaml";
import { planConversion, type ConvertInput } from "../lib/convert-team-repo.ts";

const SHARED = "gitlab.example.com/acme/widgets";
const OWN = "gitlab.example.com/acme/widgets-tools";

function oldClone(overrides: Partial<ConvertInput["files"]> = {}): ConvertInput {
  return {
    packs: ["widgets", "acme-base"],
    hasSecrets: true,
    files: {
      "mattstack/mattstack.jsonc": JSON.stringify({ role: "team", namespace: "widgets", org: "acme" }),
      "mattstack/team.jsonc": JSON.stringify({ gitlabHost: "https://gitlab.example.com", projects: ["acme/widgets"] }),
      "mattstack/settings.team.jsonc": `// team settings\n${JSON.stringify({
        "board.gitlabHost": "gitlab.example.com",
        "board.title": "Widgets",
        "board.tabs": [{ id: "team", label: "Team", source: { kind: "authors" } }],
        "board.ticketPrefixes": ["WID"],
        "board.botUsernames": ["acme-bot"],
        "board.slack": { appId: "A1", clientId: "C1", callbackPort: 1455, channel: "#widgets", singleTemplate: "{title}" },
        "board.members": [{ username: "dev1", name: "Dev One" }, { username: "DEV2", name: "Dev Two", agePublicKey: "age1bbb" }, { username: "dev3", hidden: true }],
        "board.reReview": { enabled: true },
        "boxscore.projects": ["acme/widgets"],
        "boxscore.botPatterns": ["bot$"],
        "mattstack.integrations": { forge: { host: "gitlab.example.com", provider: "gitlab" } },
        "mattstack.tracking": { repos: { [SHARED]: {} } },
        "mattstack.roster": [{ username: "dev1", name: "Dev One", agePublicKey: "age1aaa" }, { username: "dev2" }],
        "claude.marketplaces": ["acme/marketplace"],
        "claude.plugins": ["widgets@acme", "acme-tools@acme"],
        "skills.writingStyle": "mattstack:writing-style-conversational",
        "rt.sdmEnrichment": { staging: { label: "Staging" } },
        repos: {
          [SHARED]: { "rt.roles": { dev: { hook: "\${team:acme}/mattstack/packs/widgets/hooks/dev.sh" } }, "rt.worktrees": { onDeck: 2 } },
          [OWN]: { "rt.branchNaming": { template: "{ticket}" } },
        },
      })}`,
      ".sops.yaml": "creation_rules:\n  - path_regex: mattstack/secrets/.*\n    age: age1aaa,age1bbb\n",
      ".gitignore": "mattstack/secrets/*.tmp\n.DS_Store\n",
      ".claude-plugin/marketplace.json": JSON.stringify({ name: "acme", owner: { name: "Acme" }, plugins: [{ name: "widgets", source: "./mattstack/packs/widgets", description: "d" }] }, null, 2),
      "mattstack/packs/widgets/.claude-plugin/plugin.json": JSON.stringify({ name: "widgets", version: "1.4.2", skills: "./skills/" }, null, 2),
      "mattstack/packs/widgets/pack/skills.jsonc": "{}",
      "mattstack/packs/acme-base/pack/skills.jsonc": `{ "base": true }`,
      ...overrides,
    },
  };
}

const settings = (text: string) => parse(text) as Record<string, any>;
const run = (input = oldClone(), opts = {}) => planConversion(input, { org: "acme", admin: "dev1", teamRepos: [OWN], ...opts });

describe("planConversion", () => {
  test("base marketplace sources follow the moved pack without changing neighboring names", () => {
    const plan = run(oldClone({ ".claude-plugin/marketplace.json": JSON.stringify({ name: "acme", plugins: [
      { name: "acme-base", source: "./mattstack/packs/acme-base" },
      { name: "external", source: "./mattstack/packs/widgets-extra" },
    ] }) }));
    expect(JSON.parse(plan.writes[".claude-plugin/marketplace.json"]!).plugins).toEqual([
      { name: "acme-base", source: "./mattstack/org/packs/acme-base" },
      { name: "external", source: "./mattstack/packs/widgets-extra" },
    ]);
  });

  test("malformed roster and repo sections stop the split instead of dropping their data", () => {
    for (const [key, value] of [["mattstack.roster", {}], ["board.members", {}], ["repos", []], ["$migrated", []]]) {
      expect(() => run(oldClone({ "mattstack/settings.team.jsonc": JSON.stringify({ [key as string]: value }) }))).toThrow(String(key));
    }
    expect(() => run(oldClone({ ".claude-plugin/marketplace.json": '{"plugins":{}}' }))).toThrow("plugins");
  });

  test("every present pack manifest must parse, including a base pack", () => {
    expect(() => run(oldClone({ "mattstack/packs/acme-base/.claude-plugin/plugin.json": "{" }))).toThrow("acme-base/.claude-plugin/plugin.json");
  });

  test("duplicate store keys are refused before their earlier values can be lost", () => {
    expect(() => run(oldClone({ "mattstack/settings.team.jsonc": '{"board.title":"First","board.title":"Second"}' }))).toThrow("duplicate");
  });

  test("unsafe pack and org names cannot escape the clone", () => {
    expect(() => run({ ...oldClone(), packs: ["../widgets"] })).toThrow("pack");
    expect(() => run(oldClone(), { org: "../acme" })).toThrow("org");
  });

  test("duplicate roster entries keep their metadata and known keys in order", () => {
    const store = settings(oldClone().files["mattstack/settings.team.jsonc"]!);
    store["mattstack.roster"] = [{ username: "dev1", name: "Dev One", agePublicKey: "age1aaa", metadata: { preference: "x" } }, { username: "DEV1", agePublicKey: "age1bbb" }];
    store["board.members"] = [{ username: "dev1", name: "Other", agePublicKey: "age1zzz" }];
    const org = settings(run(oldClone({ "mattstack/settings.team.jsonc": JSON.stringify(store) })).writes["mattstack/org/settings.org.jsonc"]!);
    expect(org["mattstack.roster"]).toEqual([{ username: "dev1", name: "Dev One", agePublicKey: "age1aaa", metadata: { preference: "x" }, teams: ["widgets"] }, { username: "DEV1", agePublicKey: "age1bbb", teams: ["widgets"] }]);
  });

  test("a conflicting board-only age key is reported for recipient review without replacing the roster key", () => {
    const store = settings(oldClone().files["mattstack/settings.team.jsonc"]!);
    store["board.members"] = [{ username: "DEV1", agePublicKey: "age1zzz" }];
    const plan = run(oldClone({ "mattstack/settings.team.jsonc": JSON.stringify(store) }));
    expect(settings(plan.writes["mattstack/org/settings.org.jsonc"]!)["mattstack.roster"][0].agePublicKey).toBe("age1aaa");
    expect(plan.report.join("\n")).toContain("DEV1");
    expect(plan.report.join("\n")).toContain("age1zzz");
    expect(plan.report.join("\n")).toContain("revoke");
  });
  test("the team is named after the one non-base pack, so plugin ids do not change", () => {
    expect(run().team).toBe("widgets");
    expect(() => run(oldClone(), { team: "gadgets" })).toThrow('The team has to be named "widgets", after its pack');
  });

  test("splits the settings by the table: shared keys to the org, how the team works to the team", () => {
    const plan = run();
    const org = settings(plan.writes["mattstack/org/settings.org.jsonc"]!);
    const team = settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!);
    for (const key of ["board.gitlabHost", "board.botUsernames", "boxscore.botPatterns", "mattstack.integrations", "mattstack.tracking", "claude.marketplaces", "mattstack.roster", "mattstack.org"]) {
      expect(key in org).toBe(true);
      expect(key in team).toBe(false);
    }
    for (const key of ["board.title", "board.tabs", "board.ticketPrefixes", "board.reReview", "boxscore.projects", "skills.writingStyle", "rt.sdmEnrichment"]) {
      expect(key in team).toBe(true);
      expect(key in org).toBe(false);
    }
  });

  test("board.slack keeps the app ids at the org and everything else at the team", () => {
    const plan = run();
    expect(settings(plan.writes["mattstack/org/settings.org.jsonc"]!)["board.slack"]).toEqual({ appId: "A1", clientId: "C1", callbackPort: 1455 });
    expect(settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!)["board.slack"]).toEqual({ channel: "#widgets", singleTemplate: "{title}" });
  });

  test("claude.plugins: the team's own pack goes to the team, the rest stays at the org", () => {
    const plan = run();
    expect(settings(plan.writes["mattstack/org/settings.org.jsonc"]!)["claude.plugins"]).toEqual(["acme-tools@acme"]);
    expect(settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!)["claude.plugins"]).toEqual(["widgets@acme"]);
  });

  test("board.projects comes from team.jsonc when the store has none, and lands at the org", () => {
    const org = settings(run().writes["mattstack/org/settings.org.jsonc"]!);
    expect(org["board.projects"]).toEqual(["acme/widgets"]);
  });

  test("a repo's section goes to the org unless it is named as the team's own", () => {
    const plan = run();
    expect(Object.keys(settings(plan.writes["mattstack/org/settings.org.jsonc"]!).repos)).toEqual([SHARED]);
    expect(Object.keys(settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!).repos)).toEqual([OWN]);
  });

  test("a team repo that names no repo section is refused, so a typo cannot send the team's section to the org", () => {
    expect(() => run(oldClone(), { teamRepos: ["gitlab.example.com/acme/typo"] })).toThrow(
      "The old store has no repo section named gitlab.example.com/acme/typo. Check the spelling of that team repo.",
    );
  });

  test("retired keys stay out of both new stores, and the report names them", () => {
    const old = settings(oldClone().files["mattstack/settings.team.jsonc"]!);
    const plan = run(oldClone({
      "mattstack/settings.team.jsonc": JSON.stringify({ ...old, "board.defaultPack": "widgets", "board.switchboardUrl": "https://switchboard.example.com", "mattstack.mode": "team" }),
    }));
    const org = settings(plan.writes["mattstack/org/settings.org.jsonc"]!);
    const team = settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!);
    for (const key of ["board.defaultPack", "board.switchboardUrl", "mattstack.mode", "board.members"]) {
      expect(key in org).toBe(false);
      expect(key in team).toBe(false);
    }
    expect(plan.report).toContain("board.defaultPack, board.switchboardUrl and mattstack.mode are retired; left out of the new stores");
    expect(org["mattstack.roster"].map((entry: { username: string }) => entry.username)).toEqual(["dev1", "dev2", "dev3"]);
  });

  test("the roster moves to the org with teams, takes what only board.members knew, gains the admin, and board.members goes", () => {
    const plan = run(oldClone(), { admin: "dev9" });
    const org = settings(plan.writes["mattstack/org/settings.org.jsonc"]!);
    expect(org["mattstack.roster"]).toEqual([
      { username: "dev1", name: "Dev One", agePublicKey: "age1aaa", teams: ["widgets"] },
      { username: "dev2", name: "Dev Two", agePublicKey: "age1bbb", teams: ["widgets"] },
      { username: "dev3", teams: ["widgets"] },
      { username: "dev9", teams: ["widgets"] },
    ]);
    expect(org["mattstack.org"]).toEqual({ admins: ["dev9"], teams: { widgets: { owners: ["dev9"] } } });
    expect("board.members" in org).toBe(false);
    expect("board.members" in settings(plan.writes["mattstack/teams/widgets/settings.team.jsonc"]!)).toBe(false);
    expect(plan.rosterUsernames).toEqual(["dev1", "dev2", "dev3", "dev9"]);
  });

  test("secrets move under the org, and the sops rule and gitignore follow", () => {
    const plan = run();
    expect(plan.moves).toContainEqual(["mattstack/secrets", "mattstack/org/secrets"]);
    expect(plan.writes[".sops.yaml"]).toBe("creation_rules:\n  - path_regex: mattstack/org/secrets/.*\n    age: age1aaa,age1bbb\n");
    expect(plan.writes[".gitignore"]).toBe("mattstack/org/secrets/*.tmp\n.DS_Store\n");
  });

  test("a comment cannot hide an actual anchored secrets rule with a nonliteral suffix", () => {
    const sops = "# Old standard rule: mattstack/secrets/.*\ncreation_rules:\n  - path_regex: '^mattstack/secrets/[^/]+$'\n    age: age1aaa,age1bbb # preserve recipients\n";
    const plan = run(oldClone({ ".sops.yaml": sops }));
    const rewritten = plan.writes[".sops.yaml"]!;
    const rule = parseYaml(rewritten).creation_rules[0];
    expect(rule.path_regex).toBe("^mattstack/org/secrets/[^/]+$");
    expect(new RegExp(rule.path_regex).test("mattstack/org/secrets/rt.json")).toBe(true);
    expect(rule.age).toBe("age1aaa,age1bbb");
    expect(rewritten).toContain("# Old standard rule: mattstack/secrets/.*");
    expect(rewritten).toContain("# preserve recipients");
    expect(plan.report.filter(line => line.includes(".sops.yaml"))).toEqual([]);
  });

  test("a comment-only standard path never qualifies an unmatched creation rule", () => {
    const sops = "# Old standard rule: mattstack/secrets/.*\ncreation_rules:\n  - path_regex: other/secrets/.*\n    age: age1aaa,age1bbb\n";
    const plan = run(oldClone({ ".sops.yaml": sops }));
    expect(plan.writes[".sops.yaml"]).toBeUndefined();
    expect(plan.report.join("\n")).toContain("fix its path_regex by hand");
  });

  test("every literal old-path branch in a supported creation rule follows the secrets move", () => {
    const sops = "creation_rules:\n  - path_regex: ^mattstack/secrets/rt.json$|^mattstack/secrets/forge.json$\n    age: age1aaa,age1bbb\n";
    const plan = run(oldClone({ ".sops.yaml": sops }));
    const rule = parseYaml(plan.writes[".sops.yaml"]!).creation_rules[0];
    expect(rule.path_regex).toBe("^mattstack/org/secrets/rt.json$|^mattstack/org/secrets/forge.json$");
    expect(new RegExp(rule.path_regex).test("mattstack/org/secrets/forge.json")).toBe(true);
    expect(rule.age).toBe("age1aaa,age1bbb");
  });

  test("moving secrets without a sops file names the missing creation rule", () => {
    const input = oldClone();
    delete input.files[".sops.yaml"];
    const plan = run(input);
    expect(plan.moves).toContainEqual(["mattstack/secrets", "mattstack/org/secrets"]);
    expect(plan.writes[".sops.yaml"]).toBeUndefined();
    expect(plan.report.join("\n")).toContain(".sops.yaml");
    expect(plan.report.join("\n")).toContain("missing");
  });

  test("a genuinely unmatched or unsupported rule stays unchanged and requires manual review", () => {
    for (const pattern of ["other/secrets/.*", "^mattstack/(secrets)/.*"]) {
      const sops = `creation_rules:\n  - path_regex: ${pattern}\n    age: age1aaa,age1bbb\n`;
      const plan = run(oldClone({ ".sops.yaml": sops }));
      expect(plan.writes[".sops.yaml"]).toBeUndefined();
      expect(plan.report.join("\n")).toContain("fix its path_regex by hand");
    }
  });

  for (const fallback of [
    { old: "^mattstack/secrets/[^/]+$", moved: "^mattstack/org/secrets/[^/]+$" },
    { old: "mattstack/secrets/.*", moved: "mattstack/org/secrets/.*" },
  ]) {
    test(`an unresolved specialized rule still warns when the supported fallback is ${fallback.old}`, () => {
      const sops = `# preserve specialized recipient selection\ncreation_rules:\n  - path_regex: ^mattstack/(secrets)/forge.json$\n    age: age1special\n  - path_regex: ${fallback.old}\n    age: age1general\n`;
      const firstRecipient = (rules: Array<{ path_regex: string; age: string }>, file: string) => rules.find(rule => new RegExp(rule.path_regex).test(file))?.age;
      expect(firstRecipient(parseYaml(sops).creation_rules, "mattstack/secrets/forge.json")).toBe("age1special");
      const plan = run(oldClone({ ".sops.yaml": sops }));
      const rewritten = plan.writes[".sops.yaml"]!;
      const rules = parseYaml(rewritten).creation_rules;
      expect(rules).toEqual([{ path_regex: "^mattstack/(secrets)/forge.json$", age: "age1special" }, { path_regex: fallback.moved, age: "age1general" }]);
      expect(firstRecipient(rules, "mattstack/org/secrets/forge.json")).toBe("age1general");
      expect(plan.report.join("\n")).toContain(".sops.yaml");
      expect(plan.report.join("\n")).toContain("fix its path_regex by hand");
      expect(rewritten).toContain("# preserve specialized recipient selection");
    });
  }

  test("wholly supported multiple rules preserve recipient selection without a review warning", () => {
    const sops = "# keep rule order\ncreation_rules:\n  - path_regex: ^mattstack/secrets/forge.json$\n    age: age1special\n  - path_regex: ^mattstack/secrets/[^/]+$\n    age: age1general\n";
    const plan = run(oldClone({ ".sops.yaml": sops }));
    const rewritten = plan.writes[".sops.yaml"]!;
    const rules = parseYaml(rewritten).creation_rules;
    expect(rules).toEqual([{ path_regex: "^mattstack/org/secrets/forge.json$", age: "age1special" }, { path_regex: "^mattstack/org/secrets/[^/]+$", age: "age1general" }]);
    expect(rules.find((rule: { path_regex: string }) => new RegExp(rule.path_regex).test("mattstack/org/secrets/forge.json")).age).toBe("age1special");
    expect(plan.report.filter(line => line.includes(".sops.yaml"))).toEqual([]);
    expect(rewritten).toContain("# keep rule order");
  });

  test("only creation rule paths change, while comments, recipients and unrelated rules remain", () => {
    const sops = "# mattstack/secrets/.* stays in this comment\ncreation_rules:\n  - path_regex: mattstack/secrets/.* # rule comment\n    age: age1aaa,age1bbb\n  - path_regex: other/secrets/.*\n    age: age1ccc\nmetadata: mattstack/secrets/.*\n";
    const plan = run(oldClone({ ".sops.yaml": sops }));
    const rewritten = plan.writes[".sops.yaml"]!;
    const doc = parseYaml(rewritten);
    expect(doc.creation_rules).toEqual([{ path_regex: "mattstack/org/secrets/.*", age: "age1aaa,age1bbb" }, { path_regex: "other/secrets/.*", age: "age1ccc" }]);
    expect(doc.metadata).toBe("mattstack/secrets/.*");
    expect(rewritten).toContain("# mattstack/secrets/.* stays in this comment");
    expect(rewritten).toContain("# rule comment");
  });

  test("the pack moves into its team folder, the base into the org, the marketplace follows and the version is bumped", () => {
    const plan = run();
    expect(plan.moves).toContainEqual(["mattstack/packs/widgets", "mattstack/teams/widgets/packs/widgets"]);
    expect(plan.moves).toContainEqual(["mattstack/packs/acme-base", "mattstack/org/packs/acme-base"]);
    expect(JSON.parse(plan.writes[".claude-plugin/marketplace.json"]!).plugins).toEqual([{ name: "widgets", source: "./mattstack/teams/widgets/packs/widgets", description: "d" }]);
    expect(JSON.parse(plan.writes["mattstack/teams/widgets/packs/widgets/.claude-plugin/plugin.json"]!).version).toBe("1.4.3");
  });

  test("a marketplace entry that carries its own version gets the bumped version too", () => {
    const market = JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: "./mattstack/packs/widgets", version: "1.4.2" }, { name: "acme-base", source: "./mattstack/packs/acme-base", version: "2.0.0" }] });
    const plugins = JSON.parse(run(oldClone({ ".claude-plugin/marketplace.json": market })).writes[".claude-plugin/marketplace.json"]!).plugins;
    expect(plugins).toEqual([
      { name: "widgets", source: "./mattstack/teams/widgets/packs/widgets", version: "1.4.3" },
      { name: "acme-base", source: "./mattstack/org/packs/acme-base", version: "2.0.0" },
    ]);
  });

  test("the report says when the old store's comments are not carried over", () => {
    expect(run().report).toContain("comments in mattstack/settings.team.jsonc are not carried over");
    const plain = run(oldClone({ "mattstack/settings.team.jsonc": JSON.stringify({ "board.gitlabHost": "gitlab.example.com", "board.title": "https://gitlab.example.com/acme // not a comment" }) }), { teamRepos: [] });
    expect(plain.report.join("\n")).not.toContain("not carried over");
  });

  test("a stored path through ${team:} is rewritten to where the file moved", () => {
    const org = settings(run().writes["mattstack/org/settings.org.jsonc"]!);
    expect(org.repos[SHARED]["rt.roles"].dev.hook).toBe("${team:acme}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh");
  });

  test("the marker becomes the org marker and the old files go", () => {
    const plan = run();
    expect(JSON.parse(plan.writes["mattstack/mattstack.jsonc"]!)).toEqual({ role: "org", org: "acme" });
    expect(plan.deletes.sort()).toEqual(["mattstack/settings.team.jsonc", "mattstack/team.jsonc"]);
  });

  test("a member board.members hid is named in the report: hiding does not carry over to the roster", () => {
    expect(run().report).toContain("board.members hid dev3; the roster has no hidden flag, so dev3 shows in the apps until someone hides them there");
  });

  test("a roster entry keeps its own value where board.members disagrees", () => {
    const files = oldClone().files;
    const store = settings(files["mattstack/settings.team.jsonc"]!);
    store["board.members"] = [{ username: "dev1", name: "Someone Else", agePublicKey: "age1zzz" }];
    const org = settings(run(oldClone({ "mattstack/settings.team.jsonc": JSON.stringify(store) })).writes["mattstack/org/settings.org.jsonc"]!);
    expect(org["mattstack.roster"][0]).toEqual({ username: "dev1", name: "Dev One", agePublicKey: "age1aaa", teams: ["widgets"] });
  });

  test("a team named after the org, beside <org>-base: each stored path goes to its own new home", () => {
    const base = oldClone();
    const store = settings(base.files["mattstack/settings.team.jsonc"]!);
    store.repos[SHARED]["rt.roles"] = {
      dev: { hook: "${team:acme}/mattstack/packs/acme/hooks/dev.sh" },
      ci: { hook: "${team:acme}/mattstack/packs/acme-base/hooks/ci.sh" },
      bare: { hook: "${team:acme}/mattstack/packs/acme" },
    };
    const files = Object.fromEntries(Object.entries(base.files).filter(([rel]) => !rel.startsWith("mattstack/packs/widgets/")));
    const input = {
      packs: ["acme", "acme-base"],
      hasSecrets: true,
      files: {
        ...files,
        "mattstack/settings.team.jsonc": JSON.stringify(store),
        "mattstack/packs/acme/.claude-plugin/plugin.json": JSON.stringify({ name: "acme", version: "1.0.0" }),
        "mattstack/packs/acme/pack/skills.jsonc": "{}",
      },
    };
    const roles = settings(planConversion(input, { org: "acme", admin: "dev1" }).writes["mattstack/org/settings.org.jsonc"]!).repos[SHARED]["rt.roles"];
    expect(roles.dev.hook).toBe("${team:acme}/mattstack/teams/acme/packs/acme/hooks/dev.sh");
    expect(roles.ci.hook).toBe("${team:acme}/mattstack/org/packs/acme-base/hooks/ci.sh");
    expect(roles.bare.hook).toBe("${team:acme}/mattstack/teams/acme/packs/acme");
  });

  test("a store or manifest that does not parse is refused by name, and nothing is planned", () => {
    expect(() => run(oldClone({ "mattstack/settings.team.jsonc": `{ "board.title": "Widgets", ` }))).toThrow("mattstack/settings.team.jsonc is not valid JSONC");
    expect(() => run(oldClone({ ".claude-plugin/marketplace.json": "[]" }))).toThrow(".claude-plugin/marketplace.json is not a JSON object");
  });

  test("a clone that is already converted is refused and nothing is planned", () => {
    const converted = oldClone({ "mattstack/mattstack.jsonc": JSON.stringify({ role: "org", org: "acme" }) });
    expect(() => run(converted)).toThrow("This clone already has the org layout");
  });

  test("two team packs, or none, is refused: the script converts one team", () => {
    expect(() => planConversion({ ...oldClone(), packs: ["widgets", "gadgets", "acme-base"], files: { ...oldClone().files, "mattstack/packs/gadgets/pack/skills.jsonc": "{}" } }, { org: "acme", admin: "dev1" })).toThrow("exactly one team pack");
  });

  test("the report says what goes where, for review before writing", () => {
    const report = run().report.join("\n");
    expect(report).toContain("org: board.gitlabHost");
    expect(report).toContain("team widgets: board.title");
    expect(report).toContain("roster usernames to confirm as forge logins: dev1, dev2, dev3");
  });
});

describe("the wrapper", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cloneCount = 0;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-convert-home-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  /** What `rt settings set rt.teamSnapshot '{"enabled": false}' --scope machine` leaves on disk. */
  function teamSyncOff(): void {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.teamSnapshot": { enabled: false } }));
  }

  /** The machine-local record `team.identity` writes for the clone named acme. */
  function recordedAs(username: string): void {
    const file = join(home, ".mattstack", "rt", "teams", "acme.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ forgeUsername: username }));
  }

  /** Everything a real run needs in place: team sync off, and this Mac recorded as the admin. */
  function ready(): void {
    teamSyncOff();
    recordedAs("dev1");
  }

  function tempClone(extra: Record<string, string> = {}): string {
    const dir = join(home, `clone-${cloneCount++}`, "acme");
    const input = oldClone();
    for (const [rel, text] of Object.entries({ ...input.files, ...extra })) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    mkdirSync(join(dir, "mattstack", "secrets"), { recursive: true });
    writeFileSync(join(dir, "mattstack", "secrets", "rt.json"), "{}");
    const git = (...argv: string[]) => execFileSync("git", ["-C", dir, ...argv], { env: { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
    git("init", "-q", "-b", "main");
    git("config", "user.name", "t");
    git("config", "user.email", "t@example.com");
    git("add", "--", ".");
    git("commit", "-q", "-m", "old layout");
    const origin = join(dirname(dir), "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: childEnv() });
    git("remote", "add", "origin", origin);
    git("push", "-q", "origin", "main");
    return dir;
  }

  /** Pushes the clone's own commits, so a test's later commit leaves it current with origin. */
  function publish(dir: string): void {
    execFileSync("git", ["-C", dir, "push", "-q", "origin", "main"], { env: childEnv() });
  }
  const script = join(import.meta.dir, "..", "convert-team-repo-to-org.ts");
  const runScript = (dir: string, ...extra: string[]) => Bun.spawnSync(["bun", script, dir, "--admin", "dev1", ...extra], { env: childEnv(), stdout: "pipe", stderr: "pipe" });

  function snapshot(dir: string): string {
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: childEnv() });
    const files: string[][] = [];
    const walk = (parent: string): void => {
      for (const name of readdirSync(join(dir, parent)).sort()) {
        if (parent === "" && name === ".git") continue;
        const rel = parent ? `${parent}/${name}` : name;
        const stat = lstatSync(join(dir, rel));
        if (stat.isSymbolicLink()) files.push([rel, "link", readlinkSync(join(dir, rel))]);
        else if (stat.isDirectory()) {
          files.push([rel, "directory"]);
          walk(rel);
        } else files.push([rel, "file", readFileSync(join(dir, rel), "base64")]);
      }
    };
    walk("");
    return JSON.stringify({ head: git("rev-parse", "HEAD"), index: git("ls-files", "-s"), status: git("status", "--porcelain", "--ignored"), files });
  }

  for (const collision of [
    "mattstack/teams/widgets/packs/widgets/.keep",
    "mattstack/org/secrets/.keep",
    "mattstack/org/packs/acme-base/.keep",
    "mattstack/org/settings.org.jsonc",
    "mattstack/teams/widgets/settings.team.jsonc",
    "mattstack/org/settings.org.jsonc/.keep",
  ]) {
    test(`a tracked conversion destination at ${collision} is refused before changing anything`, () => {
      ready();
      const dir = tempClone({ [collision]: "keep these original bytes" });
      const before = snapshot(dir);
      const result = runScript(dir, "--write", "--roster-confirmed");
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain("[refused]");
      expect(result.stderr.toString()).toContain("destination already exists");
      expect(snapshot(dir)).toBe(before);
      expect(existsSync(join(dir, "mattstack/teams/widgets/packs/widgets/widgets"))).toBe(false);
    });
  }

  test("an existing empty move destination is refused without removing it", () => {
    ready();
    const dir = tempClone();
    mkdirSync(join(dir, "mattstack/teams/widgets/packs/widgets"), { recursive: true });
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("destination already exists");
    expect(snapshot(dir)).toBe(before);
  });

  for (const pattern of ["mattstack/teams/", "mattstack/org/settings.org.jsonc"]) {
    test(`rollback removes new ignored output under ${pattern} and permits a clean retry`, () => {
      ready();
      const dir = tempClone({
        ".gitignore": `${pattern}\noutside-cache/\n`,
        "mattstack/org/keep.txt": "keep org content",
        "mattstack/teams/keep.txt": "keep teams content",
      });
      execFileSync("git", ["-C", dir, "add", "-f", "--", "mattstack/teams/keep.txt"], { env: childEnv() });
      execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "keep shared parent"], { env: childEnv() });
      publish(dir);
      mkdirSync(join(dir, "mattstack/org/packs"), { recursive: true });
      mkdirSync(join(dir, "mattstack/teams/widgets/packs"), { recursive: true });
      mkdirSync(join(dir, "outside-cache"));
      writeFileSync(join(dir, "outside-cache/keep.txt"), "keep ignored content outside conversion");
      const before = snapshot(dir);
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = runScript(dir, "--write", "--roster-confirmed");
        expect(result.exitCode).toBe(1);
        expect(result.stderr.toString()).toContain("the clone is back as it was");
        expect(snapshot(dir)).toBe(before);
        expect(existsSync(join(dir, "mattstack/teams/widgets/settings.team.jsonc"))).toBe(false);
      }
      writeFileSync(join(dir, ".gitignore"), "outside-cache/\n");
      execFileSync("git", ["-C", dir, "add", "--", ".gitignore"], { env: childEnv() });
      execFileSync("git", ["-C", dir, "commit", "-q", "-m", "allow conversion output"], { env: childEnv() });
      publish(dir);
      expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(0);
      expect(readFileSync(join(dir, "mattstack/teams/widgets/packs/widgets/pack/skills.jsonc"), "utf8")).toBe("{}");
      expect(readFileSync(join(dir, "mattstack/org/secrets/rt.json"), "utf8")).toBe("{}");
      expect(readFileSync(join(dir, "mattstack/org/keep.txt"), "utf8")).toBe("keep org content");
      expect(readFileSync(join(dir, "mattstack/teams/keep.txt"), "utf8")).toBe("keep teams content");
      expect(readFileSync(join(dir, "outside-cache/keep.txt"), "utf8")).toBe("keep ignored content outside conversion");
      expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8", env: childEnv() }).trim()).toBe("");
    });
  }

  test("a dormant ignored destination with no existing parent leaves no residue after rollback", () => {
    ready();
    const dir = tempClone({ ".gitignore": "mattstack/teams/\n" });
    const before = snapshot(dir);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = runScript(dir, "--write", "--roster-confirmed");
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("the clone is back as it was");
      expect(snapshot(dir)).toBe(before);
      expect(existsSync(join(dir, "mattstack/teams"))).toBe(false);
    }
  });

  test("ignored existing conversion targets are refused without overwriting their bytes", () => {
    ready();
    const dir = tempClone({ ".gitignore": "mattstack/org/\n" });
    mkdirSync(join(dir, "mattstack/org"), { recursive: true });
    writeFileSync(join(dir, "mattstack/org/settings.org.jsonc"), "keep this ignored file");
    const before = snapshot(dir);
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(2);
    expect(snapshot(dir)).toBe(before);
    expect(readFileSync(join(dir, "mattstack/org/settings.org.jsonc"), "utf8")).toBe("keep this ignored file");
  });

  test("a symlink in the destination cannot write outside the clone", () => {
    ready();
    const dir = tempClone();
    const outside = join(home, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(dir, "mattstack/org"));
    execFileSync("git", ["-C", dir, "add", "--", "mattstack/org"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "destination link"], { env: childEnv() });
    const before = snapshot(dir);
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(2);
    expect(snapshot(dir)).toBe(before);
    expect(readdirSync(outside)).toEqual([]);
  });

  test("a commit failure restores original bytes, index and history", () => {
    ready();
    const dir = tempClone({ "mattstack/org/keep.txt": "keep org content" });
    mkdirSync(join(dir, "mattstack/org/packs"), { recursive: true });
    mkdirSync(join(dir, "mattstack/teams/widgets/packs"), { recursive: true });
    mkdirSync(join(dir, "mattstack/org/empty/child"), { recursive: true });
    mkdirSync(join(dir, "mattstack/teams/widgets/empty/child"), { recursive: true });
    const hook = join(dir, ".git/hooks/pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("the clone is back as it was");
    expect(snapshot(dir)).toBe(before);
    rmSync(hook);
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(0);
  });

  test("rollback preserves empty folders inside the moved packs and secrets", () => {
    ready();
    const dir = tempClone();
    for (const rel of ["mattstack/packs/widgets/empty/child", "mattstack/packs/acme-base/empty/child", "mattstack/secrets/empty/child"]) mkdirSync(join(dir, rel), { recursive: true });
    const hook = join(dir, ".git/hooks/pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("the clone is back as it was");
    expect(snapshot(dir)).toBe(before);
  });

  test("missing identity on a custom GitLab host names an explicit reachable connect remedy", () => {
    teamSyncOff();
    const store = settings(oldClone().files["mattstack/settings.team.jsonc"]!);
    store["mattstack.integrations"] = { forge: { provider: "gitlab", host: "forge.example.com" } };
    const dir = tempClone({ "mattstack/settings.team.jsonc": JSON.stringify(store) });
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("rt setup gitlab connect --host forge.example.com");
    expect(snapshot(dir)).toBe(before);
  });

  test("policy refusals and a dry run preserve tracked bytes, index and history", () => {
    const dir = tempClone();
    const before = snapshot(dir);
    for (const flags of [[], ["--write"], ["--write", "--roster-confirmed"]]) {
      const result = runScript(dir, ...flags);
      expect(result.exitCode).toBe(flags.length ? 2 : 0);
      expect(snapshot(dir)).toBe(before);
    }
    teamSyncOff();
    recordedAs("dev2");
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("[refused]");
    expect(snapshot(dir)).toBe(before);
    writeFileSync(join(dir, "untracked.txt"), "keep me");
    ready();
    const dirty = snapshot(dir);
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(2);
    expect(snapshot(dir)).toBe(dirty);
    expect(readFileSync(join(dir, "untracked.txt"), "utf8")).toBe("keep me");
  });

  test("untracked and ignored files are seen even when git hides untracked files", () => {
    ready();
    const dir = tempClone();
    execFileSync("git", ["-C", dir, "config", "status.showUntrackedFiles", "no"], { env: childEnv() });
    writeFileSync(join(dir, "mattstack", "secrets", "new.json"), "keep me");
    const untracked = runScript(dir, "--write", "--roster-confirmed");
    expect(untracked.exitCode).toBe(2);
    expect(untracked.stderr.toString()).toContain("The clone has uncommitted changes");
    expect(readFileSync(join(dir, "mattstack", "secrets", "new.json"), "utf8")).toBe("keep me");
    rmSync(join(dir, "mattstack", "secrets", "new.json"));
    writeFileSync(join(dir, "mattstack", "secrets", "draft.tmp"), "keep me too");
    const ignored = runScript(dir, "--write", "--roster-confirmed");
    expect(ignored.exitCode).toBe(2);
    expect(ignored.stderr.toString()).toContain("The clone has ignored files in its managed folders");
    expect(readFileSync(join(dir, "mattstack", "secrets", "draft.tmp"), "utf8")).toBe("keep me too");
    expect(existsSync(join(dir, "mattstack", "org"))).toBe(false);
  });

  test("without --write it prints the split and changes nothing", () => {
    const dir = tempClone();
    const out = runScript(dir);
    expect(out.exitCode).toBe(0);
    expect(out.stdout.toString()).toContain("Nothing was written");
    expect(existsSync(join(dir, "mattstack", "settings.team.jsonc"))).toBe(true);
  });

  test("--write refuses while team sync is on, says how to turn it off, and changes nothing", () => {
    const dir = tempClone();
    const out = runScript(dir, "--write", "--roster-confirmed");
    expect(out.exitCode).toBe(2);
    expect(out.stderr.toString()).toContain("Team sync is on for this Mac");
    expect(out.stderr.toString()).toContain(`rt settings set rt.teamSnapshot '{"enabled": false}' --scope machine`);
    expect(existsSync(join(dir, "mattstack", "org"))).toBe(false);
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8", env: childEnv() }).trim()).toBe("");
  });

  test("--write refuses on a Mac that is not recorded as the admin, since it could not publish the result", () => {
    teamSyncOff();
    const dir = tempClone();
    const nobody = runScript(dir, "--write", "--roster-confirmed");
    expect(nobody.exitCode).toBe(2);
    expect(nobody.stderr.toString()).toContain("This Mac has no recorded forge username");
    expect(nobody.stderr.toString()).toContain("rt setup gitlab connect --host gitlab.example.com");

    recordedAs("dev2");
    const other = runScript(dir, "--write", "--roster-confirmed");
    expect(other.exitCode).toBe(2);
    expect(other.stderr.toString()).toContain("dev2");
    expect(other.stderr.toString()).toContain("dev1");
    expect(existsSync(join(dir, "mattstack", "org"))).toBe(false);

    recordedAs("DEV1");
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(0);
  });

  test("a tracked file blocking a destination parent is refused before changing anything", () => {
    ready();
    const dir = tempClone({ "mattstack/org/packs": "in the way" });
    const before = snapshot(dir);
    const out = runScript(dir, "--write", "--roster-confirmed");
    expect(out.exitCode).toBe(2);
    expect(out.stderr.toString()).toContain("[refused]");
    expect(snapshot(dir)).toBe(before);
  });

  test("a real Git move failure restores the whole tree and permits a retry", () => {
    ready();
    const dir = tempClone({ "mattstack/org/keep.txt": "keep org content" });
    mkdirSync(join(dir, "mattstack/teams/widgets/packs"), { recursive: true });
    const before = snapshot(dir);
    const bin = join(home, "bin");
    mkdirSync(bin);
    const marker = join(home, "moves-happened");
    const shim = join(bin, "git");
    writeFileSync(shim, `#!/bin/sh
if [ "$3" = mv ] && [ "$5" = mattstack/packs/acme-base ]; then
  test -f "$2/mattstack/org/secrets/rt.json" || exit 91
  test -f "$2/mattstack/teams/widgets/packs/widgets/pack/skills.jsonc" || exit 92
  printf 'earlier moves happened\\n' > "$RT_CONVERT_MOVE_MARKER"
  exit 1
fi
exec "$RT_CONVERT_REAL_GIT" "$@"
`);
    chmodSync(shim, 0o755);
    const result = Bun.spawnSync(["bun", script, dir, "--admin", "dev1", "--write", "--roster-confirmed"], {
      env: { ...childEnv(), PATH: `${bin}:${process.env.PATH}`, RT_CONVERT_REAL_GIT: Bun.which("git")!, RT_CONVERT_MOVE_MARKER: marker }, stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("the clone is back as it was");
    expect(readFileSync(marker, "utf8")).toBe("earlier moves happened\n");
    expect(snapshot(dir)).toBe(before);
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(0);
    expect(readFileSync(join(dir, "mattstack/org/packs/acme-base/pack/skills.jsonc"), "utf8")).toBe(`{ "base": true }`);
  });

  test("--write refuses a clone behind origin, names the fast-forward, and changes nothing", () => {
    ready();
    const dir = tempClone();
    const other = join(home, "other");
    const gitEnv = { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" };
    execFileSync("git", ["clone", "-q", join(dirname(dir), "origin.git"), other], { env: gitEnv });
    writeFileSync(join(other, "pushed-since.txt"), "a teammate's change");
    execFileSync("git", ["-C", other, "add", "--", "pushed-since.txt"], { env: gitEnv });
    execFileSync("git", ["-C", other, "commit", "-q", "-m", "pushed since"], { env: gitEnv });
    execFileSync("git", ["-C", other, "push", "-q", "origin", "main"], { env: gitEnv });
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("[refused]");
    expect(result.stderr.toString()).toContain("The clone is behind origin");
    expect(result.stderr.toString()).toContain(`git -C ${dir} pull --ff-only`);
    expect(snapshot(dir)).toBe(before);
    execFileSync("git", ["-C", dir, "pull", "-q", "--ff-only", "origin", "main"], { env: childEnv() });
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(0);
  });

  test("--write refuses a clone with commits origin does not have, and changes nothing", () => {
    ready();
    const dir = tempClone();
    writeFileSync(join(dir, "local-only.txt"), "not published");
    execFileSync("git", ["-C", dir, "add", "--", "local-only.txt"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "local only"], { env: childEnv() });
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("The clone has commits origin does not have");
    expect(snapshot(dir)).toBe(before);
  });

  test("an empty secrets folder git does not track is left alone instead of failing the move", () => {
    ready();
    const dir = tempClone();
    execFileSync("git", ["-C", dir, "rm", "-q", "--", "mattstack/secrets/rt.json"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "no secrets yet"], { env: childEnv() });
    publish(dir);
    mkdirSync(join(dir, "mattstack", "secrets"), { recursive: true });
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.stderr.toString()).not.toContain("the clone is back as it was");
    expect(result.exitCode).toBe(0);
    expect(execFileSync("git", ["-C", dir, "ls-files", "--", "mattstack/org/secrets"], { encoding: "utf8", env: childEnv() }).trim()).toBe("");
    expect(existsSync(join(dir, "mattstack", "org", "settings.org.jsonc"))).toBe(true);
  });

  test("--write refuses a clone on another branch, names the switch, and changes nothing", () => {
    ready();
    const dir = tempClone();
    execFileSync("git", ["-C", dir, "switch", "-q", "-c", "prep"], { env: childEnv() });
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("[refused]");
    expect(result.stderr.toString()).toContain("The clone is not on main");
    expect(result.stderr.toString()).toContain("It is on prep.");
    expect(result.stderr.toString()).toContain(`git -C ${dir} switch main`);
    expect(snapshot(dir)).toBe(before);
    expect(execFileSync("git", ["-C", dir, "symbolic-ref", "--short", "HEAD"], { encoding: "utf8", env: childEnv() }).trim()).toBe("prep");
    execFileSync("git", ["-C", dir, "switch", "-q", "main"], { env: childEnv() });
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(0);
  });

  test("--write refuses a detached HEAD and changes nothing", () => {
    ready();
    const dir = tempClone();
    execFileSync("git", ["-C", dir, "switch", "-q", "--detach"], { env: childEnv() });
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("The clone is not on main");
    expect(result.stderr.toString()).toContain("It has no branch checked out.");
    expect(result.stderr.toString()).toContain(`git -C ${dir} switch main`);
    expect(snapshot(dir)).toBe(before);
  });

  test("--write refuses the branch origin's HEAD names when it is not main, and changes nothing", () => {
    ready();
    const dir = tempClone();
    execFileSync("git", ["-C", dir, "push", "-q", "origin", "main:trunk"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "fetch", "-q", "origin"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "remote", "set-head", "origin", "trunk"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "switch", "-q", "-c", "trunk", "--track", "origin/trunk"], { env: childEnv() });
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("[refused]");
    expect(result.stderr.toString()).toContain("The clone is not on main");
    expect(result.stderr.toString()).toContain("It is on trunk.");
    expect(result.stderr.toString()).toContain(`git -C ${dir} switch main`);
    expect(result.stderr.toString()).not.toContain("switch trunk");
    expect(snapshot(dir)).toBe(before);
    expect(execFileSync("git", ["-C", dir, "log", "-1", "--format=%s", "trunk"], { encoding: "utf8", env: childEnv() }).trim()).not.toBe("org: convert to the org layout");
  });

  test("--write stops before writing when origin cannot be fetched", () => {
    ready();
    const dir = tempClone();
    execFileSync("git", ["-C", dir, "remote", "set-url", "origin", join(home, "missing.git")], { env: childEnv() });
    const before = snapshot(dir);
    const result = runScript(dir, "--write", "--roster-confirmed");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Could not fetch origin to check that the clone is current");
    expect(snapshot(dir)).toBe(before);
  });

  test("--write without --roster-confirmed names the usernames and changes nothing", () => {
    teamSyncOff();
    const dir = tempClone();
    const out = runScript(dir, "--write");
    expect(out.exitCode).toBe(2);
    expect(out.stderr.toString()).toContain("dev1, dev2, dev3");
    expect(existsSync(join(dir, "mattstack", "org"))).toBe(false);
  });

  test("--write converts in one commit, and a second run refuses", () => {
    ready();
    const dir = tempClone();
    expect(runScript(dir, "--write", "--roster-confirmed").exitCode).toBe(0);
    expect(existsSync(join(dir, "mattstack", "org", "settings.org.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "org", "secrets", "rt.json"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "teams", "widgets", "packs", "widgets", "pack", "skills.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "team.jsonc"))).toBe(false);
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8", env: childEnv() }).trim()).toBe("");
    expect(execFileSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { encoding: "utf8", env: childEnv() }).trim()).toBe("2");

    const again = runScript(dir, "--write", "--roster-confirmed");
    expect(again.exitCode).toBe(1);
    expect(again.stderr.toString()).toContain("already has the org layout");
    expect(execFileSync("git", ["-C", dir, "rev-list", "--count", "HEAD"], { encoding: "utf8", env: childEnv() }).trim()).toBe("2");
  });

  test("the converted clone reads as an org with the team's zone", () => {
    ready();
    const dir = tempClone();
    runScript(dir, "--write", "--roster-confirmed");
    const fs: InitFs = { exists: existsSync, readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null), writeFile: () => {}, mkdirp: () => {}, readDir: (p) => (existsSync(p) ? readdirSync(p) : []) };
    const zones = readZonesFrom(fs, dirname(dir));
    expect(zones).toEqual([expect.objectContaining({ slug: "acme/widgets", host: "gitlab.example.com", projects: ["acme/widgets"], hasPack: true })]);
  });
});
