import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { execWithTimeout } from "../../setup/probes.ts";
import { applyRoleCone, coneFor, keptTeams } from "../org-cone.ts";
import { ORG_CLONE_FOLDERS } from "../org-clone.ts";
import { teamLocalPath } from "../team-local.ts";

describe("coneFor", () => {
  test("org owners and admins get every folder", () => {
    expect(coneFor({ kind: "org-owner" }, [])).toEqual([".claude-plugin", "mattstack"]);
    expect(coneFor({ kind: "admin" }, ["widgets"])).toEqual([".claude-plugin", "mattstack"]);
  });

  test("a member gets the org files and their own teams", () => {
    expect(coneFor({ kind: "member" }, ["widgets"])).toEqual([".claude-plugin", "mattstack/org", "mattstack/teams/widgets"]);
  });

  test("a team owner gets the teams they are listed on and the teams they own", () => {
    expect(coneFor({ kind: "owner", teams: ["gadgets"] }, ["gadgets", "widgets"])).toEqual([".claude-plugin", "mattstack/org", "mattstack/teams/gadgets", "mattstack/teams/widgets"]);
    expect(coneFor({ kind: "owner", teams: ["gadgets"] }, ["widgets"])).toEqual([".claude-plugin", "mattstack/org", "mattstack/teams/gadgets", "mattstack/teams/widgets"]);
  });

  test("someone on no team gets only the org files", () => {
    expect(coneFor({ kind: "member" }, [])).toEqual([".claude-plugin", "mattstack/org"]);
  });

  test("a team name that is not a folder name never reaches a path", () => {
    expect(coneFor({ kind: "member" }, ["../etc", "widgets", "widgets", "Bad Name"])).toEqual([".claude-plugin", "mattstack/org", "mattstack/teams/widgets"]);
  });
});

const p = {
  exec: execWithTimeout,
  readFile: (path: string): string | null => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
};
const MARKER = '{"role":"org","org":"acme","layout":4}';
const ORG = "acme";
const STORE = {
  "mattstack.org": { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } },
  "mattstack.roster": [
    { username: "dev1", teams: ["widgets", "gadgets"] },
    { username: "dev2", teams: ["widgets"] },
    { username: "dev3", teams: ["widgets"] },
    { username: "dev4", teams: ["gadgets"] },
  ],
};

let root: string;
let home: string;
let origin: string;
let clone: string;
let n = 0;

function env(): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
}

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: env() });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

function put(dir: string, rel: string, body: string): void {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
}

function whoAmI(username: string | null): void {
  const file = teamLocalPath(home, ORG);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(username === null ? {} : { forgeUsername: username }));
}

