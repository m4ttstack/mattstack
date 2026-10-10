import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { linkBundledSkills } from "../skills-link-bundled.ts";

let root: string;
let skillsRoot: string;
let claudeDir: string;

/** A bundled app's skills dir: `<skillsRoot>/<app>/<dir>/SKILL.md`. */
function bundleSkill(app: string, dir: string, name: string): void {
  const d = join(skillsRoot, app, dir);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "SKILL.md"), `---\nname: ${name}\ndescription: test\n---\n\nBody.\n`);
}

const all = () => true;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rt-bundled-skills-"));
  skillsRoot = join(root, "Helpers", "skills");
  claudeDir = join(root, "home", ".claude", "skills");
  mkdirSync(skillsRoot, { recursive: true });
});

describe("linkBundledSkills", () => {
  test("links every bundled app's skills under its own namespace", () => {
    bundleSkill("gitq", "track", "gitq:track");
    bundleSkill("deck", "add-app", "deck:add-app");

    const result = linkBundledSkills({ skillsRoot, hostSkillsDir: claudeDir, isBundled: all });

    expect(result.map((r) => r.app).sort()).toEqual(["deck", "gitq"]);
    expect(existsSync(join(claudeDir, "gitq:track"))).toBe(true);
    expect(existsSync(join(claudeDir, "deck:add-app"))).toBe(true);
  });

  test("skips an app whose binary is not bundled", () => {
    bundleSkill("gitq", "track", "gitq:track");
    bundleSkill("chat", "talk", "chat:talk");

    const result = linkBundledSkills({
      skillsRoot,
      hostSkillsDir: claudeDir,
      isBundled: (app) => app !== "chat",
    });

    expect(result.find((r) => r.app === "chat")?.skipped).toBe("not bundled");
    expect(existsSync(join(claudeDir, "chat:talk"))).toBe(false);
    expect(existsSync(join(claudeDir, "gitq:track"))).toBe(true);
  });

  test("never links a withheld app, and says why", () => {
    bundleSkill("gitq", "track", "gitq:track");
    bundleSkill("board", "review", "board:review");

    const result = linkBundledSkills({ skillsRoot, hostSkillsDir: claudeDir, isBundled: all, withheld: new Set(["gitq"]) });

    expect(result.find((r) => r.app === "gitq")).toEqual({ app: "gitq", linked: 0, changed: false, skipped: "its skills do not run under this agent yet" });
    expect(existsSync(join(claudeDir, "gitq:track"))).toBe(false);
    expect(existsSync(join(claudeDir, "board:review"))).toBe(true);
  });

  test("honors .skillsignore, so maintainer-only skills never link", () => {
    bundleSkill("rt", "rt-chat", "rt:chat");
    bundleSkill("rt", "rt-release", "rt:release");
    writeFileSync(join(skillsRoot, "rt", ".skillsignore"), "# maintainer only\nrt-release\n");

    linkBundledSkills({ skillsRoot, hostSkillsDir: claudeDir, isBundled: all });

    expect(existsSync(join(claudeDir, "rt:chat"))).toBe(true);
    expect(existsSync(join(claudeDir, "rt:release"))).toBe(false);
  });

  test("is idempotent", () => {
    bundleSkill("gitq", "track", "gitq:track");
    linkBundledSkills({ skillsRoot, hostSkillsDir: claudeDir, isBundled: all });
    const second = linkBundledSkills({ skillsRoot, hostSkillsDir: claudeDir, isBundled: all });

    expect(second.find((r) => r.app === "gitq")?.changed).toBe(false);
    expect(existsSync(join(claudeDir, "gitq:track"))).toBe(true);
  });

  test("a dry run reports without linking", () => {
    bundleSkill("gitq", "track", "gitq:track");
    const result = linkBundledSkills({ skillsRoot, hostSkillsDir: claudeDir, isBundled: all, dryRun: true });

    expect(result.find((r) => r.app === "gitq")?.linked).toBe(1);
    expect(existsSync(join(claudeDir, "gitq:track"))).toBe(false);
  });

  test("a non-directory entry beside the app dirs is ignored", () => {
    bundleSkill("gitq", "track", "gitq:track");
    writeFileSync(join(skillsRoot, "README"), "not an app");

    const result = linkBundledSkills({ skillsRoot, hostSkillsDir: claudeDir, isBundled: all });
    expect(result.map((r) => r.app)).toEqual(["gitq"]);
  });

  test("an absent skills root yields no work rather than throwing", () => {
    const result = linkBundledSkills({ skillsRoot: join(root, "nope"), hostSkillsDir: claudeDir, isBundled: all });
    expect(result).toEqual([]);
  });
});
