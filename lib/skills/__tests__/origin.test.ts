import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { originFor, originOf, originOfDir } from "../origin.ts";
import type { PluginRoots } from "../sources.ts";

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "rt-origin-"))); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

const roots = (): PluginRoots => ({
  byName: {
    mattstack: { dir: join(root, "mattstack"), version: "0.30.0" },
    "acme-base": { dir: join(root, "acme-base"), version: "org", baseVersion: "0.1.0" },
  },
  list: [],
  folderOnly: new Set(["acme-base"]),
});

function emitted(dir: string, provenance: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "---\nname: x\n---\nbody\n");
  writeFileSync(join(dir, "compiled.json"), provenance);
  return dir;
}

test("a base root's plugin is a base, with its version", () => {
  expect(originOf(roots(), "acme-base")).toEqual({ origin: "base", base: "acme-base", baseVersion: "0.1.0" });
});

test("an installed plugin and an unknown name have no origin", () => {
  expect(originOf(roots(), "mattstack")).toEqual({});
  expect(originOf(roots(), "nope")).toEqual({});
});

test("an emitted folder is a base from its compiled.json", () => {
  const dir = emitted(join(root, "widgets", "attachments", "dev-servers"), JSON.stringify({ base: "acme-base", version: "0.1.0", files: ["SKILL.md"] }));
  expect(originOfDir(dir)).toEqual({ origin: "base", base: "acme-base", baseVersion: "0.1.0" });
});

test("a compiled.json version of null reads as a null baseVersion", () => {
  const dir = emitted(join(root, "a"), JSON.stringify({ base: "acme-base", version: null, files: [] }));
  expect(originOfDir(dir)).toEqual({ origin: "base", base: "acme-base", baseVersion: null });
});

test("a hand-authored or malformed compiled.json is not a base", () => {
  expect(originOfDir(emitted(join(root, "b"), JSON.stringify({ rows: [1, 2] })))).toEqual({});
  expect(originOfDir(emitted(join(root, "c"), "{ not json"))).toEqual({});
  expect(originOfDir(join(root, "missing"))).toEqual({});
});

test("the path wins over the name", () => {
  const dir = emitted(join(root, "widgets", "attachments", "board-fill"), JSON.stringify({ base: "acme-base", version: "0.1.0", files: [] }));
  expect(originFor(roots(), "widgets", dir)).toEqual({ origin: "base", base: "acme-base", baseVersion: "0.1.0" });
  expect(originFor(roots(), "acme-base", null)).toEqual({ origin: "base", base: "acme-base", baseVersion: "0.1.0" });
  expect(originFor(roots(), "mattstack", join(root, "mattstack", "attachments", "x"))).toEqual({});
});
