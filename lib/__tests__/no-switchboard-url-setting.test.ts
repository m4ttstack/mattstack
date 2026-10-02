/**
 * The switchboard URL is a built-in constant read through switchboardUrl().
 * A stored copy from an older rt may linger on a Mac until the retire
 * migration runs, so nothing but that migration and the retired-key list may
 * name one. Named no-* so it runs on every PR.
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN = ["cli.ts", "commands", "lib", "packages/rt-client/src", "apps/board/src", "apps/board/bin", "apps/board/scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "fixtures"]);
const ALLOWED = new Set(["lib/setup/migrations/retire-switchboard-url.ts", "packages/rt-client/src/settings/registry-machinery.ts"]);
const PATTERNS = [/["']board\.switchboardUrl["']/, /\bswitchboardUrl\s*:/, /\.switchboardUrl\b/];

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => !SKIP_DIRS.has(name))
    .flatMap((name) => sourceFiles(join(path, name)));
}

test("no code reads or writes a stored switchboard URL", () => {
  const offenders = SCAN.flatMap((p) => sourceFiles(join(ROOT, p)))
    .map((file) => relative(ROOT, file))
    .filter((rel) => !ALLOWED.has(rel))
    .filter((rel) => PATTERNS.some((re) => re.test(readFileSync(join(ROOT, rel), "utf8"))));
  expect(offenders, "read the switchboard through switchboardUrl() from @mattstack/rt-client").toEqual([]);
});
