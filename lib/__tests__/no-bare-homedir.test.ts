import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join, relative, resolve } from "path";

// Bun fixes os.homedir() at the HOME the process started with, so a path
// built from it ignores the test preload's scratch HOME and reaches the
// developer's real ~/.mattstack, ~/.claude or herdr socket. Paths under those
// folders read HOME at call time (`process.env.HOME ?? homedir()`).
const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN_ROOTS = ["lib", "commands", "packages/rt-client/src", "apps/board/src", "apps/console/src", "apps/gitq/src"];
const BARE = /join\(\s*homedir\(\)\s*,\s*['"](\.mattstack|\.claude|\.config['"]\s*,\s*['"]herdr)/;
const TILDE = /join\(\s*homedir\(\)\s*,\s*\w+\.path\.slice\(1\)\)/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === "dist") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

test("no source builds a ~/.mattstack, ~/.claude or herdr path from a bare os.homedir()", () => {
  const offenders: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of sourceFiles(join(ROOT, root))) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (BARE.test(line) || TILDE.test(line)) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  expect(offenders).toEqual([]);
});
