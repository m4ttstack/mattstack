import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { closeStateDb, setKvValue, getKvValue } from "../../state/index.ts";
import { saveRegistry, loadRegistry } from "../../worktree/registry.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../settings/identity.ts";
import { createRealProbes } from "../../setup/probes.ts";
import { createOrgHandlers, type OrgHandlerOpts } from "../handlers/org.ts";

describe("org:move", () => {
  const origHome = process.env.HOME;
  let home: string;
  let order: string[];
  let events: { topic: string; payload: unknown }[];
  let paused: string[][];
  let resumed: string[][];
  let opts: OrgHandlerOpts;
  let handlers: ReturnType<typeof createOrgHandlers>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-org-move-home-")));
    process.env.HOME = home;
    closeStateDb();
    order = [];
    events = [];
    paused = [];
    resumed = [];
    opts = {
      withReconcilerHeld: async (fn) => {
        order.push("hold-start");
        try {
          return await fn();
        } finally {
          order.push("hold-end");
        }
      },
      refreshWatchedRepos: () => order.push("refresh"),
      emitEvent: (topic, payload) => {
        order.push(`emit:${topic}`);
        events.push({ topic, payload });
      },
      teamSnapshots: {
        pause: async (slugs) => { order.push("pause"); paused.push(slugs); },
        resume: async (slugs) => { order.push("resume"); resumed.push(slugs); },
      },
    };
    handlers = createOrgHandlers(opts);
  });

  afterEach(() => {
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
  });

  function clone(root: string, folder: string, org: string, opts: { role?: "org" | "team"; origin?: string | null } = {}): string {
    const dir = join(home, ".mattstack", root, folder);
    mkdirSync(join(dir, "mattstack"), { recursive: true });
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    const origin = opts.origin === undefined ? `https://gitlab.example.com/${org}/org.git` : opts.origin;
    if (origin !== null) execSync(`git remote add origin ${origin}`, { cwd: dir, stdio: "pipe" });
    writeFileSync(join(dir, "mattstack", "mattstack.jsonc"), JSON.stringify({ role: opts.role ?? "org", org }));
    execSync("git add -A && git -c user.email=dev1@gitlab.example.com -c user.name=dev1 commit -q -m init", { cwd: dir, stdio: "pipe" });
    return dir;
  }

  async function register(dir: string): Promise<string> {
    const identity = serializeIdentity(await deriveRepoIdentity(dir));
    setKvValue("repo-index", identity, dir);
    saveRegistry(identity, [{ name: "main", path: dir, kind: "main", branch: "main", createdAt: "2026-01-01T00:00:00.000Z" }]);
    return identity;
  }

  /** An unrelated repo rt knows whose folder is gone: an unscoped locate then refuses a clone with no row of its own. */
  async function lostStranger(): Promise<void> {
    const dir = join(home, "stranger");
    mkdirSync(dir, { recursive: true });
    execSync("git init -q -b main", { cwd: dir, stdio: "pipe" });
    execSync("git remote add origin https://gitlab.example.com/gadgets/stranger.git", { cwd: dir, stdio: "pipe" });
    execSync("git -c user.email=dev1@gitlab.example.com -c user.name=dev1 commit --allow-empty -q -m init", { cwd: dir, stdio: "pipe" });
    await register(dir);
    rmSync(dir, { recursive: true, force: true });
  }

  const recordsDir = () => join(home, ".mattstack", "rt", "teams");

  test("moves a legacy clone under the hold, pausing both slugs, copying records first and resuming after", async () => {
    const from = clone("teams", "widgets", "acme");
    const identity = await register(from);
    mkdirSync(recordsDir(), { recursive: true });
    writeFileSync(join(recordsDir(), "widgets.json"), JSON.stringify({ forgeUsername: "dev1" }));
    const to = join(home, ".mattstack", "orgs", "acme");

    const res = await handlers["org:move"]({ from, to });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ ok: true, from, to, folderMoved: true, index: "moved", records: { teams: "copied", invites: "none" } });
    expect(existsSync(to)).toBe(true);
    expect(existsSync(from)).toBe(false);
    // cleanupMovedRecords rewrites the record through writeTeamLocal, which normalises it to the known fields.
    expect(JSON.parse(readFileSync(join(recordsDir(), "acme.json"), "utf8"))).toEqual({ createdByRt: false, joinedByRt: false, rtMayManageMembership: false, forgeUsername: "dev1" });
    expect(existsSync(join(recordsDir(), "widgets.json"))).toBe(false);
    expect(getKvValue<string | null>("repo-index", identity, null)).toBe(to);
    expect(loadRegistry(identity)[0]?.path).toBe(to);
    expect(paused).toEqual([["widgets", "acme"]]);
    expect(resumed).toEqual([["widgets", "acme"]]);
    expect(order).toEqual(["pause", "hold-start", "refresh", "emit:repo:moved", "emit:org:moved", "hold-end", "resume"]);
    expect(events[0]).toEqual({ topic: "repo:moved", payload: { identity, from, to } });
    expect(events[1]).toEqual({ topic: "org:moved", payload: { from, to } });
  });

  test("an unrelated lost repo does not block the move", async () => {
    await lostStranger();
    const from = clone("teams", "widgets", "acme");
    const identity = await register(from);
    const to = join(home, ".mattstack", "orgs", "acme");
    const res = await handlers["org:move"]({ from, to });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ folderMoved: true, index: "moved" });
    expect(getKvValue<string | null>("repo-index", identity, null)).toBe(to);
  });

  test("a clone rt never registered moves with index already, even beside a lost repo and even with no origin", async () => {
    await lostStranger();
    const from = clone("teams", "acme", "acme", { role: "team", origin: null });
    const res = await handlers["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ folderMoved: true, index: "already", records: { teams: "none", invites: "none" } });
    expect(order).toEqual(["pause", "hold-start", "emit:org:moved", "hold-end", "resume"]);
  });

  test("a relocation refusal fails the move after the rename, and the engine still resumes", async () => {
    const from = clone("teams", "widgets", "acme");
    const identity = await register(from);
    // The registered row still points at a folder that exists: planLocate answers old-path-exists for this identity.
    const decoy = join(home, "decoy");
    mkdirSync(decoy, { recursive: true });
    setKvValue("repo-index", identity, decoy);
    const res = await handlers["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "move-failed" } });
    expect(res.failure.message).toContain("old-path-exists");
    expect(order).toEqual(["pause", "hold-start", "hold-end", "resume"]);
  });

  test("a cleanup failure after a real move still refreshes watchers and emits repo:moved, but not org:moved", async () => {
    const from = clone("teams", "widgets", "acme");
    const identity = await register(from);
    mkdirSync(recordsDir(), { recursive: true });
    writeFileSync(join(recordsDir(), "widgets.json"), JSON.stringify({ forgeUsername: "dev1" }));
    const to = join(home, ".mattstack", "orgs", "acme");
    const real = createRealProbes();
    const failing = createOrgHandlers({ ...opts, probes: { ...real, removeFile: () => { throw new Error("removal refused"); } } });

    const res = await failing["org:move"]({ from, to });
    expect(res).toMatchObject({ ok: false, failure: { code: "move-failed" }, data: { ok: false, stage: "cleanup", folderMoved: true } });
    expect(res.failure.message).toContain("cleanup");
    expect(existsSync(to)).toBe(true);
    expect(getKvValue<string | null>("repo-index", identity, null)).toBe(to);
    expect(order.filter((step) => step === "refresh")).toHaveLength(1);
    expect(events).toEqual([{ topic: "repo:moved", payload: { identity, from, to } }]);
    expect(resumed).toEqual([["widgets", "acme"]]);
  });

  test("a tracked file changed after the step's check is refused as dirty inside the hold, and the engine still resumes", async () => {
    const from = clone("teams", "widgets", "acme");
    writeFileSync(join(from, "mattstack", "mattstack.jsonc"), `${JSON.stringify({ role: "org", org: "acme" })}\n`);
    const res = await handlers["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "dirty" } });
    expect(res.failure.message).toContain("uncommitted changes");
    expect(existsSync(from)).toBe(true);
    expect(order).toEqual(["pause", "hold-start", "hold-end", "resume"]);
    expect(resumed).toEqual([["widgets", "acme"]]);
  });

  test("a clone left mid-rebase is refused as rebasing inside the hold, and the engine still resumes", async () => {
    const from = clone("teams", "widgets", "acme");
    mkdirSync(join(from, ".git", "rebase-merge"), { recursive: true });
    const res = await handlers["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "rebasing" } });
    expect(existsSync(from)).toBe(true);
    expect(order).toEqual(["pause", "hold-start", "hold-end", "resume"]);
    expect(resumed).toEqual([["widgets", "acme"]]);
  });

  test("a git status that cannot be read is refused as status-unreadable", async () => {
    const from = clone("teams", "widgets", "acme");
    const broken = createOrgHandlers({ ...opts, exec: async () => ({ code: 128, stdout: "", stderr: "fatal: detected dubious ownership" }) });
    const res = await broken["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "status-unreadable" } });
    expect(res.failure.message).toContain("dubious ownership");
    expect(existsSync(from)).toBe(true);
    expect(order).toEqual(["pause", "hold-start", "hold-end", "resume"]);
  });

  test("refuses a target outside the orgs root", async () => {
    const from = clone("teams", "acme", "acme");
    const res = await handlers["org:move"]({ from, to: join(home, "elsewhere", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "to-outside-orgs" } });
    expect(order).toEqual([]);
    expect(existsSync(from)).toBe(true);
  });

  test("refuses a source outside ~/.mattstack, a marker that names another org, a missing source and a missing field", async () => {
    const outside = mkdtempSync(join(tmpdir(), "rt-org-move-outside-"));
    try {
      expect(await handlers["org:move"]({ from: outside, to: join(home, ".mattstack", "orgs", "acme") })).toMatchObject({ ok: false, failure: { code: "from-outside-home" } });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    const from = clone("teams", "widgets", "widgets");
    expect(await handlers["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") })).toMatchObject({ ok: false, failure: { code: "marker-mismatch" } });
    expect(await handlers["org:move"]({ from: join(home, ".mattstack", "teams", "gadgets"), to: join(home, ".mattstack", "orgs", "gadgets") })).toMatchObject({ ok: false, failure: { code: "from-missing" } });
    expect(await handlers["org:move"]({ to: join(home, ".mattstack", "orgs", "acme") })).toMatchObject({ ok: false, failure: { code: "from-required" } });
    expect(order).toEqual([]);
  });

  test("refuses when the target already exists", async () => {
    const from = clone("teams", "widgets", "acme");
    clone("orgs", "acme", "acme");
    const res = await handlers["org:move"]({ from, to: join(home, ".mattstack", "orgs", "acme") });
    expect(res).toMatchObject({ ok: false, failure: { code: "to-exists" } });
    expect(existsSync(from)).toBe(true);
    expect(order).toEqual([]);
  });
});
