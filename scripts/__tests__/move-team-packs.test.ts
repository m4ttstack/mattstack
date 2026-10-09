import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { parse } from "jsonc-parser";
import { machineSettingsPath } from "../../lib/rt-paths.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { MoveRefusal, planMove, type MoveInput } from "../lib/move-team-packs.ts";

const ORG_STORE = "mattstack/org/settings.org.jsonc";
const WIDGETS_STORE = "mattstack/teams/widgets/settings.team.jsonc";
const NESTED = "mattstack/teams/widgets/packs/widgets";
const MOVED = "mattstack/teams/widgets/plugin";

function orgRepo(overrides: Partial<MoveInput> = {}): MoveInput {
  return {
    teams: ["gadgets", "widgets"],
    nested: { widgets: ["widgets"] },
    hasPlugin: { widgets: false, gadgets: false },
    files: {
      "mattstack/mattstack.jsonc": JSON.stringify({ role: "org", org: "acme" }),
      ".claude-plugin/marketplace.json": JSON.stringify({ name: "acme", owner: { name: "Acme" }, plugins: [
        { name: "widgets", source: "./mattstack/teams/widgets/packs/widgets", description: "d" },
        { name: "widgets-extra", source: "./mattstack/teams/widgets/packs/widgets-extra" },
        { name: "acme-base", source: "./mattstack/org/packs/acme-base" },
      ] }, null, 2),
      [ORG_STORE]: JSON.stringify({
        "board.projects": ["acme/widgets"],
        repos: { "gitlab.example.com/acme/widgets": { "rt.roles": { dev: { hook: "${org}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh" } } } },
        "rt.extraHook": "${org}/mattstack/teams/widgets/packs/widgets-extra/hooks/x.sh",
        "rt.baseHook": "${org}/mattstack/org/packs/acme-base/hooks/b.sh",
      }),
      [WIDGETS_STORE]: JSON.stringify({ "board.title": "Widgets", "rt.endpoint": { script: "${team:acme}/mattstack/teams/widgets/packs/widgets/scripts/run.ts" } }),
      "mattstack/teams/gadgets/settings.team.jsonc": "{}",
      [`${NESTED}/.claude-plugin/plugin.json`]: JSON.stringify({ name: "widgets", version: "1.4.2", skills: "./skills/" }, null, 2),
      [`${NESTED}/pack/skills.jsonc`]: "{}",
      ...overrides.files,
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "files")),
  };
}

