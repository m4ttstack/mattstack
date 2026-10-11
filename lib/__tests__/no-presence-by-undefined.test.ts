/**
 * Source guard: whether a setting is set is asked with provenance
 * (lib/settings/presence.ts), never by comparing its value with undefined,
 * which a registry default makes always false. Each allowlisted file is an
 * ownership latch a later settings-defaults PR retires; its count pins it.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { extname, join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN_ROOTS = ["commands", "lib", "cli.ts", "apps", "packages", "extensions"];
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-bin", "build", ".turbo", "fixtures", "test", "tests", "__tests__", "docs"]);
const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".js", ".mjs"]);
const EXCLUDED_PREFIXES = ["packages/rt-client/src/settings/"];
const PRESENCE = /\b(?:getSetting|resolve)\s*(?:<[^>()]*>)?\(\s*[^()]*\)\s*\.value\s*[!=]==?\s*undefined/g;

const ALLOWLIST: Record<string, { count: number; reason: string }> = {};

function* sourceFiles(path: string): Generator<string> {
  if (!existsSync(path)) return;
  if (statSync(path).isFile()) {
    if (SOURCE_EXT.has(extname(path)) && !/\.test\.[cm]?[jt]sx?$/.test(path)) yield path;
    return;
  }
  for (const name of readdirSync(path)) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    yield* sourceFiles(join(path, name));
  }
}

describe("presence checks", () => {
  test("the pattern catches both comparisons and a typed call", () => {
    for (const hit of ['getSetting("k").value === undefined', "getSetting<unknown>(KEY).value !== undefined", "resolve<unknown>('k').value !== undefined"]) {
      expect(hit.match(PRESENCE)).toHaveLength(1);
    }
    expect('getSetting("k").value ?? []'.match(PRESENCE)).toBeNull();
  });

  test("no source asks whether a setting is set by comparing its value with undefined", () => {
    const counts: Record<string, number> = {};
    for (const root of SCAN_ROOTS) {
      for (const file of sourceFiles(join(ROOT, root))) {
        const rel = relative(ROOT, file);
        if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        const hits = readFileSync(file, "utf8").match(PRESENCE)?.length ?? 0;
        if (hits > 0) counts[rel] = hits;
      }
    }
    expect(counts).toEqual(Object.fromEntries(Object.entries(ALLOWLIST).map(([file, a]) => [file, a.count])));
  });
});
