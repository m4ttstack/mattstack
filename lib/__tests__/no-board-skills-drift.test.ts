import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { skillsExpand } from "../../commands/skills-expand.ts";
import { captureSkills, runExpectingCleanExit } from "../skills/__tests__/helpers.ts";
import type { CapturedOut } from "../ui/__tests__/capture-out.ts";

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(ROOT, "apps", "board", "skills-src");
const OUT = join(ROOT, "apps", "board", "skills");
const FIX = "run `bun run skills:expand:board` and commit apps/board/skills";

// apps/board/skills is generated from apps/board/skills-src and the mattstack attachments it includes.
describe("board skills are expanded and current", () => {
  let io: CapturedOut;

  beforeEach(() => {
    io = captureSkills();
  });

  afterEach(() => {
    io.restore();
  });

  test("skills expand --check --strict is clean", async () => {
    const run = await runExpectingCleanExit(() =>
      skillsExpand(["--src", SRC, "--out", OUT, "--mattstack-dir", ROOT, "--check", "--strict", "--json"]),
    );
    const envelope = JSON.parse(io.lines().at(-1) ?? "null") as { ok: boolean; drift: unknown[]; lint: string[] } | null;
    expect(envelope, `skills expand printed no envelope\n${run.errors.join("\n")}`).not.toBeNull();
    expect(envelope?.drift, `board skills drifted; ${FIX}\n${run.errors.join("\n")}`).toEqual([]);
    expect(envelope?.lint, `board skills fail the strict lint; fix apps/board/skills-src, then ${FIX}\n${run.errors.join("\n")}`).toEqual([]);
    expect(envelope?.ok, run.errors.join("\n")).toBe(true);
    expect(run.exitCode, run.errors.join("\n")).toBeUndefined();
  });

  for (const name of ["review", "respond", "doctor"]) {
    test(`${name} carries gate-protocol and no path into another artifact`, () => {
      const md = readFileSync(join(OUT, name, "SKILL.md"), "utf8");
      expect(md).toContain("<!-- part: include:gate-protocol source=mattstack:gate-protocol");
      expect(md).not.toContain("plugins/mattstack");
      expect(md).not.toContain("Documents/GitHub");
      expect(md).toContain("disable-model-invocation: true");
    });
  }
});
