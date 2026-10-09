import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { MIGRATIONS, SHARED_STORE_MIGRATIONS, SHARED_STORE_REFUSAL } from "../setup/migrations/index.ts";

const DIR = join(import.meta.dir, "../setup/migrations");
const CALL = /\b(setSetting|unsetSetting|pruneStoreName)\s*\(/g;
const PATHS = /\b(orgSettingsPath|teamSettingsPath|listTeamFolders)\b/;
const SCOPE_INDEX: Record<string, number> = { setSetting: 2, unsetSetting: 1, pruneStoreName: 2 };

function topLevelArgs(source: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < source.length; i++) {
    const c = source[i]!;
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === "\\") i++;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        args.push(source.slice(start, i));
        return args;
      }
    } else if (c === "," && depth === 1) {
      args.push(source.slice(start, i));
      start = i + 1;
    }
  }
  return args;
}

function sharedStoreHits(source: string): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(CALL)) {
    const name = m[1]!;
    const scope = topLevelArgs(source, m.index! + m[0].length - 1)[SCOPE_INDEX[name]!]?.trim();
    if (scope === '"org"' || scope === '"team"') hits.push(`${name}(... "org"/"team" ...)`);
    else if (scope !== '"user"' && scope !== '"machine"') hits.push(`${name}(... a scope that is not a literal ...)`);
  }
  const path = source.match(PATHS);
  if (path) hits.push(path[1]!);
  return hits;
}

function violation(file: string, source: string): string | null {
  const hits = sharedStoreHits(source);
  return hits.length ? `${file}: ${hits.join(", ")}. ${SHARED_STORE_REFUSAL}` : null;
}

describe("sharedStoreHits", () => {
  test("org, team and a variable scope are hits", () => {
    expect(sharedStoreHits(`setSetting("k", 1, "team")`)).toHaveLength(1);
    expect(sharedStoreHits(`unsetSetting("k", "org")`)).toHaveLength(1);
    expect(sharedStoreHits(`setSetting("k", 1, scope)`)).toHaveLength(1);
  });
  test("a nested call in the value cannot hide the scope", () => {
    expect(sharedStoreHits(`setSetting("k", Date.now(), "team")`)).toHaveLength(1);
    expect(sharedStoreHits(`setSetting("k", JSON.parse(x), "team")`)).toHaveLength(1);
    expect(sharedStoreHits(`setSetting("k", f("user"), "team")`)).toHaveLength(1);
    expect(sharedStoreHits(`setSetting("k", f("user"), scope)`)).toHaveLength(1);
  });
  test("a user or machine scope is not a hit", () => {
    expect(sharedStoreHits(`setSetting("k", 1, "user")`)).toEqual([]);
    expect(sharedStoreHits(`setSetting("k", f(")"), "machine")`)).toEqual([]);
  });
  test("pruneStoreName takes its scope third", () => {
    expect(sharedStoreHits(`pruneStoreName("k", "board.tabs", "team", { force: true })`)).toHaveLength(1);
    expect(sharedStoreHits(`pruneStoreName("k", "x", "user")`)).toEqual([]);
  });
  test("a settings path mention is a hit", () => {
    expect(sharedStoreHits(`const p = teamSettingsPath(dir);`)).toEqual(["teamSettingsPath"]);
  });
  test("a violation reads file, hits, then the refusal", () => {
    expect(violation("a.ts", `setSetting("k", 1, "team")`)).toBe(
      `a.ts: setSetting(... "org"/"team" ...). ${SHARED_STORE_REFUSAL}`,
    );
    expect(violation("a.ts", `setSetting("k", 1, "user")`)).toBeNull();
  });
});

describe("setup migrations never write the org or team stores", () => {
  const allowedIds = new Set(
    MIGRATIONS.filter((m) => m.id in SHARED_STORE_MIGRATIONS).map((m) => m.id),
  );
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".ts") && f !== "index.ts")) {
    test(file, () => {
      const source = readFileSync(join(DIR, file), "utf8");
      const ids = [...source.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]!);
      if (ids.some((id) => allowedIds.has(id))) return;
      const failure = violation(file, source);
      if (failure) throw new Error(failure);
    });
  }
  test("the inline migrations in index.ts write only this Mac's stores", () => {
    const source = readFileSync(join(DIR, "index.ts"), "utf8").replace(/export const SHARED_STORE_[\s\S]*?;\n/g, "");
    expect(sharedStoreHits(source)).toEqual([]);
  });
});
