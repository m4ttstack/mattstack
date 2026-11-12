import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { readFileSync, rmSync } from "fs";
import { join } from "path";
import { LOCK_REL, readLock } from "../../lib/skills/compiled-lock.ts";
import { captureSkills, seedTwoVerbPack, setTwoVerbPackVersion } from "../../lib/skills/__tests__/helpers.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { compileBlocks, compileFailure, misplacedFailure, skillsCompile, staleEngineFailure } from "../skills.ts";

test("a compile lists each verb, with its warnings under it", () => {
  expect(
    renderPlain(
      compileBlocks(
        [
          { name: "watch-ci", side: "skills", files: 3, warnings: ["slot forge is bound but unused"] },
          { name: "ship", side: "attachments", files: 1, warnings: [] },
        ],
        true,
      ),
    ),
  ).toBe("[warning] Compiled watch-ci  3 files in skills/\n  note: slot forge is bound but unused\n[ok] Compiled ship  1 file in attachments/\n");
});

test("a row with only informational notes is done, and the note is not labelled twice", () => {
  expect(
    renderPlain(compileBlocks([{ name: "watch-ci", side: "skills", files: 1, warnings: ["note: acme:qa-gates is surface-internal; inlined"] }], true)),
  ).toBe("[ok] Compiled watch-ci  1 file in skills/\n  note: acme:qa-gates is surface-internal; inlined\n");
});

test("two warnings are one note, one line each", () => {
  expect(renderPlain(compileBlocks([{ name: "watch-ci", side: "skills", files: 2, warnings: ["first thing", "note: second thing"] }], true))).toBe(
    "[warning] Compiled watch-ci  2 files in skills/\n  note: first thing\n        second thing\n",
  );
});

test("a dry run says what it would write", () => {
  expect(renderPlain(compileBlocks([{ name: "watch-ci", side: "skills", files: 3, warnings: [] }], false))).toBe("[not yet] watch-ci  would write 3 files\n");
});

test("an empty compile says so", () => {
  expect(renderPlain(compileBlocks([], true))).toBe("[skipped] Nothing to compile  this pack has no verbs\n");
});

test("compile failures are one failure with every message under it", () => {
  expect(renderPlain([out.failure(compileFailure(['verb "a": slot "forge" has no binding', 'verb "b": engine not found']))])).toBe(
    '2 verbs did not compile\n  verb "a": slot "forge" has no binding\n  verb "b": engine not found\n',
  );
  expect(compileFailure(["only one"]).title).toBe("1 verb did not compile");
});

test("a compile that met an engine with no block tree names the plugin update", () => {
  const line = 'verb "ship": loadStepSource: engine "ship" at /x/ship has no index.block.md; an engine is a block tree';
  expect(renderPlain([out.failure(compileFailure([line], true))])).toBe(
    "1 verb did not compile\n" +
      "  why: Its skills are single SKILL.md files, and this rt compiles only block trees. Update the plugin, or update the mattstack app, which updates it.\n" +
      "  next: claude plugin update mattstack@mattstack\n" +
      `  ${line}\n`,
  );
  expect(renderPlain([out.failure(staleEngineFailure(line))])).toStartWith("The installed mattstack plugin is older than this rt\n");
});

test("a misplaced skill names the fix", () => {
  expect(renderPlain([out.failure(misplacedFailure(["helper"]))])).toBe(
    "helper is in the wrong folder\n  why: A skill's folder has to match whether it is public or internal.\n  next: rt skills surface apply\n",
  );
  expect(renderPlain([out.failure(misplacedFailure(["a", "b"]))])).toBe(
    "2 skills are in the wrong folder\n  why: A skill's folder has to match whether it is public or internal.\n  next: rt skills surface apply\n  a\n  b\n",
  );
});

test("field-contract failures are titled as such, not counted as verbs, and keep their exact words", () => {
  const line = 'field contract: attachments/stage-plan/SKILL.md:3 reads "extra.plan-verdict", which nothing in this pack writes';
  expect(renderPlain([out.failure(compileFailure([line]))])).toBe(`1 field-contract error\n  ${line}\n`);
  expect(compileFailure([line, line]).title).toBe("2 field-contract errors");
});

describe("the compiled lock", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
    process.exitCode = 0;
  });

  async function compile(flags: string[]): Promise<void> {
    const io = captureSkills();
    try {
      await skillsCompile(flags);
    } finally {
      io.restore();
    }
    expect(Number(process.exitCode ?? 0)).toBe(0);
  }

  const inRepo = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "pipe", env: childEnv() }).toString();

  test("a version-only bump changes only plugin.json and the lock", async () => {
    const { packDir, flags } = seedTwoVerbPack(made);
    inRepo(packDir, "init", "-q");
    await compile(flags);
    expect(readLock(packDir).targets["skills/alpha"]).toEqual({ acme: "0.4.11", mattstack: "1.0.0" });
    inRepo(packDir, "add", "-A");
    inRepo(packDir, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "compile");

    setTwoVerbPackVersion(packDir, "0.4.12");
    await compile(flags);
    // compiled.json's versioned resolve id is the one stamp left, and Task 4 removes it.
    const idOnly = ["skills/alpha/compiled.json", "skills/beta/compiled.json"];
    expect(inRepo(packDir, "status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual([" M .claude-plugin/plugin.json", ` M ${LOCK_REL}`, ...idOnly.map((f) => ` M ${f}`)]);
    const changed = inRepo(packDir, "diff", "-U0", "--", ...idOnly).split("\n").filter((l) => /^[-+](?![-+])/.test(l));
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((l) => /acme@0\.4\.1[12]:(alpha|beta)/.test(l))).toBe(true);
    expect(readLock(packDir).targets["skills/beta"]).toEqual({ acme: "0.4.12", mattstack: "1.0.0" });
  });

  test("a --verb compile leaves other targets' lock entries alone", async () => {
    const { packDir, flags } = seedTwoVerbPack(made);
    await compile(flags);
    setTwoVerbPackVersion(packDir, "0.4.12");
    await compile([...flags, "--verb", "alpha"]);
    const lock = readLock(packDir);
    expect(lock.targets["skills/alpha"]).toEqual({ acme: "0.4.12", mattstack: "1.0.0" });
    expect(lock.targets["skills/beta"]).toEqual({ acme: "0.4.11", mattstack: "1.0.0" });
    expect(readFileSync(join(packDir, "skills", "beta", "SKILL.md"), "utf8")).not.toContain("version=");
  });
});
