import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { orgSettingsPath, orgsDir, userSettingsPath } from "../paths.ts";
import { listOrgs, readStore } from "../stores.ts";

describe("settings store read cache", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-settings-cache-"));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function writeUser(text: string): string {
    const file = userSettingsPath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  }

  test("an unchanged store file is read from disk once", () => {
    const file = writeUser(`{ "board.title": "A" }`);
    const spy = spyOn(fs, "readFileSync");
    try {
      readStore(file);
      readStore(file);
      readStore(file);
      expect(spy.mock.calls.filter((c) => c[0] === file)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("a same-size rewrite in place is seen at once", () => {
    const file = writeUser(`{ "board.title": "A" }`);
    expect(readStore(file).global["board.title"]).toBe("A");
    writeFileSync(file, `{ "board.title": "B" }`);
    expect(readStore(file).global["board.title"]).toBe("B");
    writeFileSync(file, `{ "board.title": "C" }`);
    expect(readStore(file).global["board.title"]).toBe("C");
  });

  test("a deleted then recreated file is seen", () => {
    const file = writeUser(`{ "board.title": "A" }`);
    expect(readStore(file).exists).toBe(true);
    rmSync(file);
    expect(readStore(file)).toMatchObject({ exists: false, global: {} });
    writeFileSync(file, `{ "board.title": "Z" }`);
    expect(readStore(file).global["board.title"]).toBe("Z");
  });

  test("a caller mutating a result does not change the next read", () => {
    const file = writeUser(`{ "board.tabs": ["a"], "repos": { "r": { "x": 1 } } }`);
    const first = readStore(file);
    (first.global["board.tabs"] as string[]).push("b");
    first.repos.r!.x = 2;
    first.global.extra = true;
    const second = readStore(file);
    expect(second.global).toEqual({ "board.tabs": ["a"] });
    expect(second.repos).toEqual({ r: { x: 1 } });
  });

  test("a malformed store that gets fixed is read fresh", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const file = writeUser(`{ "board.title": `);
      expect(readStore(file).global).toEqual({});
      writeFileSync(file, `{ "board.title": "ok" }`);
      expect(readStore(file).global["board.title"]).toBe("ok");
    } finally {
      warn.mockRestore();
    }
  });

  test("the cache is keyed by absolute path, so a new HOME reads its own files", () => {
    writeUser(`{ "board.title": "first" }`);
    expect(readStore(userSettingsPath()).global["board.title"]).toBe("first");
    const other = mkdtempSync(join(tmpdir(), "rt-settings-cache-"));
    try {
      process.env.HOME = other;
      writeUser(`{ "board.title": "second" }`);
      expect(readStore(userSettingsPath()).global["board.title"]).toBe("second");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("listOrgs does not re-list an unchanged orgs dir", () => {
    mkdirSync(dirname(orgSettingsPath("acme")), { recursive: true });
    writeFileSync(orgSettingsPath("acme"), "{}");
    const spy = spyOn(fs, "readdirSync");
    try {
      expect(listOrgs()).toEqual(["acme"]);
      expect(listOrgs()).toEqual(["acme"]);
      expect(spy.mock.calls.filter((c) => c[0] === orgsDir())).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  test("listOrgs sees an org store that appears inside an existing clone", () => {
    mkdirSync(dirname(orgSettingsPath("acme")), { recursive: true });
    expect(listOrgs()).toEqual([]);
    writeFileSync(orgSettingsPath("acme"), "{}");
    expect(listOrgs()).toEqual(["acme"]);
  });

  test("listOrgs sees a clone added to the orgs dir", () => {
    mkdirSync(dirname(orgSettingsPath("acme")), { recursive: true });
    writeFileSync(orgSettingsPath("acme"), "{}");
    expect(listOrgs()).toEqual(["acme"]);
    mkdirSync(dirname(orgSettingsPath("beta")), { recursive: true });
    writeFileSync(orgSettingsPath("beta"), "{}");
    expect([...listOrgs()].sort()).toEqual(["acme", "beta"]);
  });
});
