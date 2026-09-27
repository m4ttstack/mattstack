import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
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
});
