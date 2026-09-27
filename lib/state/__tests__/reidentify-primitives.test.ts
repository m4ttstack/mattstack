import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb, getKvValue, getStateDb, hasKvValue, setKvValue } from "../index.ts";
import { dropTableRows, moveKvKey, moveTableRows } from "../reidentify.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("reidentify primitives", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reidentify-home-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("moveKvKey moves a key and reads it back under the new one", () => {
    setKvValue("probe", OLD, { a: 1 });
    const r = moveKvKey("probe", OLD, NEW);
    expect(r).toMatchObject({ store: "kv:probe", status: "moved", count: 1 });
    expect(getKvValue<unknown>("probe", NEW, null)).toEqual({ a: 1 });
    expect(hasKvValue("probe", OLD)).toBe(false);
  });

  test("moveKvKey is already when only the new key exists, none when neither", () => {
    setKvValue("probe", NEW, 1);
    expect(moveKvKey("probe", OLD, NEW).status).toBe("already");
    expect(moveKvKey("other", OLD, NEW).status).toBe("none");
  });

  test("moveKvKey refuses when both keys exist and touches nothing", () => {
    setKvValue("probe", OLD, "o");
    setKvValue("probe", NEW, "n");
    const r = moveKvKey("probe", OLD, NEW);
    expect(r.status).toBe("refused");
    expect(r.detail).toBe("both populated");
    expect(getKvValue<unknown>("probe", OLD, null)).toBe("o");
    expect(getKvValue<unknown>("probe", NEW, null)).toBe("n");
  });

  test("moveKvKey finishes an interrupted move when both keys hold equal values", () => {
    setKvValue("probe", OLD, { a: [1, 2] });
    setKvValue("probe", NEW, { a: [1, 2] });
    expect(moveKvKey("probe", OLD, NEW, { dryRun: true }).status).toBe("moved");
    expect(hasKvValue("probe", OLD)).toBe(true);
    expect(moveKvKey("probe", OLD, NEW)).toMatchObject({ status: "moved", count: 1 });
    expect(hasKvValue("probe", OLD)).toBe(false);
    expect(getKvValue<unknown>("probe", NEW, null)).toEqual({ a: [1, 2] });
  });

  test("moveKvKey refuses an unparseable old value and writes nothing", () => {
    getStateDb().run("INSERT INTO kv (ns, k, v, updated_at) VALUES (?, ?, ?, ?)", ["probe", OLD, "{not json", Date.now()]);
    const r = moveKvKey("probe", OLD, NEW);
    expect(r).toMatchObject({ status: "refused", detail: `unparseable value under ${OLD}` });
    expect(hasKvValue("probe", OLD)).toBe(true);
    expect(hasKvValue("probe", NEW)).toBe(false);
  });

  test("moveTableRows reports a throwing write as refused", () => {
    const db = getStateDb();
    db.run(`CREATE TABLE IF NOT EXISTS probe_checked (repo TEXT NOT NULL CHECK (repo <> '${NEW}'))`);
    db.run("INSERT INTO probe_checked (repo) VALUES (?)", [OLD]);
    const r = moveTableRows("probe_checked", "repo", OLD, NEW, { db });
    expect(r.status).toBe("refused");
    expect(r.detail).toContain("CHECK constraint failed");
    expect((db.query("SELECT COUNT(*) AS c FROM probe_checked WHERE repo = ?").get(OLD) as { c: number }).c).toBe(1);
  });

  test("moveKvKey dry run reports moved without writing", () => {
    setKvValue("probe", OLD, 1);
    expect(moveKvKey("probe", OLD, NEW, { dryRun: true }).status).toBe("moved");
    expect(hasKvValue("probe", OLD)).toBe(true);
    expect(hasKvValue("probe", NEW)).toBe(false);
  });

  test("moveTableRows rewrites every row's column and counts them", () => {
    const db = getStateDb();
    db.run("CREATE TABLE IF NOT EXISTS probe_rows (repo TEXT NOT NULL, n INTEGER NOT NULL)");
    db.run("INSERT INTO probe_rows (repo, n) VALUES (?, 1), (?, 2), (?, 3)", [OLD, OLD, "remote:github.com%2Facme%2Fother"]);
    const r = moveTableRows("probe_rows", "repo", OLD, NEW, { db });
    expect(r).toMatchObject({ store: "probe_rows.repo", status: "moved", count: 2 });
    const rows = db.query("SELECT repo, n FROM probe_rows ORDER BY n").all() as { repo: string; n: number }[];
    expect(rows).toEqual([{ repo: NEW, n: 1 }, { repo: NEW, n: 2 }, { repo: "remote:github.com%2Facme%2Fother", n: 3 }]);
  });

  test("moveTableRows refuses when both identities hold rows", () => {
    const db = getStateDb();
    db.run("CREATE TABLE IF NOT EXISTS probe_rows (repo TEXT NOT NULL, n INTEGER NOT NULL)");
    db.run("INSERT INTO probe_rows (repo, n) VALUES (?, 1), (?, 2)", [OLD, NEW]);
    expect(moveTableRows("probe_rows", "repo", OLD, NEW, { db }).status).toBe("refused");
    expect((db.query("SELECT COUNT(*) AS c FROM probe_rows WHERE repo = ?").get(OLD) as { c: number }).c).toBe(1);
  });

  test("moveTableRows is none on a missing table", () => {
    expect(moveTableRows("no_such_table", "repo", OLD, NEW).status).toBe("none");
  });

  test("dropTableRows deletes the old identity's rows and reports the count", () => {
    const db = getStateDb();
    db.run("CREATE TABLE IF NOT EXISTS probe_cache (repo TEXT NOT NULL, v TEXT)");
    db.run("INSERT INTO probe_cache (repo, v) VALUES (?, 'a'), (?, 'b')", [OLD, OLD]);
    expect(dropTableRows("probe_cache", "repo", OLD, { db })).toMatchObject({ status: "moved", count: 2 });
    expect((db.query("SELECT COUNT(*) AS c FROM probe_cache").get() as { c: number }).c).toBe(0);
    expect(dropTableRows("probe_cache", "repo", OLD, { db }).status).toBe("none");
  });
});
