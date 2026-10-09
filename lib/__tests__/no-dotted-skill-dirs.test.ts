/**
 * rt-tray/build.sh refuses a dotted directory anywhere in a skills tree it
 * bundles, because codesign reads one as a nested bundle. Only a release
 * build runs that check, so this guard moves it onto every PR.
 */

import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");

function dottedDirs(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (entry.name.includes(".")) found.push(relative(ROOT, path));
    found.push(...dottedDirs(path));
  }
  return found;
}

test("no skills tree the app bundles holds a dotted directory", () => {
  const appSkills = readdirSync(join(ROOT, "apps"))
    .map((app) => join(ROOT, "apps", app, "skills"))
    .filter((dir) => existsSync(dir));
  const trees = [join(ROOT, "skills"), ...appSkills];
  expect(trees.flatMap(dottedDirs)).toEqual([]);
});
