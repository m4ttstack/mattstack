import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { REPO_INDEX_NS, loadRepoIndex } from "../repo-index.ts";
import { loadMachineRepoTrackingRaw, saveRepoTrackingRaw } from "../repo-tracking.ts";
import { repoDataDir, rtDir } from "../rt-paths.ts";
import { closeStateDb, getKvValue, getStateDb, setKvValue } from "../state/index.ts";
import { CURSOR_NS } from "../state/cursors-store.ts";
import { getSetting } from "../settings/resolve.ts";
import { setSetting } from "../settings/write.ts";
import { loadRegistry, saveRegistry, type TreeRecord } from "../worktree/registry.ts";
import { machineSettingsPath, teamsDir, userSettingsPath } from "../../packages/rt-client/src/settings/paths.ts";
import { readStore } from "../../packages/rt-client/src/settings/stores.ts";
import { normalizeIdentityArg, reidentify } from "../repo-reidentify.ts";

const OLD_RAW = "github.com/acme/old";
const NEW_RAW = "github.com/acme/new";
const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("normalizeIdentityArg", () => {
  test("accepts raw and serialized forms and refuses path-kind", () => {
    expect(normalizeIdentityArg(OLD_RAW)).toEqual({ serialized: OLD, raw: OLD_RAW });
    expect(normalizeIdentityArg(OLD)).toEqual({ serialized: OLD, raw: OLD_RAW });
    expect(normalizeIdentityArg("path:%2Ftmp%2Fx")).toBeNull();
    expect(normalizeIdentityArg("")).toBeNull();
  });

  test("normalizes every raw remote spelling onto the one identity", () => {
    for (const form of [
      "GitHub.com/acme/old",
      "github.com/acme/old.git",
      "github.com/acme/old/",
      "github.com/acme/old.git/",
      "https://github.com/acme/old.git",
      "git@github.com:acme/old.git",
    ]) {
      expect(normalizeIdentityArg(form)).toEqual({ serialized: OLD, raw: OLD_RAW });
    }
  });

  test("refuses a malformed wire and a local path", () => {
    expect(normalizeIdentityArg("remote:bad%zz")).toBeNull();
    expect(normalizeIdentityArg("/tmp/acme/old")).toBeNull();
  });
});

