import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { seedOrg } from "../../../test/org-fixture.ts";
import { readStore } from "../stores.ts";
import { renameRepoSection } from "../write.ts";

const OLD = "github.com/acme/old";
const NEW = "github.com/acme/new";

describe("renameRepoSection", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "rt-rename-section-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function store(body: string): string {
    const file = join(dir, "settings.machine.jsonc");
    writeFileSync(file, body);
    return file;
  }

  test("moves the section and keeps the rest of the file", () => {
    const file = store(`// header comment\n{\n  "rt.cron": { "a": 1 },\n  "repos": {\n    "${OLD}": { "rt.worktrees": { "onDeck": 2 } }\n  }\n}\n`);
    const r = renameRepoSection(file, OLD, NEW);
    expect(r).toEqual({ status: "moved", keys: 1 });
    const s = readStore(file);
    expect(s.repos[NEW]).toEqual({ "rt.worktrees": { onDeck: 2 } });
    expect(s.repos[OLD]).toBeUndefined();
    expect(s.global["rt.cron"]).toEqual({ a: 1 });
  });

  test("already when only the new section exists, none when neither or no file", () => {
    const file = store(`{ "repos": { "${NEW}": { "x": 1 } } }\n`);
    expect(renameRepoSection(file, OLD, NEW).status).toBe("already");
    expect(renameRepoSection(store(`{ "a": 1 }\n`), OLD, NEW).status).toBe("none");
    expect(renameRepoSection(join(dir, "missing.jsonc"), OLD, NEW).status).toBe("none");
  });

  test("refuses when both sections exist", () => {
    const file = store(`{ "repos": { "${OLD}": { "x": 1 }, "${NEW}": { "y": 2 } } }\n`);
    const r = renameRepoSection(file, OLD, NEW);
    expect(r.status).toBe("refused");
    expect(readStore(file).repos[OLD]).toEqual({ x: 1 });
  });

  test("finishes an interrupted rename when both sections are equal", () => {
    const file = store(`{ "repos": { "${OLD}": { "x": { "y": 1 } }, "${NEW}": { "x": { "y": 1 } } } }\n`);
    expect(renameRepoSection(file, OLD, NEW)).toEqual({ status: "moved", keys: 1 });
    const s = readStore(file);
    expect(s.repos[OLD]).toBeUndefined();
    expect(s.repos[NEW]).toEqual({ x: { y: 1 } });
  });

  test("reports a store the writer refuses to edit as refused", () => {
    const file = store(`{ "a": 1, "a": 2, "repos": { "${OLD}": { "x": 1 } } }\n`);
    const r = renameRepoSection(file, OLD, NEW);
    expect(r.status).toBe("refused");
    expect(readStore(file).repos[OLD]).toEqual({ x: 1 });
  });

  test("refuses an unparseable store that may hold the old section and leaves it untouched", () => {
    const body = `{ "repos": { "${OLD}": { "x": 1 } }\n`;
    const file = store(body);
    expect(renameRepoSection(file, OLD, NEW)).toEqual({ status: "refused", keys: 0, detail: `unparseable store ${file}` });
    expect(readFileSync(file, "utf8")).toBe(body);
  });

  test("dry run reports without writing", () => {
    const file = store(`{ "repos": { "${OLD}": { "x": 1 } } }\n`);
    expect(renameRepoSection(file, OLD, NEW, { dryRun: true })).toEqual({ status: "moved", keys: 1 });
    expect(readStore(file).repos[OLD]).toEqual({ x: 1 });
  });

  describe("a shared store under another spelling", () => {
    const origHome = process.env.HOME;
    afterEach(() => {
      process.env.HOME = origHome;
    });

    function seedMember(): { orgStore: string; teamStore: string; home: string } {
      const home = join(dir, "home");
      mkdirSync(home);
      process.env.HOME = home;
      const section = { repos: { [OLD]: { x: 1 } } };
      const seeded = seedOrg({
        org: "acme",
        username: "dev4",
        roles: { admins: ["dev1"], teams: { widgets: { owners: ["dev2"] } } },
        settings: section,
        teams: { widgets: section },
      });
      return { orgStore: seeded.orgStore, teamStore: seeded.teamStores.widgets!, home };
    }

    test("is refused for a member through a symlinked home", () => {
      const { orgStore, teamStore, home } = seedMember();
      const link = join(dir, "home-link");
      symlinkSync(home, link);
      for (const real of [orgStore, teamStore]) {
        const before = readFileSync(real, "utf8");
        const r = renameRepoSection(join(link, real.slice(home.length)), OLD, NEW);
        expect(r.status).toBe("refused");
        expect(readFileSync(real, "utf8")).toBe(before);
      }
    });

    test("is refused for a member through an unnormalized path", () => {
      const { orgStore } = seedMember();
      const before = readFileSync(orgStore, "utf8");
      const spelled = orgStore.replace("/mattstack/org/", "/mattstack/./teams/../org/");
      expect(spelled).not.toBe(orgStore);
      expect(renameRepoSection(spelled, OLD, NEW).status).toBe("refused");
      expect(readFileSync(orgStore, "utf8")).toBe(before);
    });
  });
});
