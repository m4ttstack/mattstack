import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { MIGRATIONS, SHARED_STORE_MIGRATIONS, SHARED_STORE_REFUSAL } from "../setup/migrations/index.ts";

const DIR = join(import.meta.dir, "../setup/migrations");
const WRITE = /\b(setSetting|unsetSetting|pruneStoreName)\s*\(([^;]*?)\)/gs;
const PATHS = /\b(orgSettingsPath|teamSettingsPath|listTeamFolders)\b/;

export function sharedStoreHits(source: string): string[] {
  const hits: string[] = [];
  for (const m of source.matchAll(WRITE)) {
    const args = m[2]!;
    if (/"(org|team)"/.test(args)) hits.push(`${m[1]}(... "org"/"team" ...)`);
    else if (!/"(user|machine)"/.test(args)) hits.push(`${m[1]}(... a scope that is not a literal ...)`);
  }
  const path = source.match(PATHS);
  if (path) hits.push(path[1]!);
  return hits;
}

describe("sharedStoreHits", () => {
  test("org, team and a variable scope are hits", () => {
    expect(sharedStoreHits(`setSetting("k", 1, "team")`)).toHaveLength(1);
    expect(sharedStoreHits(`unsetSetting("k", "org")`)).toHaveLength(1);
    expect(sharedStoreHits(`setSetting("k", 1, scope)`)).toHaveLength(1);
  });
  test("a user scope is not a hit", () => {
    expect(sharedStoreHits(`setSetting("k", 1, "user")`)).toEqual([]);
  });
  test("a settings path mention is a hit", () => {
    expect(sharedStoreHits(`const p = teamSettingsPath(dir);`)).toEqual(["teamSettingsPath"]);
  });
  test("known miss: a nested call ends the lazy match early", () => {
    // The runtime refusal covers this shape.
    expect(sharedStoreHits(`setSetting("k", f("user"), "team")`)).toEqual([]);
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
      const hits = sharedStoreHits(source);
      if (hits.length) throw new Error(`${file}: ${hits.join(", ")}. ${SHARED_STORE_REFUSAL}`);
    });
  }
  test("the inline migrations in index.ts write only this Mac's stores", () => {
    const source = readFileSync(join(DIR, "index.ts"), "utf8").replace(/export const SHARED_STORE_[\s\S]*?;\n/g, "");
    expect(sharedStoreHits(source)).toEqual([]);
  });
});
