/**
 * The Slack persona moved to agent.persona and the trigger to
 * chat.slackSupport.trigger. The old key still answers through the settings
 * heir for outside callers, so nothing in this repo may name it.
 */

import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN = ["lib", "commands", "packages", ...readdirSync(join(ROOT, "apps")).map((app) => `apps/${app}/src`)];
const SKIP_DIRS = new Set(["node_modules", "dist", "__tests__", "fixtures"]);
const ALLOWED = ["packages/rt-client/src/settings/migrations/", "packages/rt-client/src/settings/schema.lock.json"];
const OLD_KEY = /["']chat\.slackSupport\.persona["']/;

function files(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return /\.(tsx?|json)$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  return readdirSync(path)
    .filter((name) => !SKIP_DIRS.has(name))
    .flatMap((name) => files(join(path, name)));
}

test("no code reads or writes the old Slack persona key", () => {
  const offenders = SCAN.flatMap((p) => files(join(ROOT, p)))
    .map((file) => relative(ROOT, file))
    .filter((rel) => !ALLOWED.some((allowed) => rel.startsWith(allowed)))
    .filter((rel) => OLD_KEY.test(readFileSync(join(ROOT, rel), "utf8")));
  expect(offenders, "read agent.persona and chat.slackSupport.trigger").toEqual([]);
});
