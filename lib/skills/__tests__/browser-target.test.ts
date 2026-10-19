import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { skillsCompile } from "../../../commands/skills.ts";
import { setFieldContractSeverityForTest } from "../field-contract.ts";
import { captureSkills } from "./helpers.ts";

const FIX = join(import.meta.dir, "fixtures", "browser-target");
const REPO_PLUGIN = resolve(import.meta.dir, "..", "..", "..", "plugins", "mattstack");
const VERBS = ["stage-evidence", "stage-ship", "ship"] as const;
const REVIEW_VERBS = ["review", "self-review", "receive-review"] as const;
const INCLUDE_MARKER = "<!-- part: include:browser-evidence";
const PART_MARKER = "<!-- part: ";
const TARGET_HEADING = /^## Browser target$/m;

type Compiled = Record<(typeof VERBS)[number], string> & Partial<Record<(typeof REVIEW_VERBS)[number], string>>;

let root = "";

// The compile runs against this repo's real plugin, so a skill edit shows up
// here; only the pack and the mattstack home dir are scratch.
async function compilePack(name: "opted-in" | "scripts-only", verbs: readonly string[] = VERBS): Promise<{ pack: string; verbs: Compiled }> {
  const pack = join(root, name);
  cpSync(join(FIX, name), pack, { recursive: true });
  const ms = join(root, `${name}-home`);
  mkdirSync(join(ms, "plugins"), { recursive: true });
  symlinkSync(REPO_PLUGIN, join(ms, "plugins", "mattstack"));
  const io = captureSkills();
  try {
    await skillsCompile(["--pack-dir", pack, "--mattstack-dir", ms, "--manifest", join(pack, "pack", "skills.jsonc")]);
  } finally {
    io.restore();
  }
  const read = (verb: string) => {
    const side = existsSync(join(pack, "skills", verb)) ? "skills" : "attachments";
    return readFileSync(join(pack, side, verb, "SKILL.md"), "utf8");
  };
  return { pack, verbs: Object.fromEntries(verbs.map((v) => [v, read(v)])) as Compiled };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// One part runs from its marker to the next marker, or to the end of the text.
function withoutPart(text: string, marker: string): string {
  const start = text.indexOf(marker);
  if (start === -1) throw new Error(`withoutPart: no ${marker} in the compiled text`);
  const next = text.indexOf(PART_MARKER, start + marker.length);
  return text.slice(0, start) + (next === -1 ? "" : text.slice(next));
}

describe("browser target compile", () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "rt-browser-target-"));
    // The fixtures are partial packs: no stage writes evidence-plan, worktree or evidence.
    setFieldContractSeverityForTest("warn");
  });
  afterEach(() => {
    process.exitCode = 0;
  });
  afterAll(() => {
    setFieldContractSeverityForTest(null);
    rmSync(root, { recursive: true, force: true });
  });

  describe("a pack that opts in", () => {
    let compiled: { pack: string; verbs: Compiled };
    beforeAll(async () => {
      compiled = await compilePack("opted-in", [...VERBS, ...REVIEW_VERBS]);
    });

    test("stage-evidence inlines the include once and carries the fill's four-block browser target", () => {
      const body = compiled.verbs["stage-evidence"];
      expect(count(body, INCLUDE_MARKER)).toBe(1);
      expect(count(body, "\n## Browser target\n")).toBe(1);
      for (const block of ["### Reach the view", "### What proves a change", "### Captions", "### Personal data"]) {
        expect(count(body, `\n${block}\n`)).toBe(1);
      }
    });

    test("stage-ship and ship inline the include once and resolve the fill's pointer to an existing file", () => {
      for (const verb of ["stage-ship", "ship"] as const) {
        const body = compiled.verbs[verb];
        expect(count(body, INCLUDE_MARKER)).toBe(1);
        expect(body).not.toContain("{{pack.path");
        const pointer = body.match(/browser target section of `([^`]+)`/);
        expect(pointer).not.toBeNull();
        const target = pointer![1]!.replace("${CLAUDE_SKILL_DIR}", join(compiled.pack, "attachments", verb));
        expect(target).toContain("/attachments/acme-evidence/SKILL.md");
        expect(existsSync(resolve(target))).toBe(true);
      }
    });

    test("review and self-review inline the include once and resolve the criteria's pointer to the evidence fill", () => {
      for (const verb of ["review", "self-review"] as const) {
        const body = compiled.verbs[verb]!;
        expect(count(body, INCLUDE_MARKER)).toBe(1);
        expect(count(body, "\n## Browser evidence\n")).toBe(1);
        expect(body).toContain("## A browser screenshot at repro");
        expect(body).not.toContain("{{pack.path");
        const pointer = body.match(/browser target\s+section of `([^`]+)`/);
        expect(pointer).not.toBeNull();
        const target = pointer![1]!.replace("${CLAUDE_SKILL_DIR}", join(compiled.pack, "attachments", verb));
        expect(target).toContain("/attachments/acme-evidence/SKILL.md");
        expect(existsSync(resolve(target))).toBe(true);
      }
    });

    test("receive-review runs no repro, so it carries no browser evidence", () => {
      expect(compiled.verbs["receive-review"]!).not.toContain(INCLUDE_MARKER);
    });

    test("no compiled verb mentions annotating-screenshots", () => {
      for (const body of Object.values(compiled.verbs)) expect(body).not.toContain("annotating-screenshots");
    });
  });

  describe("a pack with script evidence only", () => {
    let compiled: { pack: string; verbs: Compiled };
    beforeAll(async () => {
      compiled = await compilePack("scripts-only");
    });

    test("stage-evidence compiles with the include once and no browser target section", () => {
      const body = compiled.verbs["stage-evidence"];
      expect(count(body, INCLUDE_MARKER)).toBe(1);
      expect(body).not.toMatch(TARGET_HEADING);
    });

    test("outside the include, stage-evidence never reaches the browser driver", () => {
      const rest = withoutPart(compiled.verbs["stage-evidence"], INCLUDE_MARKER);
      expect(rest).not.toContain(INCLUDE_MARKER);
      expect(rest).not.toContain("fast-browser:browser-driver");
      expect(rest).not.toMatch(TARGET_HEADING);
      expect(rest).toContain("node scripts/shot.mjs");
    });

    test("stage-ship and ship hold the include once, no browser target, and never reach the driver outside it", () => {
      for (const verb of ["stage-ship", "ship"] as const) {
        const body = compiled.verbs[verb];
        expect(count(body, INCLUDE_MARKER)).toBe(1);
        expect(body).not.toMatch(TARGET_HEADING);
        const rest = withoutPart(body, INCLUDE_MARKER);
        expect(rest).not.toContain("fast-browser:browser-driver");
        expect(rest).toContain("node scripts/shot.mjs");
      }
    });

    test("no compiled verb mentions annotating-screenshots", () => {
      for (const body of Object.values(compiled.verbs)) expect(body).not.toContain("annotating-screenshots");
    });
  });
});
