/**
 * The Codex skills a bundle ships travel through three files that never
 * import each other: build-apps stages `<app>-skills-codex`, build.sh lands
 * it at Helpers/skills-targets/codex/<app>, and skills.link reads that folder
 * for a Codex host. A rename in one silently ships Codex no skills. The real
 * apps tree is also run through build-apps' own source choice and cleanliness
 * check, so a Claude variable creeping into a Codex build fails every PR, not
 * only the release.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { CODEX_WITHHELD_APP_SKILLS } from "../../lib/skills/harness-target.ts";
import { assertCodexClean, CODEX_SKILLS_AS_WRITTEN, codexSkillsSource } from "../build-apps.ts";

const ROOT = join(import.meta.dir, "..", "..");
const APPS = join(ROOT, "apps");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Codex skills in the bundle", () => {
  test("build-apps stages the folder build.sh lands where skills.link reads it", () => {
    expect(read("scripts/build-apps.ts")).toContain("`${row.name}-skills-codex`");
    const build = read("rt-tray/build.sh");
    expect(build).toContain('"$DEPS_DIR/$name-skills-codex"');
    expect(build).toContain('skills_dest="$CONTENTS/Helpers/skills-targets/codex/$name"');
    expect(read("lib/setup/steps/skills.ts")).toContain('const CODEX_BUNDLED_SKILLS = ["skills-targets", "codex"];');
  });

  test("the bundle check admits the folder, requires board's build and refuses a withheld app's", () => {
    const check = read("rt-tray/check-bundle.sh");
    expect(check).toMatch(/local allowed="[^"]* skills-targets /);
    expect(check).toContain('"$app/Contents/Helpers/skills-targets/codex"');
    expect(check).toContain("for codexapp in board; do");
    expect(check).toContain(`for heldapp in ${[...CODEX_WITHHELD_APP_SKILLS].sort().join(" ")}; do`);
  });

  test("gitq's skills are withheld from Codex until they carry the questions fragment", () => {
    expect(CODEX_WITHHELD_APP_SKILLS.has("gitq")).toBe(true);
    expect(CODEX_SKILLS_AS_WRITTEN.has("gitq")).toBe(false);
    expect(codexSkillsSource(join(APPS, "gitq"), "gitq")).toBeNull();
    expect(read("lib/setup/steps/skills.ts")).toContain("withheld: CODEX_WITHHELD_APP_SKILLS");
  });

  test("the build stamps the commit acceptance records, marked when the tree is dirty", () => {
    const build = read("rt-tray/build.sh");
    expect(build).toContain("plutil -replace MSSourceCommit");
    expect(build).toContain('SOURCE_COMMIT="$SOURCE_COMMIT-dirty"');
    expect(read("scripts/acceptance/harnesses.ts")).toContain('"MSSourceCommit"');
  });

  test("every app's Codex build in this repo is the one build-apps picks, and ships clean", () => {
    const built: string[] = [];
    for (const name of readdirSync(APPS)) {
      const app = join(APPS, name);
      if (!existsSync(join(app, "skills"))) continue;
      const source = codexSkillsSource(app, name);
      if (source === null) continue;
      expect(() => assertCodexClean(source, name)).not.toThrow();
      built.push(name);
    }
    expect(built.sort()).toEqual(["board"]);
    expect(codexSkillsSource(join(APPS, "board"), "board")).toBe(join(APPS, "board", "skills-targets", "codex"));
    expect(CODEX_SKILLS_AS_WRITTEN.has("deck")).toBe(false);
  });
});
