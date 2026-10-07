// lib/__tests__/no-nested-team-pack.test.ts
/**
 * A team's pack is mattstack/teams/<team>/plugin/. The older
 * mattstack/teams/<team>/packs/<team>/ is spelled only by the detector in
 * lib/team/team-pack-path.ts and the conversion planner. Named no-* so it
 * runs on every PR.
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
const ALLOWED = new Set(["lib/team/team-pack-path.ts", "scripts/lib/move-team-packs.ts"]);
// "packs" joined after a team variable or a team folder, or a teams/<x>/packs/
// path. The base pack's join("org", "packs", name) and the bindings path
// join("packs", pack, "skills.jsonc") never match.
const PATTERNS = [
  /"packs",\s*(team|zone\.team)\b/,
  /zone\.dir,\s*"packs"/,
  /teams\/(\$\{[^}]*\}|<[^>]*>|[a-z0-9-]+)\/packs\//,
];

const DOC_SCAN = ["docs", "website/docs", "plugins/mattstack", "skills", "AGENTS.md"];
const DOC_SKIP = new Set(["node_modules", "superpowers", "CERTIFICATION.md"]);
const DOC_PATTERNS = [/teams\/[^/\s`]+\/packs\//, /\bpacks\/<team>\b/];

function files(path: string, keep: (name: string) => boolean, skip: Set<string>): string[] {
  if (statSync(path).isFile()) return keep(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => !skip.has(name))
    .flatMap((name) => files(join(path, name), keep, skip));
}

function exists(path: string): boolean {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
}

function offenders(roots: string[], keep: (name: string) => boolean, skip: Set<string>, allowed: Set<string>, patterns: RegExp[]): string[] {
  return roots.filter(exists)
    .flatMap((p) => files(join(ROOT, p), keep, skip))
    .map((file) => relative(ROOT, file))
    .filter((rel) => !allowed.has(rel))
    .filter((rel) => patterns.some((re) => re.test(readFileSync(join(ROOT, rel), "utf8"))));
}

test("no source names the team pack at mattstack/teams/<team>/packs/<team>", () => {
  const found = offenders(SCAN, (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p), SKIP_DIRS, ALLOWED, PATTERNS);
  expect(found, "a team's pack is mattstack/teams/<team>/plugin (teamPackDir, teamPackRel); only the detector and the conversion planner may spell the old path").toEqual([]);
});

test("no live doc teaches the team pack at mattstack/teams/<team>/packs/", () => {
  const found = offenders(DOC_SCAN, (p) => /\.mdx?$/.test(p), DOC_SKIP, new Set(), DOC_PATTERNS);
  expect(found, "live docs name mattstack/teams/<team>/plugin/; historical specs and plans under docs/superpowers and the certification ledger are not scanned").toEqual([]);
});
