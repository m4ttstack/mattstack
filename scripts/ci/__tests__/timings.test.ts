import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ROOT } from "../test-scope.ts";

const OLD = '{"version":1,"files":{"lib/deleted.test.ts":5}}';
const MEASURED = '{"version":1,"files":{"lib/kept.test.ts":7}}';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "timings-script-"));
  writeFileSync(join(dir, "test-timings.json"), OLD);
  // The stub stands in for the suite: it records what a test reading the
  // committed file would see, then writes the measured file it was told to.
  writeFileSync(
    join(dir, "bun"),
    `#!/bin/bash\nprintf '%s\\n' "$*" > args\ncat test-timings.json > seen-during-run\n[ -n "$MEASURED" ] && for a in "$@"; do case "$a" in --timings=*) printf '%s' "$MEASURED" > "\${a#--timings=}" ;; esac; done\nexit "$SUITE_EXIT"\n`,
  );
  chmodSync(join(dir, "bun"), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function regenerate(suiteExit: number, ...args: string[]): number {
  return suite(suiteExit, MEASURED, args).exitCode;
}

function suite(suiteExit: number, measured: string, args: string[] = []) {
  return Bun.spawnSync(["bash", join(ROOT, "scripts/ci/timings.sh"), ...args], {
    cwd: dir,
    env: { PATH: `${dir}:${process.env.PATH}`, MEASURED: measured, SUITE_EXIT: String(suiteExit) },
  });
}

test("the committed file stays in place while the suite runs: two tests read it", () => {
  regenerate(0);
  expect(readFileSync(join(dir, "seen-during-run"), "utf8")).toBe(OLD);
});

test("the measured file replaces it whole, so a deleted test's entry goes", () => {
  expect(regenerate(0)).toBe(0);
  expect(readFileSync(join(dir, "test-timings.json"), "utf8")).toBe(MEASURED);
  expect(existsSync(join(dir, "test-timings.new.json"))).toBe(false);
});

test("a red suite still leaves the measurement, and stays red", () => {
  expect(regenerate(1)).toBe(1);
  expect(readFileSync(join(dir, "test-timings.json"), "utf8")).toBe(MEASURED);
});

test("a run that measured nothing leaves the committed file, and says nothing about it", () => {
  const run = suite(1, "");
  expect(run.exitCode).toBe(1);
  expect(run.stderr.toString()).toBe("");
  expect(readFileSync(join(dir, "test-timings.json"), "utf8")).toBe(OLD);
});

test("the caller's arguments reach the suite", () => {
  regenerate(0, "--path-ignore-patterns=lib/mac.test.ts");
  expect(readFileSync(join(dir, "args"), "utf8").trim()).toBe(
    "run test --timings=test-timings.new.json --update-timings --path-ignore-patterns=lib/mac.test.ts",
  );
});

test("the package script is this one, so a laptop run behaves the same", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  expect(pkg.scripts["test:timings"]).toBe("scripts/ci/timings.sh");
});
