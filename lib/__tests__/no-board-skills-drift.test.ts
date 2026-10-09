import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { skillsExpand } from "../../commands/skills-expand.ts";
import { TARGET_MARKER } from "../skills/harness-target.ts";
import { captureSkills, runExpectingCleanExit } from "../skills/__tests__/helpers.ts";
import type { CapturedOut } from "../ui/__tests__/capture-out.ts";

const ROOT = join(import.meta.dir, "..", "..");
const SRC = join(ROOT, "apps", "board", "skills-src");
const FIX = "run `bun run skills:expand:board` and commit apps/board/skills and apps/board/skills-targets";

// Each target is named explicitly, so this machine's own harness setting never decides what is checked.
const TARGETS = [
  { harness: "claude", out: join(ROOT, "apps", "board", "skills") },
  { harness: "codex", out: join(ROOT, "apps", "board", "skills-targets", "codex") },
];

// apps/board/skills (Claude) and apps/board/skills-targets/codex are generated from apps/board/skills-src and the mattstack attachments it includes.
describe("board skills are expanded and current", () => {
  let io: CapturedOut;

  beforeEach(() => {
    io = captureSkills();
  });

  afterEach(() => {
    io.restore();
  });

  for (const { harness, out } of TARGETS) {
    test(`skills expand --check --strict is clean for ${harness}`, async () => {
      const run = await runExpectingCleanExit(() =>
        skillsExpand(["--harness", harness, "--src", SRC, "--out", out, "--mattstack-dir", ROOT, "--check", "--strict", "--json"]),
      );
      const envelope = JSON.parse(io.lines().at(-1) ?? "null") as { ok: boolean; drift: unknown[]; lint: string[] } | null;
      expect(envelope, `skills expand printed no envelope\n${run.errors.join("\n")}`).not.toBeNull();
      expect(envelope?.drift, `board ${harness} skills drifted; ${FIX}\n${run.errors.join("\n")}`).toEqual([]);
      expect(envelope?.lint, `board ${harness} skills fail the strict lint; fix apps/board/skills-src, then ${FIX}\n${run.errors.join("\n")}`).toEqual([]);
      expect(envelope?.ok, run.errors.join("\n")).toBe(true);
      expect(run.exitCode, run.errors.join("\n")).toBeUndefined();
    });

    for (const name of ["review", "respond", "doctor"]) {
      test(`${harness} ${name} carries gate-protocol and no path into another artifact`, () => {
        const md = readFileSync(join(out, name, "SKILL.md"), "utf8");
        expect(md).toContain("<!-- part: include:gate-protocol source=mattstack:gate-protocol");
        expect(md).not.toContain("plugins/mattstack");
        expect(md).not.toContain("Documents/GitHub");
        expect(md).toContain("disable-model-invocation: true");
      });
    }
  }

  test("the two targets are distinct roots and only codex carries a marker", () => {
    const [claude, codex] = TARGETS;
    expect(readdirSync(claude!.out)).not.toContain(TARGET_MARKER);
    expect(JSON.parse(readFileSync(join(codex!.out, TARGET_MARKER), "utf8"))).toEqual({ harness: "codex" });
  });

  test("no codex artifact keeps a Claude skill-dir variable", () => {
    const codex = TARGETS[1]!.out;
    for (const name of readdirSync(codex, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
      for (const file of readdirSync(join(codex, name), { recursive: true, withFileTypes: true })) {
        if (!file.isFile() || !file.name.endsWith(".md")) continue;
        expect(readFileSync(join(file.parentPath, file.name), "utf8"), `${name}/${file.name}`).not.toContain("${CLAUDE_");
      }
    }
  });
});