describe("reidentify", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reidentify-")));
    process.env.HOME = home;
    closeStateDb();
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  /** Seeds one row in every store under `id`. */
  function seedAll(id: string, raw: string): void {
    // The settings files go first: rt.repoTracking lives in the machine store,
    // so writing that file after saveRepoTrackingRaw would erase the grant.
    mkdirSync(join(machineSettingsPath(), ".."), { recursive: true });
    writeFileSync(machineSettingsPath(), `{ "repos": { "${raw}": { "rt.worktrees": { "onDeck": 1 } } } }\n`);
    mkdirSync(join(userSettingsPath(), ".."), { recursive: true });
    writeFileSync(userSettingsPath(), `{ "repos": { "${raw}": { "rt.mr": { "a": 1 } } } }\n`);
    setKvValue(REPO_INDEX_NS, id, join(home, "checkout"));
    mkdirSync(repoDataDir(id), { recursive: true });
    writeFileSync(join(repoDataDir(id), "run-history.jsonl"), `{"ts":"2026-01-01T00:00:00Z","id":"r1"}\n`);
    const tree: TreeRecord = { name: "main", path: join(home, "checkout"), kind: "main", branch: "main", state: "claimed", createdAt: "2026-01-01T00:00:00.000Z" } as TreeRecord;
    saveRegistry(id, [tree]);
    saveRepoTrackingRaw({ [id]: { mode: "full" } });
    setSetting("rt.workspacePrefs", { editors: { [id]: "zed" }, workspaces: {}, defaultEditor: "cursor" }, "machine");
    setKvValue(CURSOR_NS, id, 42);
    const db = getStateDb();
    db.run(
      "INSERT INTO run_history (repo, ts, cmd, cwd, worktree, branch, pkg, script, exit) VALUES (?, '2026-01-01T00:00:00Z', 'bun test', '/c', '/c', 'main', 'rt', 'test', 0)",
      [id],
    );
    db.run("INSERT INTO git_badges (repo, worktree, badge, updated_at) VALUES (?, '/c', '{}', 1)", [id]);
    mkdirSync(rtDir(), { recursive: true });
    const herds = new Database(join(rtDir(), "herds.db"), { create: true });
    herds.run("CREATE TABLE IF NOT EXISTS herds (id TEXT PRIMARY KEY, repo TEXT NOT NULL)");
    herds.run("INSERT OR REPLACE INTO herds (id, repo) VALUES ('h1', ?)", [id]);
    herds.close();
  }

  test("moves every store and reads each back under the new identity", async () => {
    seedAll(OLD, OLD_RAW);
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(true);
    const byStore = Object.fromEntries(r.stores.map((s) => [s.store, s.status]));
    expect(byStore["kv:repo-index"]).toBe("moved");
    expect(byStore["data-dir"]).toBe("moved");
    expect(byStore["rt.repoTracking"]).toBe("moved");
    expect(byStore["kv:events-cursor"]).toBe("moved");
    expect(byStore["run_history.repo"]).toBe("moved");
    expect(byStore["git_badges.repo"]).toBe("moved");
    expect(byStore["herds.repo"]).toBe("moved");
    expect(byStore["settings:machine"]).toBe("moved");
    expect(byStore["settings:user"]).toBe("moved");
    expect(byStore["settings:workspacePrefs.editors"]).toBe("moved");
    expect(getSetting<unknown>("rt.workspacePrefs").value).toEqual({ editors: { [NEW]: "zed" }, workspaces: {}, defaultEditor: "cursor" });
    expect(Object.keys(JSON.parse(readFileSync(join(rtDir(), "repos.json"), "utf8")))).toEqual([NEW]);
    expect(loadRepoIndex()[NEW]).toBe(join(home, "checkout"));
    expect(loadRepoIndex()[OLD]).toBeUndefined();
    expect(loadRegistry(NEW).map((t) => t.name)).toEqual(["main"]);
    expect(loadRegistry(OLD)).toEqual([]);
    expect(loadMachineRepoTrackingRaw()[NEW]).toEqual({ mode: "full" });
    expect(getKvValue<unknown>(CURSOR_NS, NEW, null)).toBe(42);
    const db = getStateDb();
    expect((db.query("SELECT COUNT(*) AS c FROM run_history WHERE repo = ?").get(NEW) as { c: number }).c).toBe(1);
    expect((db.query("SELECT COUNT(*) AS c FROM git_badges").get() as { c: number }).c).toBe(0);
    const herds = new Database(join(rtDir(), "herds.db"), { readonly: true });
    expect((herds.query("SELECT repo FROM herds WHERE id = 'h1'").get() as { repo: string }).repo).toBe(NEW);
    herds.close();
    expect(readStore(machineSettingsPath()).repos[NEW_RAW]).toEqual({ "rt.worktrees": { onDeck: 1 } });
    expect(readStore(userSettingsPath()).repos[NEW_RAW]).toEqual({ "rt.mr": { a: 1 } });
  });

  test("a second run is already or none everywhere and still ok", async () => {
    seedAll(OLD, OLD_RAW);
    await reidentify(OLD_RAW, NEW_RAW);
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(true);
    expect(r.stores.every((s) => s.status === "already" || s.status === "none")).toBe(true);
  });

  test("nothing under the old identity is ok with all none", async () => {
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(true);
    expect(r.stores.every((s) => s.status === "none")).toBe(true);
  });

  test("one store populated on both sides is refused there, moved elsewhere, and not ok", async () => {
    seedAll(OLD, OLD_RAW);
    saveRepoTrackingRaw({ [OLD]: { mode: "full" }, [NEW]: { mode: "off" } });
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(false);
    const tracking = r.stores.find((s) => s.store === "rt.repoTracking")!;
    expect(tracking.status).toBe("refused");
    expect(r.stores.find((s) => s.store === "kv:repo-index")!.status).toBe("moved");
    expect(loadMachineRepoTrackingRaw()[OLD]).toEqual({ mode: "full" });
  });

  test("dry run writes nothing and reports moved with counts", async () => {
    seedAll(OLD, OLD_RAW);
    const r = await reidentify(OLD_RAW, NEW_RAW, { dryRun: true });
    if ("error" in r) throw new Error(r.error);
    expect(r.dryRun).toBe(true);
    expect(r.stores.find((s) => s.store === "run_history.repo")).toMatchObject({ status: "moved", count: 1 });
    expect(loadRepoIndex()[OLD]).toBe(join(home, "checkout"));
    expect(readStore(machineSettingsPath()).repos[OLD_RAW]).toBeDefined();
  });

  test("a store that throws is refused there and the rest still move", async () => {
    seedAll(OLD, OLD_RAW);
    writeFileSync(join(rtDir(), "herds.db"), "not a sqlite database, just bytes long enough to have a header............");
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.ok).toBe(false);
    const herds = r.stores.find((s) => s.store === "herds.repo")!;
    expect(herds.status).toBe("refused");
    expect(herds.detail).toBeTruthy();
    expect(r.stores.find((s) => s.store === "settings:user")!.status).toBe("moved");
  });

  test("a data dir move that fails partway is refused, not reported moved", async () => {
    seedAll(OLD, OLD_RAW);
    mkdirSync(repoDataDir(NEW), { recursive: true });
    chmodSync(repoDataDir(NEW), 0o555);
    try {
      const r = await reidentify(OLD_RAW, NEW_RAW);
      if ("error" in r) throw new Error(r.error);
      expect(r.ok).toBe(false);
      const dataDir = r.stores.find((s) => s.store === "data-dir")!;
      expect(dataDir.status).toBe("refused");
      expect(dataDir.detail).toContain("run-history.jsonl");
    } finally {
      chmodSync(repoDataDir(NEW), 0o755);
    }
  });

  test("an unreadable old data dir is refused, not reported none", async () => {
    seedAll(OLD, OLD_RAW);
    chmodSync(repoDataDir(OLD), 0o000);
    try {
      const r = await reidentify(OLD_RAW, NEW_RAW);
      if ("error" in r) throw new Error(r.error);
      expect(r.stores.find((s) => s.store === "data-dir")!.status).toBe("refused");
    } finally {
      chmodSync(repoDataDir(OLD), 0o755);
    }
  });

  test("a data dir already under the new identity reports already", async () => {
    seedAll(OLD, OLD_RAW);
    await reidentify(OLD_RAW, NEW_RAW);
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.stores.find((s) => s.store === "data-dir")!.status).toBe("already");
  });

  test("a teams dir that cannot be listed is refused", async () => {
    mkdirSync(teamsDir(), { recursive: true });
    chmodSync(teamsDir(), 0o000);
    try {
      const r = await reidentify(OLD_RAW, NEW_RAW);
      if ("error" in r) throw new Error(r.error);
      expect(r.ok).toBe(false);
      expect(r.stores.find((s) => s.store === "settings:teams")!.status).toBe("refused");
    } finally {
      chmodSync(teamsDir(), 0o755);
    }
  });

  test("editor prefs: equal entries under both keys finish, different ones are refused and kept", async () => {
    mkdirSync(join(machineSettingsPath(), ".."), { recursive: true });
    setSetting("rt.workspacePrefs", { editors: { [OLD]: "zed", [NEW]: "zed" }, workspaces: {} }, "machine");
    let r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.stores.find((s) => s.store === "settings:workspacePrefs.editors")!.status).toBe("moved");
    expect(getSetting<{ editors: Record<string, string> }>("rt.workspacePrefs").value.editors).toEqual({ [NEW]: "zed" });

    setSetting("rt.workspacePrefs", { editors: { [OLD]: "zed", [NEW]: "code" }, workspaces: {} }, "machine");
    r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.stores.find((s) => s.store === "settings:workspacePrefs.editors")).toMatchObject({ status: "refused", detail: "both populated" });
    expect(getSetting<{ editors: Record<string, string> }>("rt.workspacePrefs").value.editors).toEqual({ [OLD]: "zed", [NEW]: "code" });
  });

  test("editor prefs in an unparseable machine store are refused", async () => {
    mkdirSync(join(machineSettingsPath(), ".."), { recursive: true });
    writeFileSync(machineSettingsPath(), `{ "rt.workspacePrefs": { "editors": { "${OLD}": "zed" } }\n`);
    const r = await reidentify(OLD_RAW, NEW_RAW);
    if ("error" in r) throw new Error(r.error);
    expect(r.stores.find((s) => s.store === "settings:workspacePrefs.editors")!.status).toBe("refused");
  });

  test("refuses a path-kind identity", async () => {
    const r = await reidentify("path:%2Ftmp%2Fx", NEW_RAW);
    expect("error" in r && r.error).toContain("remote");
  });
});
