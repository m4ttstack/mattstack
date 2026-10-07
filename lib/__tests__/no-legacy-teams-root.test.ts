/**
 * Org clones live under ~/.mattstack/orgs. The old ~/.mattstack/teams root
 * is named only by home init, the org.folder row and the org.folder converge
 * step that moves clones out of it. Named no-* so it runs on every PR.
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN = [
  "cli.ts",
  "commands",
  "lib",
  "scripts",
  "packages/rt-client/src",
  "packages/settings-kit/src",
  "apps/board/src",
  "apps/board/bin",
  "apps/board/scripts",
  "apps/boxscore/src",
  "apps/console/src",
];
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "fixtures"]);
const ALLOWED = new Set([
  "lib/rt-paths.ts",
  "packages/rt-client/src/settings/paths.ts",
  "lib/home/init-plan.ts",
  "lib/setup/validators/rt-health.ts",
  "lib/setup/steps/org-folder.ts",
]);
// The literal root, or "teams" joined straight after the mattstack home. A
// clone-relative join(clone, "mattstack", "teams") never matches.
const PATTERNS = [
  /\.mattstack\/teams\b/,
  /["']\.mattstack["']\s*,\s*["']teams["']/,
  /mattstackHome\(\)\s*,\s*["']teams["']/,
  /\bmattstackRoot\b\s*,\s*["']teams["']/,
  /\blegacyTeamsDir\(\)/,
];

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => !SKIP_DIRS.has(name))
    .flatMap((name) => sourceFiles(join(path, name)));
}

function exists(path: string): boolean {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
}

test("no source names the legacy ~/.mattstack/teams root", () => {
  const offenders = SCAN.filter(exists)
    .flatMap((p) => sourceFiles(join(ROOT, p)))
    .map((file) => relative(ROOT, file))
    .filter((rel) => !ALLOWED.has(rel))
    .filter((rel) => PATTERNS.some((re) => re.test(readFileSync(join(ROOT, rel), "utf8"))));
  expect(
    offenders,
    "org clones live under orgsDir(); only home init, the org.folder row and the org.folder converge step may name the old root",
  ).toEqual([]);
});
