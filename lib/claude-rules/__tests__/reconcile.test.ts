import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRealProbes, type Probes } from "../../setup/probes.ts";
import { claudeRulesDir } from "../paths.ts";
import { claudeRulesDetail, reconcileClaudeRules } from "../reconcile.ts";
import { makeOrg, setActiveTeam } from "./org-fixture.ts";

let home: string;
let p: Probes;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "claude-rules-reconcile-")));
  p = { ...createRealProbes(), home, env: { HOME: home } };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function marketplace(configDir = join(home, ".claude")): string {
  const loc = join(home, ".claude", "plugins", "marketplaces", "mattstack");
  mkdirSync(join(loc, "plugins", "mattstack", "rules"), { recursive: true });
  writeFileSync(join(loc, "plugins", "mattstack", "rules", "chat.md"), "# Chat rule\n");
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  writeFileSync(join(configDir, "plugins", "known_marketplaces.json"), JSON.stringify({ mattstack: { installLocation: loc } }));
  return loc;
}

function freshMac(): void {
  marketplace();
  makeOrg(home);
  rmSync(join(home, ".mattstack", "orgs", "acme", "mattstack", "org", "packs"), { recursive: true, force: true });
}

describe("reconcileClaudeRules", () => {
  test("a fresh Mac gets mattstack's rules, its team pack and one link", async () => {
    freshMac();
    const r = await reconcileClaudeRules(p);
    expect(r).toEqual({
      mattstack: "linked",
      packs: [{ entry: "acme-widgets", state: "written" }],
      links: [{ configDir: join(home, ".claude"), state: "created" }],
    });
    const viaLink = join(home, ".claude", "rules", "mattstack");
    expect(readFileSync(join(viaLink, "acme-widgets", "widgets.md"), "utf8")).toBe("# Widgets rule\n");
    expect(readFileSync(join(viaLink, "mattstack", "chat.md"), "utf8")).toBe("# Chat rule\n");
    expect(claudeRulesDetail(r)).toBe("Linked mattstack's rules and 1 pack into 1 Claude folder");
  });

  test("a second run changes nothing", async () => {
    freshMac();
    await reconcileClaudeRules(p);
    const before = lstatSync(join(claudeRulesDir(home), "acme-widgets")).ino;
    expect(await reconcileClaudeRules(p)).toEqual({
      mattstack: "ok",
      packs: [{ entry: "acme-widgets", state: "ok" }],
      links: [{ configDir: join(home, ".claude"), state: "ok" }],
    });
    expect(lstatSync(join(claudeRulesDir(home), "acme-widgets")).ino).toBe(before);
  });

  test("base packs count alongside the team pack", async () => {
    marketplace();
    makeOrg(home);
    const r = await reconcileClaudeRules(p);
    expect(r.packs).toEqual([
      { entry: "acme-base", state: "written" },
      { entry: "acme-widgets", state: "written" },
    ]);
  });

  test("a team switch removes the old team's entry and writes the new one", async () => {
    freshMac();
    await reconcileClaudeRules(p);
    setActiveTeam(home, "gadgets");
    const r = await reconcileClaudeRules(p);
    expect(r.packs).toEqual([
      { entry: "acme-gadgets", state: "written" },
      { entry: "acme-widgets", state: "removed" },
    ]);
    expect(existsSync(join(claudeRulesDir(home), "acme-widgets"))).toBe(false);
    expect(existsSync(join(claudeRulesDir(home), "mattstack", "chat.md"))).toBe(true);
  });

  test("no marketplace skips only mattstack's rules", async () => {
    makeOrg(home);
    const r = await reconcileClaudeRules(p);
    expect("skipped" in (r.mattstack as object)).toBe(true);
    expect(r.packs.map((x) => x.state)).toEqual(["written", "written"]);
    expect(r.links).toEqual([{ configDir: join(home, ".claude"), state: "created" }]);
    expect(claudeRulesDetail(r)).toContain("left out mattstack's rules");
  });

  test("a marketplace that goes away takes its stale link with it", async () => {
    freshMac();
    await reconcileClaudeRules(p);
    rmSync(join(home, ".claude", "plugins", "known_marketplaces.json"));
    await reconcileClaudeRules(p);
    expect(existsSync(join(claudeRulesDir(home), "mattstack"))).toBe(false);
  });

  test("CLAUDE_CONFIG_DIR is where the link goes", async () => {
    const other = join(home, "other-claude");
    marketplace(other);
    p = { ...p, env: { HOME: home, CLAUDE_CONFIG_DIR: other } };
    const r = await reconcileClaudeRules(p);
    expect(r.mattstack).toBe("linked");
    expect(r.links).toEqual([{ configDir: other, state: "created" }]);
  });

  test("a cswap account folder gets its own link", async () => {
    freshMac();
    const acct = join(home, ".claude-swap-backup", "sessions", "work");
    mkdirSync(acct, { recursive: true });
    const r = await reconcileClaudeRules(p);
    expect(r.links).toEqual([
      { configDir: join(home, ".claude"), state: "created" },
      { configDir: acct, state: "created" },
    ]);
    expect(readlinkSync(join(acct, "rules", "mattstack"))).toBe(claudeRulesDir(home));
  });

  test("a rules/mattstack rt did not make is left alone, and so is every other rule", async () => {
    freshMac();
    const rules = join(home, ".claude", "rules");
    mkdirSync(join(rules, "mattstack"), { recursive: true });
    writeFileSync(join(rules, "mattstack", "own.md"), "mine");
    writeFileSync(join(rules, "personal.md"), "personal");
    const r = await reconcileClaudeRules(p);
    expect(r.links).toEqual([{ configDir: join(home, ".claude"), state: "foreign" }]);
    expect(readFileSync(join(rules, "mattstack", "own.md"), "utf8")).toBe("mine");
    expect(readFileSync(join(rules, "personal.md"), "utf8")).toBe("personal");
    expect(claudeRulesDetail(r)).toContain("rt did not make");
  });

  test("an entry rt no longer writes is removed, even a stray link", async () => {
    freshMac();
    mkdirSync(claudeRulesDir(home), { recursive: true });
    symlinkSync(join(home, "nowhere"), join(claudeRulesDir(home), "acme-old"));
    const r = await reconcileClaudeRules(p);
    expect(r.packs).toContainEqual({ entry: "acme-old", state: "removed" });
    expect(existsSync(join(claudeRulesDir(home), "acme-old"))).toBe(false);
  });
});
