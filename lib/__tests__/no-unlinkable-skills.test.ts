/**
 * The installer links rt's bundled skills by their SKILL.md frontmatter name,
 * and a header it cannot read is skipped without failing the install, so a
 * YAML slip silently drops a skill from every user's Mac. Named no-* so it
 * runs on every PR.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { reconcileSkillLinks } from "../skills/link.ts";

const SKILLS = resolve(import.meta.dir, "..", "..", "skills");

test("every skill under skills/ has a header the linker can read", () => {
  const claudeSkillsDir = mkdtempSync(join(tmpdir(), "rt-skill-links-"));
  try {
    const { actions } = reconcileSkillLinks({ skillsDir: SKILLS, claudeSkillsDir, dryRun: true });
    const skipped = actions.filter((a) => a.kind === "skip").map((a) => `${a.name}: ${a.detail}`);
    expect(skipped).toEqual([]);
  } finally {
    rmSync(claudeSkillsDir, { recursive: true, force: true });
  }
});
