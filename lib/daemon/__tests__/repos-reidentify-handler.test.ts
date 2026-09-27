import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { REPO_INDEX_NS, loadRepoIndex } from "../../repo-index.ts";
import { clearIdentityMemo, deriveRepoIdentity, serializeIdentity } from "../../settings/identity.ts";
import { closeStateDb, setKvValue } from "../../state/index.ts";
import { createReposHandlers } from "../handlers/repos.ts";

const OLD = "remote:github.com%2Facme%2Fold";
const NEW = "remote:github.com%2Facme%2Fnew";

describe("repos:reidentify", () => {
  const origHome = process.env.HOME;
  let home: string;
  let held: number;
  let events: { topic: string; payload: unknown }[];
  let handlers: ReturnType<typeof createReposHandlers>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-reid-handler-")));
    process.env.HOME = home;
    closeStateDb();
    clearIdentityMemo();
    held = 0;
    events = [];
    handlers = createReposHandlers({
      withReconcilerHeld: async (fn) => { held++; return fn(); },
      refreshWatchedRepos: () => {},
      emitEvent: (topic, payload) => events.push({ topic, payload }),
    });
  });
  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  test("runs inside the reconciler hold, moves the index row, emits repo:reidentified", async () => {
    setKvValue(REPO_INDEX_NS, OLD, "/x");
    const res = await handlers["repos:reidentify"]({ from: "github.com/acme/old", to: "github.com/acme/new" });
    expect(res.ok).toBe(true);
    expect(held).toBe(1);
    expect(loadRepoIndex()[NEW]).toBe("/x");
    expect(events).toEqual([{ topic: "repo:reidentified", payload: { from: OLD, to: NEW } }]);
  });

  test("dry run emits nothing and moves nothing", async () => {
    setKvValue(REPO_INDEX_NS, OLD, "/x");
    const res = await handlers["repos:reidentify"]({ from: OLD, to: NEW, dryRun: true });
    expect(res.ok).toBe(true);
    expect(res.data.dryRun).toBe(true);
    expect(loadRepoIndex()[OLD]).toBe("/x");
    expect(events).toEqual([]);
  });

  test("missing identities are a payload error", async () => {
    const res = await handlers["repos:reidentify"]({ from: OLD });
    expect(res).toEqual({ ok: false, error: "from-and-to-required" });
  });

  test("a non-dry run clears the identity memo so an unmoved checkout derives the new identity", async () => {
    const dir = join(home, "checkout");
    mkdirSync(dir, { recursive: true });
    execSync("git init -q -b main && git remote add origin https://github.com/acme/old.git", { cwd: dir, stdio: "pipe" });
    expect(serializeIdentity(await deriveRepoIdentity(dir))).toBe(OLD);
    execSync("git remote set-url origin https://github.com/acme/new.git", { cwd: dir, stdio: "pipe" });
    expect(serializeIdentity(await deriveRepoIdentity(dir))).toBe(OLD);

    setKvValue(REPO_INDEX_NS, OLD, dir);
    const res = await handlers["repos:reidentify"]({ from: OLD, to: NEW });
    expect(res.ok).toBe(true);
    expect(serializeIdentity(await deriveRepoIdentity(dir))).toBe(NEW);
  });

  test("a refused store is ok:false with the report attached", async () => {
    setKvValue(REPO_INDEX_NS, OLD, "/x");
    setKvValue(REPO_INDEX_NS, NEW, "/y");
    const res = await handlers["repos:reidentify"]({ from: OLD, to: NEW });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("refused");
    expect(res.data.stores.find((s: { store: string }) => s.store === "kv:repo-index").status).toBe("refused");
  });
});
