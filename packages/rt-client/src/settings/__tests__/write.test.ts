/**
 * lib/settings/write.ts — setSetting: comment-preserving writes into the
 * user/team/machine stores, plus every refusal rule.
 *
 * Every test re-points HOME to a fresh temp dir (the resolve.test.ts /
 * stores.test.ts pattern): store files are process-global state — rt-paths
 * resolves HOME at call time — so tests must never share a tree.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { machineSettingsPath, orgDir, orgSettingsPath, teamLocalPath, teamSettingsPath, teamsDir, userSettingsPath } from "../paths.ts";
import { getSetting } from "../resolve.ts";
import { readStore } from "../stores.ts";
import { setSetting, setSettingsNoticeSink, unsetSetting, type SettingsNotice } from "../write.ts";
import * as isolation from "../../test-isolation.ts";
import { withSchema } from "./with-schema.ts";
import { suspendRepoOnly } from "./without-repo-only.ts";
import { seedOrg, sharedStorePath } from "../../../test/org-fixture.ts";

const IDENTITY = "gitlab.com/acme/acme-dev";
const ORG = "acme";

// rt.worktrees stands in for any global key in these store-mechanics tests;
// the repo-only refusal itself is pinned with rt.roles below.
let restoreRepoOnly: () => void;
beforeEach(() => {
  restoreRepoOnly = suspendRepoOnly(["rt.worktrees"]);
});
afterEach(() => restoreRepoOnly());

describe("settings/write", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-write-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  // ─── fixtures ──────────────────────────────────────────────────────────────

  function write(file: string, content: string): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  function seedShared(name: string): void {
    write(sharedStorePath(name), `// ${name} org store\n{}\n`);
  }

  function readUser(): string {
    return readFileSync(userSettingsPath(), "utf8");
  }

  function readMachine(): string {
    return readFileSync(machineSettingsPath(), "utf8");
  }

  // ─── creating an absent store file ─────────────────────────────────────────

  describe("seeding an absent store", () => {
    test("creates the user store with a header comment when absent", () => {
      expect(() => setSetting("rt.worktrees", { onDeck: 3 }, "user")).not.toThrow();

      const content = readUser();
      expect(content).toContain("//");
      const parsed = JSON.parse(content.replace(/^\/\/.*\n/, ""));
      expect(parsed["rt.worktrees"]).toEqual({ onDeck: 3 });
    });

    test("creates the machine store when absent", () => {
      setSetting("rt.worktrees", { onDeck: 5 }, "machine");

      const content = readMachine();
      const parsed = JSON.parse(content.replace(/^\/\/.*\n/, ""));
      expect(parsed["rt.worktrees"]).toEqual({ onDeck: 5 });
    });

    test("creates the machine store's nested user/local/<machineKey()> directory when none of it exists yet", () => {
      // The machine store now lives two directories deeper than a bare
      // ~/.mattstack — nothing under ~/.mattstack/user/local exists on a
      // fresh HOME, so the write must mkdir the whole chain, not just the
      // immediate parent.
      expect(() => setSetting("rt.worktrees", { onDeck: 7 }, "machine")).not.toThrow();

      const content = readMachine();
      const parsed = JSON.parse(content.replace(/^\/\/.*\n/, ""));
      expect(parsed["rt.worktrees"]).toEqual({ onDeck: 7 });
    });

    test("the header comment lands before the closing brace, not after it", () => {
      // Regression for the verified jsonc-parser footgun: modify() on a
      // comment-only file with no braces at all pushes the header AFTER the
      // closing brace. Seeding with `// header\n{}\n` first avoids it.
      setSetting("rt.worktrees", { onDeck: 3 }, "user");

      const content = readUser();
      const closeBraceIndex = content.lastIndexOf("}");
      const commentIndex = content.indexOf("//");
      expect(commentIndex).toBeGreaterThanOrEqual(0);
      expect(commentIndex).toBeLessThan(closeBraceIndex);
    });
  });

  // ─── comment preservation ───────────────────────────────────────────────────

  describe("comment preservation", () => {
    test("a comment next to an untouched key survives a write to a different key", () => {
      write(
        userSettingsPath(),
        `{\n  // do not touch this key\n  "rt.cron": { "enabled": true },\n}\n`,
      );

      setSetting("rt.worktrees", { onDeck: 3 }, "user");

      const lines = readUser().split("\n");
      expect(lines).toContain("  // do not touch this key");
    });

    test("a header comment above the object survives a write", () => {
      write(userSettingsPath(), `// user settings — safe to commit\n{}\n`);

      setSetting("rt.worktrees", { onDeck: 3 }, "user");

      const lines = readUser().split("\n");
      expect(lines).toContain("// user settings — safe to commit");
    });
  });

  // ─── repoScoped writes ──────────────────────────────────────────────────────

  describe("repoScoped writes", () => {
    test("creates the nested repos.<identity>.<key> section when absent", () => {
      setSetting("rt.roles", { backend: { pool: [3000, 3001] } }, "user", { repoIdentity: IDENTITY });

      const parsed = JSON.parse(readUser().replace(/^\/\/.*\n/, ""));
      expect(parsed.repos[IDENTITY]["rt.roles"]).toEqual({ backend: { pool: [3000, 3001] } });
    });

    test("a global-scope key written alongside a repos section leaves the repos section intact", () => {
      setSetting("rt.roles", { backend: {} }, "user", { repoIdentity: IDENTITY });
      setSetting("rt.gitStatus", { sweep: false }, "user");

      const parsed = JSON.parse(readUser().replace(/^\/\/.*\n/, ""));
      expect(parsed.repos[IDENTITY]["rt.roles"]).toEqual({ backend: {} });
      expect(parsed["rt.gitStatus"]).toEqual({ sweep: false });
    });
  });

  // ─── refusals ───────────────────────────────────────────────────────────────

  describe("refusals", () => {
    test("refuses an unregistered key", () => {
      expect(() => setSetting("rt.doesNotExist", 1, "user")).toThrow(/unknown setting|not.*registry/i);
    });

    test("refuses a repo-only key written with no repo, naming --repo", () => {
      expect(() => setSetting("rt.roles", { backend: {} }, "user")).toThrow(/repo-only.*--repo/);
      expect(existsSync(userSettingsPath())).toBe(false);
    });

    test("refuses a repo-only key written with an empty repo identity", () => {
      expect(() => setSetting("rt.roles", { backend: {} }, "user", { repoIdentity: "" })).toThrow(/repo-only/);
      expect(existsSync(userSettingsPath())).toBe(false);
    });

    test("unset of a repo-only key with no repo still removes a stray global value", () => {
      write(userSettingsPath(), `{ "rt.roles": { "backend": {} } }\n`);
      expect(unsetSetting("rt.roles", "user")).toBe(true);
      expect(JSON.parse(readUser())).toEqual({});
    });

    test("refuses a scope the def does not allow", () => {
      expect(() => setSetting("rt.repoIdentityOverrides", {}, "user")).toThrow(/scope|store/i);
    });

    test("refuses a path-literal in a pathGuardFields field at user scope", () => {
      expect(() =>
        setSetting("rt.roles", { backend: { hook: "/Users/matt/bin/dev.sh" } }, "user", {
          repoIdentity: IDENTITY,
        }),
      ).toThrow(/path literal|\$\{team|\$\{repoRoot/i);
    });

    test("only a path-guard refusal suggests ${team:<name>} or ${repoRoot}", () => {
      expect(() =>
        setSetting("rt.roles", { backend: { hook: "/Users/matt/bin/dev.sh" } }, "user", { repoIdentity: IDENTITY }),
      ).toThrow("use ${team:<name>} or ${repoRoot} instead");
      let typeMessage = "";
      try {
        setSetting("rt.homeSnapshot", "nope", "machine");
      } catch (err) {
        typeMessage = (err as Error).message;
      }
      expect(typeMessage).toContain("expected object, got string");
      expect(typeMessage).not.toContain("${team");
    });

    test("refuses a home-relative path literal in a pathGuardFields field", () => {
      expect(() =>
        setSetting("rt.roles", { backend: { hook: "~/bin/dev.sh" } }, "user", { repoIdentity: IDENTITY }),
      ).toThrow(/path literal/i);
    });

    test("refuses a path-literal hook at org scope too", () => {
      seedShared(ORG);
      expect(() =>
        setSetting("rt.roles", { backend: { hook: "/opt/dev.sh" } }, "org", { repoIdentity: IDENTITY }),
      ).toThrow(/path literal/i);
    });

    test("machine scope is exempt from the path-literal guard", () => {
      expect(() =>
        setSetting("rt.roles", { backend: { hook: "/opt/dev.sh" } }, "machine", { repoIdentity: IDENTITY }),
      ).not.toThrow();

      const parsed = JSON.parse(readMachine().replace(/^\/\/.*\n/, ""));
      expect(parsed.repos[IDENTITY]["rt.roles"]).toEqual({ backend: { hook: "/opt/dev.sh" } });
    });

  });

  // ─── org and team stores ────────────────────────────────────────────────────

  describe("org and team stores", () => {
    const roster = [{ username: "dev1", teams: ["widgets"] }];

    test("scope org writes the org store and keeps its comments", () => {
      seedOrg({ org: "acme", username: "dev1", roster });
      const file = orgSettingsPath("acme");
      writeFileSync(file, `// org settings\n${readFileSync(file, "utf8")}`);
      setSetting("board.gitlabHost", "gitlab.example.com", "org");
      expect(readFileSync(file, "utf8")).toStartWith("// org settings\n");
      expect(getSetting<string>("board.gitlabHost").provenance).toEqual([{ scope: "org", file }]);
    });

    test("scope team writes the active team's store", () => {
      seedOrg({ org: "acme", username: "dev1", roster, teams: { widgets: {}, gadgets: {} } });
      setSetting("board.title", "Widgets", "team");
      expect(readStore(teamSettingsPath("acme", "widgets")).global["board.title"]).toBe("Widgets");
      expect(readStore(teamSettingsPath("acme", "gadgets")).global["board.title"]).toBeUndefined();
    });

    test("opts.team names another team folder", () => {
      seedOrg({ org: "acme", username: "dev1", roster, teams: { widgets: {}, gadgets: {} } });
      setSetting("board.title", "Gadgets", "team", { team: "gadgets" });
      expect(readStore(teamSettingsPath("acme", "gadgets")).global["board.title"]).toBe("Gadgets");
    });

    test("a team write with no active team and no name refuses", () => {
      seedOrg({ org: "acme", username: "stranger", roster, teams: { widgets: {} } });
      expect(() => setSetting("board.title", "x", "team")).toThrow(/no active team/);
    });

    test("a team name that is not a folder name refuses before touching disk", () => {
      seedOrg({ org: "acme", username: "dev1", roster, teams: { widgets: {} } });
      expect(() => setSetting("board.title", "x", "team", { team: "../x" })).toThrow(/not a team name/);
    });

    test("a team whose settings file is missing refuses and names the file", () => {
      seedOrg({ org: "acme", username: "dev1", roster: [{ username: "dev1", teams: ["sprockets"] }] });
      expect(() => setSetting("board.title", "x", "team")).toThrow(teamSettingsPath("acme", "sprockets"));
      expect(existsSync(teamSettingsPath("acme", "sprockets"))).toBe(false);
    });

    test("an org write on a Mac with no org refuses", () => {
      expect(() => setSetting("board.gitlabHost", "gitlab.example.com", "org")).toThrow(/no org/);
    });

    test("an org-only key refuses at team scope", () => {
      seedOrg({ org: "acme", username: "dev1", roster, teams: { widgets: {} } });
      expect(() => setSetting("mattstack.roster", [], "team")).toThrow(/cannot be set in the team store/);
    });

    test("unset on a Mac with no org, or with no active team, is a clean no-op", () => {
      expect(unsetSetting("board.title", "org")).toBe(false);
      seedOrg({ org: "acme", username: "stranger", roster, teams: { widgets: {} } });
      expect(unsetSetting("board.title", "team")).toBe(false);
    });
  });

  // ─── share tips ─────────────────────────────────────────────────────────────

  describe("share tips", () => {
    function captureStderr(run: () => void): string[] {
      const lines: string[] = [];
      const orig = console.error;
      console.error = (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      };
      try {
        run();
      } finally {
        console.error = orig;
      }
      return lines;
    }

    function giveOrigin(repo: string): void {
      mkdirSync(join(repo, ".git"), { recursive: true });
      writeFileSync(join(repo, ".git", "config"), `[core]\n\tbare = false\n[remote "origin"]\n\turl = https://example.com/acme/repo.git\n`);
    }
    const homeRepo = () => dirname(userSettingsPath());
    const orgRepo = () => orgDir(ORG);

    test("a user write the daemon will sync prints nothing", () => {
      giveOrigin(homeRepo());
      expect(captureStderr(() => setSetting("rt.worktrees", { onDeck: 3 }, "user", { repoIdentity: IDENTITY }))).toEqual([]);
    });

    test("a user write with no home remote says it stays on this machine", () => {
      expect(captureStderr(() => setSetting("rt.worktrees", { onDeck: 3 }, "user", { repoIdentity: IDENTITY }))).toEqual([
        `Saved rt.worktrees on this Mac only. Your home repo has no remote yet, so it will not reach your other Macs. Run: rt home remote set`,
      ]);
    });

    test("an origin section with no url counts as no remote", () => {
      mkdirSync(join(homeRepo(), ".git"), { recursive: true });
      writeFileSync(join(homeRepo(), ".git", "config"), `[remote "origin"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[core]\n\turl = nope\n`);
      expect(captureStderr(() => setSetting("rt.worktrees", { onDeck: 3 }, "user", { repoIdentity: IDENTITY }))).toHaveLength(1);
    });

    test("a .git file is followed to its gitdir, including a linked worktree's commondir", () => {
      const main = join(dirname(homeRepo()), "home-main");
      mkdirSync(join(main, ".git"), { recursive: true });
      writeFileSync(join(main, ".git", "config"), "[core]\n\tbare = false\n");
      const linked = join(main, ".git", "worktrees", "user");
      mkdirSync(linked, { recursive: true });
      writeFileSync(join(linked, "commondir"), "../..\n");
      mkdirSync(homeRepo(), { recursive: true });
      writeFileSync(join(homeRepo(), ".git"), `gitdir: ${linked}\n`);
      expect(captureStderr(() => setSetting("rt.worktrees", { onDeck: 3 }, "user", { repoIdentity: IDENTITY }))).toHaveLength(1);
      giveOrigin(main);
      expect(captureStderr(() => setSetting("rt.worktrees", { onDeck: 4 }, "user", { repoIdentity: IDENTITY }))).toEqual([]);
    });

    test("a .git file it cannot follow prints no tip", () => {
      mkdirSync(homeRepo(), { recursive: true });
      writeFileSync(join(homeRepo(), ".git"), "gitdir: ../nowhere\n");
      expect(captureStderr(() => setSetting("rt.worktrees", { onDeck: 3 }, "user", { repoIdentity: IDENTITY }))).toEqual([]);
    });

    test("a user write with home sync off says to commit and push", () => {
      giveOrigin(homeRepo());
      setSetting("rt.homeSnapshot", { enabled: false }, "machine");
      expect(captureStderr(() => setSetting("rt.worktrees", { onDeck: 3 }, "user", { repoIdentity: IDENTITY }))).toEqual([
        `Saved rt.worktrees in your user settings, but automatic home sync is off. Commit and push your home repo to share it with your other Macs.`,
      ]);
    });

    test("an org write the daemon will publish prints nothing", () => {
      seedShared(ORG);
      giveOrigin(orgRepo());
      expect(captureStderr(() => setSetting("rt.roles", { backend: {} }, "org", { repoIdentity: IDENTITY }))).toEqual([]);
    });

    test("an org write with no org remote points at rt team publish --remote", () => {
      seedShared(ORG);
      expect(captureStderr(() => setSetting("rt.roles", { backend: {} }, "org", { repoIdentity: IDENTITY }))).toEqual([
        `Saved rt.roles in the ${ORG} org's settings on this Mac only. The org repo has no remote yet. Run: rt team publish --remote <url>`,
      ]);
    });

    test("a team write names the team folder it landed in", () => {
      seedOrg({ org: ORG, username: "dev1", roster: [{ username: "dev1", teams: ["widgets"] }], teams: { widgets: {} } });
      expect(captureStderr(() => setSetting("board.title", "Widgets", "team"))).toEqual([
        `Saved board.title in the widgets team's settings on this Mac only. The org repo has no remote yet. Run: rt team publish --remote <url>`,
      ]);
    });

    test("an org write with team sync off points at rt team publish", () => {
      seedShared(ORG);
      giveOrigin(orgRepo());
      setSetting("rt.teamSnapshot", { enabled: false }, "machine");
      expect(captureStderr(() => setSetting("rt.roles", { backend: {} }, "org", { repoIdentity: IDENTITY }))).toEqual([
        `Saved rt.roles in the ${ORG} org's settings, but automatic team sync is off. Run: rt team publish`,
      ]);
    });

    test("a notice sink receives the sentence and the command apart, and the previous sink comes back on restore", () => {
      const seen: { line: string; notice: SettingsNotice | undefined }[] = [];
      const previous = setSettingsNoticeSink((line, notice) => seen.push({ line, notice }));
      let stderr: string[];
      try {
        stderr = captureStderr(() => setSetting("rt.worktrees", { onDeck: 3 }, "user", { repoIdentity: IDENTITY }));
      } finally {
        setSettingsNoticeSink(previous);
      }
      expect(stderr).toEqual([]);
      expect(seen).toEqual([
        {
          line: "Saved rt.worktrees on this Mac only. Your home repo has no remote yet, so it will not reach your other Macs. Run: rt home remote set",
          notice: { text: "Saved rt.worktrees on this Mac only. Your home repo has no remote yet, so it will not reach your other Macs.", next: "rt home remote set" },
        },
      ]);
      expect(captureStderr(() => setSetting("rt.worktrees", { onDeck: 4 }, "user", { repoIdentity: IDENTITY }))).toHaveLength(1);
    });

    test("a machine-scope write prints nothing", () => {
      const lines = captureStderr(() => setSetting("rt.worktrees", { onDeck: 3 }, "machine", { repoIdentity: IDENTITY }));
      expect(lines).toEqual([]);
      expect(existsSync(machineSettingsPath())).toBe(true);
    });

    test("removals follow the same rules", () => {
      seedShared(ORG);
      setSetting("rt.roles", { backend: {} }, "org", { repoIdentity: IDENTITY });
      setSetting("rt.roles", { backend: {} }, "user", { repoIdentity: IDENTITY });
      setSetting("rt.roles", { backend: {} }, "machine", { repoIdentity: IDENTITY });

      expect(captureStderr(() => unsetSetting("rt.roles", "org", { repoIdentity: IDENTITY }))).toEqual([
        `Removed rt.roles from the ${ORG} org's settings on this Mac only. The org repo has no remote yet. Run: rt team publish --remote <url>`,
      ]);
      expect(captureStderr(() => unsetSetting("rt.roles", "user", { repoIdentity: IDENTITY }))).toEqual([
        `Removed rt.roles on this Mac only. Your home repo has no remote yet, so the change will not reach your other Macs. Run: rt home remote set`,
      ]);
      expect(captureStderr(() => unsetSetting("rt.roles", "machine", { repoIdentity: IDENTITY }))).toEqual([]);

      giveOrigin(homeRepo());
      setSetting("rt.roles", { backend: {} }, "user", { repoIdentity: IDENTITY });
      expect(captureStderr(() => unsetSetting("rt.roles", "user", { repoIdentity: IDENTITY }))).toEqual([]);
    });
  });

  // ─── malformed stores refuse rather than edit around the damage ───────────

  describe("malformed store refusal", () => {
    test("refuses a duplicate top-level key, leaving the file byte-identical", () => {
      // modify() edits the FIRST occurrence by offset; every reader (parse,
      // JSON.parse) takes the LAST — so silently "fixing" this would report
      // success while the effective value never changes. Must refuse instead.
      const before = `{\n  "rt.worktrees": { "onDeck": 1 },\n  "rt.worktrees": { "onDeck": 2 }\n}\n`;
      write(userSettingsPath(), before);

      expect(() => setSetting("rt.worktrees", { onDeck: 9 }, "user")).toThrow(
        /malformed|syntax error/i,
      );
      expect(readUser()).toBe(before);
    });

    test("refuses a duplicate key nested inside the repos section", () => {
      const before = `{\n  "repos": {\n    "${IDENTITY}": { "rt.roles": {}, "rt.roles": {} }\n  }\n}\n`;
      write(userSettingsPath(), before);

      expect(() =>
        setSetting("rt.worktrees", { onDeck: 9 }, "user"),
      ).toThrow(/malformed|syntax error/i);
      expect(readUser()).toBe(before);
    });

    test("refuses a stray-brace syntax error, leaving the file byte-identical", () => {
      const before = `{ "rt.worktrees": { "onDeck": 1 } } }\n`;
      write(userSettingsPath(), before);

      expect(() => setSetting("rt.worktrees", { onDeck: 9 }, "user")).toThrow(
        /malformed|syntax error/i,
      );
      expect(readUser()).toBe(before);
    });

    test("refuses an unterminated document, leaving the file byte-identical", () => {
      const before = `{ "rt.worktrees": { "onDeck": 1 }\n`;
      write(userSettingsPath(), before);

      expect(() => setSetting("rt.worktrees", { onDeck: 9 }, "user")).toThrow(
        /malformed|syntax error/i,
      );
      expect(readUser()).toBe(before);
    });

    test("refuses a store whose root is not an object", () => {
      const before = `[1, 2, 3]\n`;
      write(userSettingsPath(), before);

      expect(() => setSetting("rt.worktrees", { onDeck: 9 }, "user")).toThrow(
        /malformed|syntax error/i,
      );
      expect(readUser()).toBe(before);
    });

    test("a malformed store leaves no .tmp remnant behind", () => {
      const before = `{ "a": 1 } }\n`;
      write(userSettingsPath(), before);

      expect(() => setSetting("rt.worktrees", { onDeck: 9 }, "user")).toThrow();

      const entries = readdirSync(dirname(userSettingsPath()));
      expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false);
    });
  });

  // ─── atomic write hygiene ───────────────────────────────────────────────────

  describe("atomic write", () => {
    test("leaves no .tmp remnant after a successful write", () => {
      setSetting("rt.worktrees", { onDeck: 3 }, "user");

      const entries = readdirSync(dirname(userSettingsPath()));
      expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false);
      expect(entries).toContain("settings.user.jsonc");
    });

    test("a successful write's content matches what modify/applyEdits produced (no JSON.stringify round-trip)", () => {
      write(userSettingsPath(), `// keep this comment\n{\n  // and this one\n  "rt.cron": true,\n}\n`);

      setSetting("rt.worktrees", { onDeck: 3 }, "user");

      const content = readUser();
      expect(content).toContain("// keep this comment");
      expect(content).toContain("// and this one");
    });
  });

  // ─── schema gate ────────────────────────────────────────────────────────────

  describe("schema gate", () => {
    test("a value failing the schema is refused with its path", () => {
      withSchema("rt.repoRoots", { type: "array", items: { type: "string" } }, () => {
        expect(() => setSetting("rt.repoRoots", [1], "machine")).toThrow(/\[0\]: expected string/);
      });
    });
  });

  // ─── sanity: teamsDir is honored ────────────────────────────────────────────

  test("uses the HOME-relative teamsDir for team store discovery", () => {
    expect(teamsDir()).toContain(home);
  });
});

// ─── refusing writes on a joined (pull-only) clone ─────────────────────────

describe("settings/write: joined-team guard", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-joined-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  const roster = [{ username: "dev1", teams: ["widgets"] }];

  function seedClone(record?: Record<string, unknown>): void {
    seedOrg({ org: "acme", roster, teams: { widgets: {} } });
    const recordPath = teamLocalPath("acme");
    mkdirSync(dirname(recordPath), { recursive: true });
    writeFileSync(recordPath, JSON.stringify({ forgeUsername: "dev1", ...record }));
  }

  test("set refuses an org write and a team write on a joined clone", () => {
    seedClone({ joinedByRt: true });
    expect(() => setSetting("board.gitlabHost", "gitlab.example.com", "org")).toThrow(/pull-only/);
    expect(() => setSetting("board.title", "x", "team")).toThrow(/pull-only/);
    expect(() => setSetting("board.title", "x", "team", { team: "widgets" })).toThrow(/pull-only/);
  });

  test("unset refuses on a joined clone too", () => {
    seedClone({ joinedByRt: true });
    expect(() => unsetSetting("board.title", "org")).toThrow(/pull-only/);
    expect(() => unsetSetting("board.title", "team")).toThrow(/pull-only/);
  });

  test("an owner clone is unaffected", () => {
    seedClone({ createdByRt: true, joinedByRt: false });
    expect(() => setSetting("board.title", "x", "team")).not.toThrow();
    expect(() => setSetting("board.title", "x", "org")).not.toThrow();
  });

  test("a clone with no joined flag is unaffected", () => {
    seedClone();
    expect(() => setSetting("board.title", "x", "team")).not.toThrow();
  });

  // NOT board.title: its scopes have no user rung, so a user-scope write throws a
  // scope refusal before the guard is ever reached. claude.plugins allows user.
  test("user and machine scope are never gated by the clone record", () => {
    seedClone({ joinedByRt: true });
    expect(() => setSetting("claude.plugins", [], "user", {})).not.toThrow();
  });

  test("the refusal says who can make the change", () => {
    seedClone({ joinedByRt: true });
    expect(() => setSetting("board.title", "x", "org")).toThrow(/Ask an org admin/);
  });
});

describe("settings/unset", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-unset-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function seedUser(content: string): void {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), content);
  }

  test("removes a present key, preserving comments, and returns true", () => {
    seedUser(`// my settings\n{\n  // keep me\n  "rt.worktrees": { "onDeck": 2 },\n  "rt.roles": { "web": { "ports": [3000] } }\n}\n`);
    expect(unsetSetting("rt.worktrees", "user")).toBe(true);
    const after = readFileSync(userSettingsPath(), "utf8");
    expect(after).not.toContain("rt.worktrees");
    expect(after).toContain("// my settings");
    expect(after).toContain("rt.roles");
  });

  test("a key not present in the store is a no-op returning false, file untouched", () => {
    const content = `// untouched\n{\n  "rt.roles": {}\n}\n`;
    seedUser(content);
    expect(unsetSetting("rt.worktrees", "user")).toBe(false);
    expect(readFileSync(userSettingsPath(), "utf8")).toBe(content);
  });

  test("a store file that does not exist is a no-op returning false", () => {
    expect(unsetSetting("rt.worktrees", "user")).toBe(false);
    expect(() => readFileSync(userSettingsPath(), "utf8")).toThrow();
  });

  test("removes a repoScoped key from its repos.<identity> section only", () => {
    seedUser(`{\n  "repos": {\n    "${IDENTITY}": { "rt.worktrees": { "onDeck": 1 }, "rt.roles": {} }\n  }\n}\n`);
    expect(unsetSetting("rt.worktrees", "user", { repoIdentity: IDENTITY })).toBe(true);
    const after = readFileSync(userSettingsPath(), "utf8");
    expect(after).not.toContain("rt.worktrees");
    expect(after).toContain("rt.roles");
  });

  test("refuses an unknown key", () => {
    expect(() => unsetSetting("rt.doesNotExist", "user")).toThrow(/unknown setting/);
  });

  test("removes a retired key a store still carries, from any scope", () => {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), `{\n  "mattstack.mode": "dev",\n  "mattstack.appPath": "/Applications/mattstack-dev.app"\n}\n`);
    expect(unsetSetting("mattstack.mode", "machine")).toBe(true);
    const after = readFileSync(machineSettingsPath(), "utf8");
    expect(after).not.toContain("mattstack.mode");
    expect(after).toContain("mattstack.appPath");
  });

  test("removes a stored switchboard URL an older rt wrote", () => {
    mkdirSync(dirname(machineSettingsPath()), { recursive: true });
    writeFileSync(machineSettingsPath(), `{\n  "board.switchboardUrl": "https://old.example.app",\n  "mattstack.appPath": "/Applications/mattstack-dev.app"\n}\n`);
    expect(unsetSetting("board.switchboardUrl", "machine")).toBe(true);
    const after = readFileSync(machineSettingsPath(), "utf8");
    expect(after).not.toContain("board.switchboardUrl");
    expect(after).toContain("mattstack.appPath");
  });

  test("refuses a retired key with a repo identity", () => {
    expect(() => unsetSetting("mattstack.mode", "user", { repoIdentity: IDENTITY })).toThrow(/not repo-scoped/);
  });

  test("refuses a scope the def does not allow", () => {
    expect(() => unsetSetting("rt.repoIdentityOverrides", "user")).toThrow(/cannot be unset in the user store/);
  });

  test("refuses repoIdentity on a non-repoScoped key", () => {
    expect(() => unsetSetting("rt.repoIdentityOverrides", "machine", { repoIdentity: IDENTITY })).toThrow(/not repo-scoped/);
  });

  test("explicit team with no local store is a no-op, not a refusal", () => {
    expect(unsetSetting("rt.roles", "team", { team: "ghost" })).toBe(false);
  });

  test("refuses to edit a malformed store", () => {
    seedUser(`{ "rt.roles": 1, "rt.roles": 2 }\n`);
    expect(() => unsetSetting("rt.roles", "user")).toThrow(/malformed store/);
  });
});

// ─── refusing test-run writes into the account's real stores ───────────────

describe("settings/write: test-run guard", () => {
  const origHome = process.env.HOME;
  let home: string;
  let accountHomeSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-guard-")));
    process.env.HOME = home;
  });

  afterEach(() => {
    accountHomeSpy?.mockRestore();
    accountHomeSpy = undefined;
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function actAsAccountHome(dir: string): void {
    accountHomeSpy = spyOn(isolation, "accountHome").mockReturnValue(dir);
  }

  test("refuses a user write when HOME is the account's home, and creates nothing", () => {
    actAsAccountHome(home);
    expect(() => setSetting("rt.apiPort", 50489, "user")).toThrow(/Run bun test from the repo root/);
    expect(existsSync(join(home, ".mattstack"))).toBe(false);
  });

  test("refuses a machine write the same way", () => {
    actAsAccountHome(home);
    expect(() => setSetting("rt.worktrees", { onDeck: 3 }, "machine")).toThrow(/Run bun test from the repo root/);
    expect(existsSync(join(home, ".mattstack"))).toBe(false);
  });

  test("refuses an org write and leaves the org store untouched", () => {
    const store = sharedStorePath(ORG);
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, "// acme team store\n{}\n");
    actAsAccountHome(home);
    expect(() => setSetting("rt.roles", { reviewer: {} }, "org", { repoIdentity: IDENTITY })).toThrow(/Run bun test from the repo root/);
    expect(readFileSync(store, "utf8")).toBe("// acme team store\n{}\n");
  });

  test("refuses an unset against a real store and leaves it untouched", () => {
    const store = userSettingsPath();
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, `{ "rt.apiPort": 9401 }\n`);
    actAsAccountHome(home);
    expect(() => unsetSetting("rt.apiPort", "user")).toThrow(/Run bun test from the repo root/);
    expect(readFileSync(store, "utf8")).toBe(`{ "rt.apiPort": 9401 }\n`);
  });

  test("writes normally when HOME is a scratch dir apart from the account home", () => {
    const account = realpathSync(mkdtempSync(join(tmpdir(), "rt-settings-account-")));
    try {
      actAsAccountHome(account);
      setSetting("rt.apiPort", 50489, "user");
      expect(readUser()).toContain("50489");
      expect(existsSync(join(account, ".mattstack"))).toBe(false);
    } finally {
      rmSync(account, { recursive: true, force: true });
    }
  });

  test("refuses the write a test makes after deleting HOME, when paths fall back to the frozen startup home", () => {
    const script = join(home, "delete-home-then-write.ts");
    writeFileSync(
      script,
      [
        `import { spyOn } from "bun:test";`,
        `import * as isolation from ${JSON.stringify(join(import.meta.dir, "..", "..", "test-isolation.ts"))};`,
        `import { setSetting } from ${JSON.stringify(join(import.meta.dir, "..", "write.ts"))};`,
        `spyOn(isolation, "accountHome").mockReturnValue(process.env.HOME!);`,
        `delete process.env.HOME;`,
        `try { setSetting("rt.apiPort", 50489, "user"); console.log("WROTE"); } catch (err) { console.log(String(err)); }`,
      ].join("\n"),
    );
    const account = join(home, "account");
    mkdirSync(account);
    const child = spawnSync(process.execPath, [script], {
      cwd: account,
      env: { PATH: process.env.PATH, HOME: account, NODE_ENV: "test" },
      encoding: "utf8",
    });
    expect(child.stdout).toMatch(/Run bun test from the repo root/);
    expect(existsSync(join(account, ".mattstack"))).toBe(false);
  });

  function readUser(): string {
    return readFileSync(userSettingsPath(), "utf8");
  }
});
