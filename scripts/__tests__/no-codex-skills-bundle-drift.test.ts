/**
 * The Codex skills a bundle ships travel through three files that never
 * import each other: build-apps stages `<app>-skills-codex`, build.sh lands
 * it at Helpers/skills-targets/codex/<app>, and skills.link reads that folder
 * for a Codex host. A rename in one silently ships Codex no skills.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("Codex skills in the bundle", () => {
  test("build-apps stages the folder build.sh lands where skills.link reads it", () => {
    expect(read("scripts/build-apps.ts")).toContain("`${row.name}-skills-codex`");
    const build = read("rt-tray/build.sh");
    expect(build).toContain('"$DEPS_DIR/$name-skills-codex"');
    expect(build).toContain('skills_dest="$CONTENTS/Helpers/skills-targets/codex/$name"');
    expect(read("lib/setup/steps/skills.ts")).toContain('const CODEX_BUNDLED_SKILLS = ["skills-targets", "codex"];');
  });

  test("the bundle check admits and inspects the folder", () => {
    const check = read("rt-tray/check-bundle.sh");
    expect(check).toMatch(/local allowed="[^"]* skills-targets /);
    expect(check).toContain('"$app/Contents/Helpers/skills-targets/codex"');
  });

  test("the build stamps the commit acceptance records as the artifact", () => {
    expect(read("rt-tray/build.sh")).toContain("plutil -replace MSSourceCommit");
    expect(read("scripts/acceptance/harnesses.ts")).toContain('"MSSourceCommit"');
  });
});