describe("planMove", () => {
  test("moves each nested pack to plugin/, bumps its version and points the marketplace at it", () => {
    const plan = planMove(orgRepo());
    expect(plan.moves).toEqual([[NESTED, MOVED]]);
    expect(JSON.parse(plan.writes[`${MOVED}/.claude-plugin/plugin.json`]!)).toEqual({ name: "widgets", version: "1.4.3", skills: "./skills/" });
    expect(JSON.parse(plan.writes[".claude-plugin/marketplace.json"]!).plugins).toEqual([
      { name: "widgets", source: "./mattstack/teams/widgets/plugin", description: "d" },
      { name: "widgets-extra", source: "./mattstack/teams/widgets/packs/widgets-extra" },
      { name: "acme-base", source: "./mattstack/org/packs/acme-base" },
    ]);
  });

  test("writes layout 2 into the marker, keeping its other keys and header", () => {
    const plan = planMove(orgRepo({ files: { "mattstack/mattstack.jsonc": `// org marker\n${JSON.stringify({ role: "org", org: "acme", extra: true })}` } }));
    expect(plan.writes["mattstack/mattstack.jsonc"]!.startsWith("// org marker\n")).toBe(true);
    expect(parse(plan.writes["mattstack/mattstack.jsonc"]!)).toEqual({ role: "org", org: "acme", extra: true, layout: 2 });
    expect(plan.report).toContain("marker: layout 2");
  });

  test("leaves a marker that already says layout 2 alone", () => {
    const plan = planMove(orgRepo({ files: { "mattstack/mattstack.jsonc": JSON.stringify({ role: "org", org: "acme", layout: 2 }) } }));
    expect(plan.writes["mattstack/mattstack.jsonc"]).toBeUndefined();
  });

  test("a marketplace entry that carries its own version gets the bumped version", () => {
    const market = JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: `./${NESTED}`, version: "1.4.2" }] });
    const plan = planMove(orgRepo({ files: { ".claude-plugin/marketplace.json": market } }));
    expect(JSON.parse(plan.writes[".claude-plugin/marketplace.json"]!).plugins[0]).toEqual({ name: "widgets", source: `./${MOVED}`, version: "1.4.3" });
  });

  test("an entry under another name whose source is the nested pack is pointed at plugin/ too", () => {
    const market = JSON.stringify({ name: "acme", plugins: [
      { name: "widgets", source: `./${NESTED}` },
      { name: "widgets-alias", source: `./${NESTED}/`, version: "1.4.2" },
      { name: "widgets-bare", source: NESTED },
    ] });
    const plan = planMove(orgRepo({ files: { ".claude-plugin/marketplace.json": market } }));
    expect(JSON.parse(plan.writes[".claude-plugin/marketplace.json"]!).plugins).toEqual([
      { name: "widgets", source: `./${MOVED}` },
      { name: "widgets-alias", source: `./${MOVED}`, version: "1.4.3" },
      { name: "widgets-bare", source: `./${MOVED}` },
    ]);
    expect(plan.report).toContain(`marketplace: widgets-alias source ./${NESTED}/ to ./${MOVED}`);
    expect(plan.report).toContain("marketplace: widgets-alias version 1.4.2 to 1.4.3");
    expect(plan.report).toContain(`marketplace: widgets-bare source ${NESTED} to ./${MOVED}`);
  });

  test("an entry that points inside the moved folder is refused, since the move removes it", () => {
    const market = JSON.stringify({ name: "acme", plugins: [{ name: "widgets", source: `./${NESTED}` }, { name: "widgets-sub", source: `./${NESTED}/sub` }] });
    expect(() => planMove(orgRepo({ files: { ".claude-plugin/marketplace.json": market } }))).toThrow(`The marketplace entry widgets-sub points inside ${NESTED}`);
  });

  test("the report names each marketplace re-point", () => {
    expect(planMove(orgRepo()).report).toContain(`marketplace: widgets source ./${NESTED} to ./${MOVED}`);
  });

  test("a moved team with no marketplace entry is reported, and an unchanged marketplace is not written", () => {
    const market = JSON.stringify({ name: "acme", plugins: [{ name: "acme-base", source: "./mattstack/org/packs/acme-base" }] });
    const plan = planMove(orgRepo({ files: { ".claude-plugin/marketplace.json": market } }));
    expect(plan.report).toContain("no marketplace entry for widgets");
    expect(plan.writes[".claude-plugin/marketplace.json"]).toBeUndefined();
    expect(plan.moves).toEqual([[NESTED, MOVED]]);
  });

  test("a refusal is a MoveRefusal that carries why apart from its title", () => {
    let thrown: unknown;
    try {
      planMove(orgRepo({ hasPlugin: { widgets: true, gadgets: false } }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MoveRefusal);
    expect((thrown as MoveRefusal).message).toBe(`widgets has both ${NESTED} and ${MOVED}`);
    expect((thrown as MoveRefusal).why).toBe("Keep one before moving.");
  });

  test("rewrites stored values that spell the nested path under ${org} and ${team:}, and nothing else", () => {
    const plan = planMove(orgRepo());
    expect(parse(plan.writes[ORG_STORE]!).repos["gitlab.example.com/acme/widgets"]["rt.roles"].dev.hook).toBe("${org}/mattstack/teams/widgets/plugin/hooks/dev.sh");
    expect(parse(plan.writes[WIDGETS_STORE]!)["rt.endpoint"].script).toBe("${team:acme}/mattstack/teams/widgets/plugin/scripts/run.ts");
    expect(plan.writes["mattstack/teams/gadgets/settings.team.jsonc"]).toBeUndefined();
    expect(parse(plan.writes[ORG_STORE]!)["rt.extraHook"]).toBe("${org}/mattstack/teams/widgets/packs/widgets-extra/hooks/x.sh");
    expect(parse(plan.writes[ORG_STORE]!)["rt.baseHook"]).toBe("${org}/mattstack/org/packs/acme-base/hooks/b.sh");
    expect(plan.report).toContain("rewrote ${org}/mattstack/teams/widgets/packs/widgets/hooks/dev.sh to ${org}/mattstack/teams/widgets/plugin/hooks/dev.sh");
  });

  test("comments in a rewritten store are reported, and a store with nothing to rewrite stays unwritten", () => {
    const plan = planMove(orgRepo({ files: {
      [WIDGETS_STORE]: `// team\n{\n  // the endpoint\n  "x": "\${org}/mattstack/teams/widgets/packs/widgets/a"\n}\n`,
      [ORG_STORE]: JSON.stringify({ "board.projects": ["acme/widgets"] }),
    } }));
    expect(plan.writes[WIDGETS_STORE]).toBeDefined();
    expect(plan.report).toContain(`comments in ${WIDGETS_STORE} are not carried over`);
    expect(plan.writes[ORG_STORE]).toBeUndefined();
  });

  test("the one-line header a store starts with is kept and is not reported as a lost comment", () => {
    const plan = planMove(orgRepo({ files: { [WIDGETS_STORE]: `// team\n${JSON.stringify({ x: "\${org}/mattstack/teams/widgets/packs/widgets/a" })}` } }));
    expect(plan.writes[WIDGETS_STORE]!.startsWith("// team\n")).toBe(true);
    expect(parse(plan.writes[WIDGETS_STORE]!).x).toBe("${org}/mattstack/teams/widgets/plugin/a");
    expect(plan.report.some((line) => line.startsWith("comments in"))).toBe(false);
  });

  test("the report names each move, bump and settings-only team", () => {
    const { report } = planMove(orgRepo());
    expect(report).toContain(`move ${NESTED} to ${MOVED}`);
    expect(report).toContain("widgets: version 1.4.2 to 1.4.3");
    expect(report).toContain("gadgets: no pack, left alone");
  });

  test("a repo that is not an org, or has nothing nested, is refused", () => {
    expect(() => planMove(orgRepo({ files: { "mattstack/mattstack.jsonc": JSON.stringify({ role: "team" }) } }))).toThrow("not a mattstack org repo");
    expect(() => planMove(orgRepo({ nested: {}, hasPlugin: { widgets: true, gadgets: false } }))).toThrow("nothing to move");
  });

  test("a marker already past layout 2 is refused, so the move never lowers it", () => {
    let thrown: unknown;
    try {
      planMove(orgRepo({ files: { "mattstack/mattstack.jsonc": JSON.stringify({ role: "org", org: "acme", layout: 3 }) } }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MoveRefusal);
    expect((thrown as MoveRefusal).message).toBe("This org is already past layout 2");
    expect((thrown as MoveRefusal).why).toBe("The layout 2 move would lower it.");
  });

  test("a team with both packs/<team> and plugin/, or a packs/ folder not named for the team, is refused", () => {
    expect(() => planMove(orgRepo({ hasPlugin: { widgets: true, gadgets: false } }))).toThrow("widgets has both");
    expect(() => planMove(orgRepo({ nested: { widgets: ["widgets", "other"] } }))).toThrow("packs/other");
  });

  test("a nested pack without a parseable plugin.json, or a store that does not parse, is refused by name", () => {
    expect(() => planMove(orgRepo({ files: { [`${NESTED}/.claude-plugin/plugin.json`]: "{ nope" } }))).toThrow(`${NESTED}/.claude-plugin/plugin.json`);
    expect(() => planMove(orgRepo({ files: { [ORG_STORE]: "{ nope" } }))).toThrow(ORG_STORE);
  });

  test("a nested pack with no plugin.json is refused by name, before any version check", () => {
    const input = orgRepo();
    delete input.files[`${NESTED}/.claude-plugin/plugin.json`];
    expect(() => planMove(input)).toThrow(`${NESTED}/.claude-plugin/plugin.json is missing`);
  });

  test("a repo with no marketplace is refused instead of getting a new one", () => {
    const input = orgRepo();
    delete input.files[".claude-plugin/marketplace.json"];
    expect(() => planMove(input)).toThrow(".claude-plugin/marketplace.json is missing");
  });

  test("a version that is not x.y.z cannot be bumped", () => {
    expect(() => planMove(orgRepo({ files: { [`${NESTED}/.claude-plugin/plugin.json`]: JSON.stringify({ name: "widgets", version: "2" }) } }))).toThrow("not x.y.z");
  });
});

describe("the wrapper", () => {
  const origHome = process.env.HOME;
  let home: string;
  let cloneCount = 0;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-move-home-")));
    process.env.HOME = home;
  });
  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });
  function teamSyncOff(): void {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), JSON.stringify({ "rt.teamSnapshot": { enabled: false } }));
  }
  function recordedAs(username: string): void {
    const file = join(home, ".mattstack", "rt", "teams", "acme.json");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ forgeUsername: username }));
  }
  function ready(): void {
    teamSyncOff();
    recordedAs("dev1");
  }
  function tempClone(extra: Record<string, string> = {}): string {
    const dir = join(home, `clone-${cloneCount++}`, "acme");
    const files = { ...orgRepo().files, [`${NESTED}/skills/work/SKILL.md`]: "# work\n", [`${NESTED}/attachments/.keep`]: "", ...extra };
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    const git = (...argv: string[]) => execFileSync("git", ["-C", dir, ...argv], { env: { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
    git("init", "-q", "-b", "main");
    git("config", "user.name", "t");
    git("config", "user.email", "t@example.com");
    git("add", "--", ".");
    git("commit", "-q", "-m", "nested layout");
    const origin = join(dirname(dir), "origin.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: childEnv() });
    git("remote", "add", "origin", origin);
    git("push", "-q", "origin", "main");
    return dir;
  }
  function publish(dir: string): void {
    execFileSync("git", ["-C", dir, "push", "-q", "origin", "main"], { env: childEnv() });
  }
  const script = join(import.meta.dir, "..", "move-team-packs-to-plugin.ts");
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

  test("--write moves the pack, bumps the version, rewrites the stores and the marketplace, and commits once", () => {
    ready();
    const dir = tempClone();
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dir, MOVED, "skills", "work", "SKILL.md"))).toBe(true);
    expect(existsSync(join(dir, "mattstack", "teams", "widgets", "packs"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, MOVED, ".claude-plugin", "plugin.json"), "utf8")).version).toBe("1.4.3");
    expect(JSON.parse(readFileSync(join(dir, ".claude-plugin", "marketplace.json"), "utf8")).plugins[0].source).toBe(`./${MOVED}`);
    expect(parse(readFileSync(join(dir, ORG_STORE), "utf8")).repos["gitlab.example.com/acme/widgets"]["rt.roles"].dev.hook).toBe("${org}/mattstack/teams/widgets/plugin/hooks/dev.sh");
    expect(parse(readFileSync(join(dir, "mattstack", "mattstack.jsonc"), "utf8")).layout).toBe(2);
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env: childEnv() });
    expect(git("log", "--format=%s", "-1").trim()).toBe("org: move team packs to plugin/");
    expect(git("rev-list", "--count", "origin/main..HEAD").trim()).toBe("1");
    expect(git("status", "--porcelain").trim()).toBe("");
  });

  test("without --write it prints the plan and changes nothing", () => {
    ready();
    const dir = tempClone();
    const before = snapshot(dir);
    const result = runScript(dir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(`move ${NESTED} to ${MOVED}`);
    expect(snapshot(dir)).toBe(before);
  });

  test("--write refuses while team sync is on, says how to turn it off, and changes nothing", () => {
    recordedAs("dev1");
    const dir = tempClone();
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("Team sync is on");
    expect(result.stderr.toString()).toContain("rt.teamSnapshot");
    expect(snapshot(dir)).toBe(before);
  });

  test("--write refuses on a Mac not recorded as the admin", () => {
    teamSyncOff();
    recordedAs("dev2");
    const dir = tempClone();
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("recorded as dev2");
    expect(snapshot(dir)).toBe(before);
  });

  test("an existing plugin/ destination is refused before changing anything", () => {
    ready();
    const dir = tempClone({ [`${MOVED}/.keep`]: "keep these original bytes" });
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString().startsWith(`[refused] widgets has both ${NESTED} and ${MOVED}`)).toBe(true);
    expect(result.stderr.toString()).toContain("Keep one before moving.");
    expect(result.stderr.toString()).not.toContain("[failed]");
    expect(snapshot(dir)).toBe(before);
  });

  test("a symlink on a move path is refused before anything is read through it", () => {
    ready();
    const dir = tempClone();
    const packs = join(dir, "mattstack", "teams", "widgets", "packs");
    const outside = join(home, "outside");
    // The whole packs/ folder moves outside the clone and a link takes its place, so every read of the nested pack would cross it.
    execFileSync("mv", [packs, outside]);
    symlinkSync(outside, packs);
    execFileSync("git", ["-C", dir, "add", "-A"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "link"], { env: { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
    execFileSync("git", ["-C", dir, "push", "-q", "origin", "main"], { env: childEnv() });
    const before = snapshot(dir);
    const outsideBefore = readdirSync(join(outside, "widgets")).sort();
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("symbolic link");
    expect(snapshot(dir)).toBe(before);
    expect(readdirSync(join(outside, "widgets")).sort()).toEqual(outsideBefore);
    expect(existsSync(join(dir, MOVED))).toBe(false);
  });

  test("a clone with uncommitted changes, or one behind origin, is refused and left alone", () => {
    ready();
    const dir = tempClone();
    writeFileSync(join(dir, "mattstack", "teams", "gadgets", "settings.team.jsonc"), "{ \"x\": 1 }");
    let before = snapshot(dir);
    let result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("uncommitted changes");
    expect(snapshot(dir)).toBe(before);
    execFileSync("git", ["-C", dir, "checkout", "--", "."], { env: childEnv() });
    const other = join(home, "other");
    execFileSync("git", ["clone", "-q", join(dirname(dir), "origin.git"), other], { env: childEnv() });
    writeFileSync(join(other, "README.md"), "x");
    execFileSync("git", ["-C", other, "add", "README.md"], { env: childEnv() });
    execFileSync("git", ["-C", other, "commit", "-q", "-m", "ahead"], { env: { ...childEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
    execFileSync("git", ["-C", other, "push", "-q", "origin", "main"], { env: childEnv() });
    before = snapshot(dir);
    result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("behind origin");
    expect(snapshot(dir)).toBe(before);
  });

  test("a commit failure restores the start: bytes, index, history and empty folders", () => {
    ready();
    const dir = tempClone();
    mkdirSync(join(dir, NESTED, "empty", "child"), { recursive: true });
    const before = snapshot(dir);
    const hooks = join(dir, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("back as it was");
    expect(snapshot(dir)).toBe(before);
    expect(existsSync(join(dir, NESTED, "attachments"))).toBe(true);
    expect(existsSync(join(dir, NESTED, "empty", "child"))).toBe(true);
  });

  test("rollback removes new ignored output, keeps other ignored content, and permits a clean retry", () => {
    ready();
    const dir = tempClone({ ".gitignore": "mattstack/teams/widgets/plugin/\noutside-cache/\n" });
    mkdirSync(join(dir, "outside-cache"));
    writeFileSync(join(dir, "outside-cache", "keep.txt"), "keep ignored content outside the move");
    const before = snapshot(dir);
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = runScript(dir, "--write");
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("the clone is back as it was");
      expect(snapshot(dir)).toBe(before);
      expect(existsSync(join(dir, MOVED))).toBe(false);
    }
    writeFileSync(join(dir, ".gitignore"), "outside-cache/\n");
    execFileSync("git", ["-C", dir, "add", "--", ".gitignore"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "allow the moved pack"], { env: childEnv() });
    publish(dir);
    expect(runScript(dir, "--write").exitCode).toBe(0);
    expect(readFileSync(join(dir, MOVED, "pack", "skills.jsonc"), "utf8")).toBe("{}");
    expect(readFileSync(join(dir, "outside-cache", "keep.txt"), "utf8")).toBe("keep ignored content outside the move");
  });

  test("untracked and ignored files in the managed folders are refused, even when git hides untracked files", () => {
    ready();
    const dir = tempClone({ ".gitignore": "*.tmp\n" });
    execFileSync("git", ["-C", dir, "config", "status.showUntrackedFiles", "no"], { env: childEnv() });
    writeFileSync(join(dir, "mattstack", "teams", "widgets", "new.json"), "keep me");
    const untracked = runScript(dir, "--write");
    expect(untracked.exitCode).toBe(2);
    expect(untracked.stderr.toString()).toContain("The clone has uncommitted changes");
    expect(readFileSync(join(dir, "mattstack", "teams", "widgets", "new.json"), "utf8")).toBe("keep me");
    rmSync(join(dir, "mattstack", "teams", "widgets", "new.json"));
    writeFileSync(join(dir, NESTED, "draft.tmp"), "keep me too");
    const before = snapshot(dir);
    const ignored = runScript(dir, "--write");
    expect(ignored.exitCode).toBe(2);
    expect(ignored.stderr.toString()).toContain("The clone has ignored files in its managed folders");
    expect(snapshot(dir)).toBe(before);
    expect(readFileSync(join(dir, NESTED, "draft.tmp"), "utf8")).toBe("keep me too");
    expect(existsSync(join(dir, MOVED))).toBe(false);
  });

  test("--write refuses a clone with commits origin does not have, and changes nothing", () => {
    ready();
    const dir = tempClone();
    writeFileSync(join(dir, "local-only.txt"), "not published");
    execFileSync("git", ["-C", dir, "add", "--", "local-only.txt"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "local only"], { env: childEnv() });
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("The clone has commits origin does not have");
    expect(snapshot(dir)).toBe(before);
    publish(dir);
    expect(runScript(dir, "--write").exitCode).toBe(0);
  });

  test("--write moves on a branch origin has, committing there and leaving main alone", () => {
    ready();
    const dir = tempClone();
    const mainBefore = execFileSync("git", ["-C", dir, "rev-parse", "main"], { encoding: "utf8", env: childEnv() }).trim();
    execFileSync("git", ["-C", dir, "switch", "-q", "-c", "org-trial"], { env: childEnv() });
    execFileSync("git", ["-C", dir, "push", "-q", "-u", "origin", "org-trial"], { env: childEnv() });
    expect(runScript(dir, "--write").exitCode).toBe(0);
    expect(execFileSync("git", ["-C", dir, "log", "-1", "--format=%s", "org-trial"], { encoding: "utf8", env: childEnv() }).trim()).toBe("org: move team packs to plugin/");
    expect(execFileSync("git", ["-C", dir, "rev-parse", "main"], { encoding: "utf8", env: childEnv() }).trim()).toBe(mainBefore);
  });

  test("--write refuses a branch origin does not have yet, names the push, and changes nothing", () => {
    ready();
    const dir = tempClone();
    execFileSync("git", ["-C", dir, "switch", "-q", "-c", "prep"], { env: childEnv() });
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("Origin has no prep branch");
    expect(result.stderr.toString()).toContain(`git -C ${dir} push -u origin prep`);
    expect(snapshot(dir)).toBe(before);
  });

  test("--write refuses a detached HEAD and changes nothing", () => {
    ready();
    const dir = tempClone();
    execFileSync("git", ["-C", dir, "switch", "-q", "--detach"], { env: childEnv() });
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("The clone has no branch checked out");
    expect(result.stderr.toString()).toContain(`git -C ${dir} switch main`);
    expect(snapshot(dir)).toBe(before);
  });

  test("--write stops before writing when origin cannot be fetched", () => {
    ready();
    const dir = tempClone();
    execFileSync("git", ["-C", dir, "remote", "set-url", "origin", join(home, "missing.git")], { env: childEnv() });
    const before = snapshot(dir);
    const result = runScript(dir, "--write");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Could not fetch origin to check that the clone is current");
    expect(snapshot(dir)).toBe(before);
  });
});