const probes = () => ({ ...p, home });
const present = (rel: string) => existsSync(join(clone, rel));

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "org-cone-"));
  home = join(root, "home");
  mkdirSync(home);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("applyRoleCone", () => {
  beforeEach(() => {
    const base = join(root, `case${n++}`);
    origin = join(base, "origin.git");
    clone = join(base, "clone");
    const seed = join(base, "seed");
    mkdirSync(seed, { recursive: true });
    git(base, "init", "-q", "--bare", "-b", "main", origin);
    git(base, "init", "-q", "-b", "main", seed);
    git(seed, "remote", "add", "origin", origin);
    put(seed, ".mattstack-org.json", MARKER);
    put(seed, ".sops.yaml", "creation_rules: []");
    put(seed, ".claude-plugin/marketplace.json", "{}");
    put(seed, "mattstack/mattstack.jsonc", MARKER);
    put(seed, "mattstack/org/settings.org.jsonc", JSON.stringify(STORE));
    put(seed, "mattstack/teams/widgets/settings.team.jsonc", "{}");
    put(seed, "mattstack/teams/gadgets/settings.team.jsonc", "{}");
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "seed");
    git(seed, "push", "-q", "origin", "main");
    git(base, "clone", "-q", origin, clone);
    whoAmI("dev3");
  }, 30_000);

  test("a member on widgets loses the gadgets folder and keeps the org files, including the marker", async () => {
    const result = await applyRoleCone(probes(), clone, ORG);
    expect(result).toEqual({ applied: [".claude-plugin", "mattstack/org", "mattstack/teams/widgets"], kept: [] });
    expect(present("mattstack/teams/gadgets")).toBe(false);
    expect(present("mattstack/teams/widgets/settings.team.jsonc")).toBe(true);
    expect(present("mattstack/org/settings.org.jsonc")).toBe(true);
    expect(present("mattstack/mattstack.jsonc")).toBe(true);
    expect(present(".sops.yaml")).toBe(true);
  });

  test("an org admin keeps every team folder", async () => {
    whoAmI("dev1");
    const result = await applyRoleCone(probes(), clone, ORG);
    expect(result.applied).toEqual([...ORG_CLONE_FOLDERS]);
    expect(present("mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
    expect(present("mattstack/teams/widgets/settings.team.jsonc")).toBe(true);
  });

  test("a role change restores a folder the clone had dropped", async () => {
    await applyRoleCone(probes(), clone, ORG);
    expect(present("mattstack/teams/gadgets")).toBe(false);
    whoAmI("dev1");
    await applyRoleCone(probes(), clone, ORG);
    expect(present("mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
  });

  test("an unsaved edit in a dropped team keeps the folder and names it", async () => {
    writeFileSync(join(clone, "mattstack/teams/gadgets/settings.team.jsonc"), '{"edited":true}');
    const result = await applyRoleCone(probes(), clone, ORG);
    expect(result.kept).toEqual(["gadgets"]);
    expect(result.applied).toContain("mattstack/teams/gadgets");
    expect(readFileSync(join(clone, "mattstack/teams/gadgets/settings.team.jsonc"), "utf8")).toBe('{"edited":true}');
  });

  test("a new untracked file in a dropped team keeps the folder", async () => {
    put(clone, "mattstack/teams/gadgets/notes.md", "mine");
    const result = await applyRoleCone(probes(), clone, ORG);
    expect(result.kept).toEqual(["gadgets"]);
    expect(present("mattstack/teams/gadgets/notes.md")).toBe(true);
  });

  test("an unpushed commit in a dropped team keeps the folder", async () => {
    put(clone, "mattstack/teams/gadgets/settings.team.jsonc", '{"committed":true}');
    git(clone, "commit", "-aq", "-m", "local only");
    const result = await applyRoleCone(probes(), clone, ORG);
    expect(result.kept).toEqual(["gadgets"]);
    expect(present("mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
  });

  test("a commit that is already pushed does not keep the folder", async () => {
    put(clone, "mattstack/teams/gadgets/settings.team.jsonc", '{"committed":true}');
    git(clone, "commit", "-aq", "-m", "pushed");
    git(clone, "push", "-q", "origin", "main");
    const result = await applyRoleCone(probes(), clone, ORG);
    expect(result.kept).toEqual([]);
    expect(present("mattstack/teams/gadgets")).toBe(false);
  });

  test("a missing remote-tracking ref counts as unpushed", async () => {
    git(clone, "update-ref", "-d", "refs/remotes/origin/main");
    const result = await applyRoleCone(probes(), clone, ORG);
    expect(result.kept).toEqual(["gadgets"]);
    expect(present("mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
  });

  test("a clone the join already coned narrows the same way", async () => {
    git(clone, "sparse-checkout", "set", "--cone", ...ORG_CLONE_FOLDERS);
    const result = await applyRoleCone(probes(), clone, ORG);
    expect(result.kept).toEqual([]);
    expect(present("mattstack/teams/gadgets")).toBe(false);
    expect(present("mattstack/teams/widgets/settings.team.jsonc")).toBe(true);
  });

  test("a username the org does not know is a member with no teams, so it narrows", async () => {
    whoAmI("stranger");
    expect((await applyRoleCone(probes(), clone, ORG)).applied).toEqual([".claude-plugin", "mattstack/org"]);
  });

  test("an ignored file in a dropped team keeps the folder, since the narrowing would delete it", async () => {
    put(clone, ".git/info/exclude", "*.local\n");
    put(clone, "mattstack/teams/gadgets/secrets.local", "mine");
    const result = await applyRoleCone(probes(), clone, ORG);
    expect(result.kept).toEqual(["gadgets"]);
    expect(present("mattstack/teams/gadgets/secrets.local")).toBe(true);
  });

  test("keptTeams names the dropped teams holding changes and changes nothing", async () => {
    writeFileSync(join(clone, "mattstack/teams/gadgets/settings.team.jsonc"), '{"edited":true}');
    expect(await keptTeams(probes(), clone, ORG)).toEqual(["gadgets"]);
    expect(() => git(clone, "config", "--get", "core.sparseCheckout")).toThrow();
    expect(present("mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
  });

  test("keptTeams is empty when nothing dropped holds changes", async () => {
    expect(await keptTeams(probes(), clone, ORG)).toEqual([]);
  });

  describe("never narrows on data it cannot trust", () => {
    const full = [...ORG_CLONE_FOLDERS];

    test("no forge username", async () => {
      whoAmI(null);
      expect((await applyRoleCone(probes(), clone, ORG)).applied).toEqual(full);
      expect(present("mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
    });

    test("an org store that is missing", async () => {
      rmSync(join(clone, "mattstack/org/settings.org.jsonc"));
      expect((await applyRoleCone(probes(), clone, ORG)).applied).toEqual(full);
      expect(present("mattstack/teams/gadgets/settings.team.jsonc")).toBe(true);
    });

    test("an org store that is not valid JSON", async () => {
      writeFileSync(join(clone, "mattstack/org/settings.org.jsonc"), "{ not json");
      expect((await applyRoleCone(probes(), clone, ORG)).applied).toEqual(full);
    });

    test("an org store whose roles block is malformed", async () => {
      writeFileSync(join(clone, "mattstack/org/settings.org.jsonc"), JSON.stringify({ "mattstack.org": { admins: "dev1" }, "mattstack.roster": STORE["mattstack.roster"] }));
      expect((await applyRoleCone(probes(), clone, ORG)).applied).toEqual(full);
    });

    test("a roster that is not a list", async () => {
      writeFileSync(join(clone, "mattstack/org/settings.org.jsonc"), JSON.stringify({ ...STORE, "mattstack.roster": { dev3: ["widgets"] } }));
      expect((await applyRoleCone(probes(), clone, ORG)).applied).toEqual(full);
    });

    test("this user's roster entry with teams that are not a list", async () => {
      writeFileSync(join(clone, "mattstack/org/settings.org.jsonc"), JSON.stringify({ ...STORE, "mattstack.roster": [{ username: "dev3", teams: "widgets" }] }));
      expect((await applyRoleCone(probes(), clone, ORG)).applied).toEqual(full);
    });

    test("an org that names no admins or owners yet", async () => {
      writeFileSync(join(clone, "mattstack/org/settings.org.jsonc"), JSON.stringify({ "mattstack.roster": STORE["mattstack.roster"] }));
      expect((await applyRoleCone(probes(), clone, ORG)).applied).toEqual(full);
    });
  });
});
