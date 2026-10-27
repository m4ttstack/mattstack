import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { captureSkills } from "../../lib/skills/__tests__/helpers.ts";
import { checkBlocks, checkPack, handSkillFailures, skillsCheck } from "../skills.ts";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  process.exitCode = 0;
});

function makePack(body: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-skills-check-paths-")));
  made.push(dir);
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "acme", version: "1.0.0", skills: ["./plugin/skills"] }));
  mkdirSync(join(dir, "plugin", "skills", "gadgets"), { recursive: true });
  writeFileSync(join(dir, "plugin", "skills", "gadgets", "SKILL.md"), `---\nname: gadgets\n---\n${body}\n`);
  mkdirSync(join(dir, "attachments", "widgets"), { recursive: true });
  writeFileSync(join(dir, "attachments", "widgets", "reference.md"), "ref\n");
  return dir;
}

test("a hand-authored skill's cross-skill path to a missing file fails the check, at its line", async () => {
  const dir = makePack("Read `${CLAUDE_SKILL_DIR}/../../../attachments/widgets/gone.md` first.");
  const payload = await checkPack({ packDir: dir });
  expect(payload.drift).toBe(false);
  expect(handSkillFailures(payload).map((d) => d.code)).toEqual(["broken-skill-path"]);
  expect(payload.skillPaths).toEqual([
    {
      file: "plugin/skills/gadgets/SKILL.md",
      line: 4,
      col: 7,
      code: "broken-skill-path",
      message: "${CLAUDE_SKILL_DIR}/../../../attachments/widgets/gone.md does not resolve to a file from the skill's folder",
    },
  ]);
  expect(renderPlain(checkBlocks(payload, false))).toContain(
    [
      "standard skills, paths:",
      "  plugin/skills/gadgets/SKILL.md:4:7: ${CLAUDE_SKILL_DIR}/../../../attachments/widgets/gone.md does not resolve to a file from the skill's folder",
      "[failed] skill paths: 1 path points at nothing  fix the path in the skill",
    ].join("\n"),
  );
});

test("a path that resolves, or a doc example holding a placeholder, keeps the check clean", async () => {
  const dir = makePack("Read `${CLAUDE_SKILL_DIR}/../../../attachments/widgets/reference.md`, not `../../attachments/{{team.x}}/SKILL.md`.");
  const payload = await checkPack({ packDir: dir });
  expect(payload.skillPaths).toEqual([]);
  expect(payload.drift).toBe(false);
});

test("a hand-authored skill whose frontmatter is not valid YAML fails the check by name, and its paths are still checked", async () => {
  const dir = makePack("Read `${CLAUDE_SKILL_DIR}/../../../attachments/widgets/gone.md` first.");
  writeFileSync(
    join(dir, "plugin", "skills", "gadgets", "SKILL.md"),
    "---\nname: gadgets\ndescription: Use when: x\n---\nRead `${CLAUDE_SKILL_DIR}/../../../attachments/widgets/gone.md` first.\n",
  );
  const payload = await checkPack({ packDir: dir });
  expect(payload.drift).toBe(false);
  expect(handSkillFailures(payload).map((d) => d.code)).toEqual(["bad-frontmatter", "broken-skill-path"]);
  expect(payload.skillFrontmatter).toEqual([
    {
      file: "plugin/skills/gadgets/SKILL.md",
      line: 3,
      col: 14,
      code: "bad-frontmatter",
      message: "frontmatter is not valid YAML: Nested mappings are not allowed in compact mappings",
    },
  ]);
  expect((payload.skillPaths ?? []).map((d) => `${d.file}:${d.line}:${d.code}`)).toEqual(["plugin/skills/gadgets/SKILL.md:5:broken-skill-path"]);
  expect(renderPlain(checkBlocks(payload, false))).toContain(
    [
      "standard skills, frontmatter:",
      "  plugin/skills/gadgets/SKILL.md:3:14: frontmatter is not valid YAML: Nested mappings are not allowed in compact mappings",
      "[failed] skill frontmatter: 1 file does not parse as YAML  fix the YAML at that line",
    ].join("\n"),
  );
});

test("a hand-authored skill with valid frontmatter reports no frontmatter failure", async () => {
  const payload = await checkPack({ packDir: makePack("Nothing to read.") });
  expect(payload.skillFrontmatter).toEqual([]);
});

for (const [what, skillMd] of [
  ["bad frontmatter", "---\nname: gadgets\ndescription: Use when: x\n---\nNothing to read.\n"],
  ["a broken skill path", "---\nname: gadgets\n---\nRead `${CLAUDE_SKILL_DIR}/../../../attachments/widgets/gone.md` first.\n"],
] as const) {
  test(`rt skills check exits 1 on ${what} alone, with no drift`, async () => {
    const dir = makePack("Nothing to read.");
    writeFileSync(join(dir, "plugin", "skills", "gadgets", "SKILL.md"), skillMd);
    const payload = await checkPack({ packDir: dir });
    expect(payload.drift).toBe(false);
    expect(handSkillFailures(payload)).toHaveLength(1);

    const io = captureSkills();
    try {
      process.exitCode = 0;
      await skillsCheck(["--pack-dir", dir]);
      expect(process.exitCode).toBe(1);
      expect(io.stdout()).toContain("[failed] skill");
    } finally {
      io.restore();
    }
  });
}

test("rt skills check exits 0 on a clean hand-authored skill", async () => {
  const dir = makePack("Nothing to read.");
  const io = captureSkills();
  try {
    process.exitCode = 0;
    await skillsCheck(["--pack-dir", dir]);
    expect(process.exitCode).toBe(0);
  } finally {
    io.restore();
  }
});
