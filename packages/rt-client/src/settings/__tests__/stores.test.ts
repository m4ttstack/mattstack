/**
 * lib/settings/stores.ts — reading the raw settings store files (jsonc-parser
 * based). Every test re-points HOME to a fresh temp dir: store files are
 * process-global state (rt-paths resolves HOME at call time), so tests must
 * not share a tree.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { userSettingsPath, orgSettingsPath, teamsDir, machineSettingsPath } from "../paths.ts";
import { currentOrg, listOrgs, listTeamFolders, parseStoreText, readStore } from "../stores.ts";

describe("settings/stores", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rt-settings-stores-"));
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  describe("readStore", () => {
    test("parses JSONC with comments and splits out the repos section", () => {
      const file = userSettingsPath();
      mkdirSync(join(home, ".mattstack", "user"), { recursive: true });
      writeFileSync(
        file,
        `{
          // a global key with a trailing comment
          "rt.hooks": { "provider": "ollama", "model": "qwen3" },
          "repos": {
            "gitlab.com/acme/acme-dev": {
              "rt.roles": { "backend": { "pool": [] } },
            },
          },
        }`,
      );

      const store = readStore(file);

      expect(store.file).toBe(file);
      expect(store.exists).toBe(true);
      expect(store.global).toEqual({ "rt.hooks": { provider: "ollama", model: "qwen3" } });
      expect(store.repos).toEqual({
        "gitlab.com/acme/acme-dev": { "rt.roles": { backend: { pool: [] } } },
      });
    });

    test("global map never contains the repos key itself", () => {
      const file = machineSettingsPath();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `{ "rt.foo": 1, "repos": {} }`);

      const store = readStore(file);

      expect(Object.keys(store.global)).not.toContain("repos");
    });

    test("missing file: exists false, empty maps, no throw", () => {
      const file = userSettingsPath(); // never written

      const store = readStore(file);

      expect(store.exists).toBe(false);
      expect(store.global).toEqual({});
      expect(store.repos).toEqual({});
      expect(store.file).toBe(file);
    });

    test("malformed JSONC: exists true, empty maps, warns once", () => {
      const file = machineSettingsPath();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `{ "rt.foo": ,,, this is not json`);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const store = readStore(file);

        expect(store.exists).toBe(true);
        expect(store.global).toEqual({});
        expect(store.repos).toEqual({});
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toContain(file);
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("a present but non-object \"repos\" value warns and degrades to empty repos, but global keys still parse", () => {
      const file = machineSettingsPath();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `{ "rt.foo": 1, "repos": "not-an-object" }`);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const store = readStore(file);

        expect(store.exists).toBe(true);
        expect(store.global).toEqual({ "rt.foo": 1 }); // partial degrade, not total
        expect(store.repos).toEqual({});
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toContain(file);
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("a present but array \"repos\" value also warns and degrades", () => {
      const file = machineSettingsPath();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `{ "repos": [1, 2, 3] }`);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const store = readStore(file);

        expect(store.repos).toEqual({});
        expect(warnSpy).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("an absent \"repos\" key is normal — no warn, empty repos", () => {
      const file = machineSettingsPath();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `{ "rt.foo": 1 }`);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const store = readStore(file);

        expect(store.repos).toEqual({});
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("a root that parses to a non-object (e.g. a bare array) is treated as malformed", () => {
      const file = machineSettingsPath();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `[1, 2, 3]`);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const store = readStore(file);

        expect(store.exists).toBe(true);
        expect(store.global).toEqual({});
        expect(store.repos).toEqual({});
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("an empty file parses to an empty store (not malformed)", () => {
      const file = userSettingsPath();
      mkdirSync(join(home, ".mattstack", "user"), { recursive: true });
      writeFileSync(file, "");

      const store = readStore(file);

      expect(store.exists).toBe(true);
      expect(store.global).toEqual({});
      expect(store.repos).toEqual({});
    });
  });

  describe("org listing", () => {
    test("an org is a clone with mattstack/org/settings.org.jsonc", () => {
      const org = join(teamsDir(), "acme", "mattstack", "org");
      mkdirSync(org, { recursive: true });
      writeFileSync(join(org, "settings.org.jsonc"), "{}");
      mkdirSync(join(teamsDir(), "old-layout", "mattstack"), { recursive: true });
      writeFileSync(join(teamsDir(), "old-layout", "mattstack", "settings.team.jsonc"), "{}");
      expect(listOrgs()).toEqual(["acme"]);
      expect(currentOrg()).toBe("acme");
    });

    test("parseStoreText gives the same store readStore does", () => {
      const text = `// header\n{ "board.title": "Acme", "repos": { "gitlab.example.com/acme/widgets": { "rt.roles": {} } } }`;
      expect(parseStoreText("/x/settings.org.jsonc", text)).toEqual({ global: { "board.title": "Acme" }, repos: { "gitlab.example.com/acme/widgets": { "rt.roles": {} } }, file: "/x/settings.org.jsonc", exists: true });
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(parseStoreText("/x/s.jsonc", "{ not json").global).toEqual({});
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("no teams dir at all lists no orgs, and does not throw", () => {
      expect(listOrgs()).toEqual([]);
      expect(currentOrg()).toBeNull();
    });

    test("a symlinked org clone still counts", () => {
      const real = join(home, "elsewhere", "acme");
      mkdirSync(join(real, "mattstack", "org"), { recursive: true });
      writeFileSync(join(real, "mattstack", "org", "settings.org.jsonc"), "{}");
      mkdirSync(teamsDir(), { recursive: true });
      symlinkSync(real, join(teamsDir(), "acme"));

      expect(listOrgs()).toEqual(["acme"]);
    });

    test("a DANGLING symlink is skipped with a warn, and healthy clones still list", () => {
      // The realistic trigger: a clone symlinked in and later moved. The
      // follow-the-link stat throws ENOENT, and listOrgs is on the path of
      // every settings resolution, so it must skip, not throw.
      mkdirSync(dirname(orgSettingsPath("acme")), { recursive: true });
      writeFileSync(orgSettingsPath("acme"), "{}");
      symlinkSync(join(home, "moved-away"), join(teamsDir(), "moved-org"));
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        expect(listOrgs()).toEqual(["acme"]);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toContain("moved-org");
      } finally {
        warnSpy.mockRestore();
      }
    });

    test("an unreadable teams dir lists no orgs, warns, and does not throw", () => {
      const dir = teamsDir();
      mkdirSync(dir, { recursive: true });
      chmodSync(dir, 0o000);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        expect(listOrgs()).toEqual([]);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toContain(dir);
      } finally {
        warnSpy.mockRestore();
        chmodSync(dir, 0o755); // so afterEach can remove the temp HOME
      }
    });

    test("team folders are plain lowercase names, sorted", () => {
      const teams = join(teamsDir(), "acme", "mattstack", "teams");
      for (const name of ["widgets", "gadgets", "Widgets2", ".git"]) mkdirSync(join(teams, name), { recursive: true });
      writeFileSync(join(teams, "notes.md"), "");
      expect(listTeamFolders("acme")).toEqual(["gadgets", "widgets"]);
      expect(listTeamFolders("nope")).toEqual([]);
    });
  });
});
