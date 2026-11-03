import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { userSettingsPath } from "../paths.ts";
import { userStoreUnreadableFor } from "../write.ts";

const KEY = "rt.skills.disableModelInvocation";

describe("userStoreUnreadableFor", () => {
  let home: string;
  let savedHome: string | undefined;
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-user-store-")));
    savedHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  function store(body: string): void {
    mkdirSync(dirname(userSettingsPath()), { recursive: true });
    writeFileSync(userSettingsPath(), body);
  }

  test("a missing or empty store is readable", () => {
    expect(userStoreUnreadableFor(KEY)).toBe(false);
    store("  \n");
    expect(userStoreUnreadableFor(KEY)).toBe(false);
  });

  test("a store with the key absent, or a well-formed value, is readable", () => {
    store('// mine\n{ "rt.cron": {} }\n');
    expect(userStoreUnreadableFor(KEY)).toBe(false);
    store(`{ "${KEY}": { "widgets@market": ["alpha"], "other@x": [] } }`);
    expect(userStoreUnreadableFor(KEY)).toBe(false);
  });

  test("a store that does not parse, or whose root is not an object, is unreadable", () => {
    store("{ this is not json");
    expect(userStoreUnreadableFor(KEY)).toBe(true);
    store('["a"]');
    expect(userStoreUnreadableFor(KEY)).toBe(true);
  });

  test("a value the key's schema rejects is unreadable for that key only", () => {
    store(`{ "${KEY}": ["alpha"], "rt.cron": {} }`);
    expect(userStoreUnreadableFor(KEY)).toBe(true);
    store(`{ "${KEY}": { "widgets@market": "alpha" } }`);
    expect(userStoreUnreadableFor(KEY)).toBe(true);
    expect(userStoreUnreadableFor("rt.cron")).toBe(false);
  });

  test("a store that cannot be read at all is unreadable", () => {
    store("{}");
    chmodSync(userSettingsPath(), 0o000);
    try {
      expect(userStoreUnreadableFor(KEY)).toBe(true);
    } finally {
      chmodSync(userSettingsPath(), 0o644);
    }
  });
});
