import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";
import { getSetting, serializeIdentity } from "../../packages/rt-client/src/index.ts";
import { childEnv } from "../../lib/subprocess.ts";
import type { SecretsSeams } from "../../lib/secrets/store.ts";
import { createApplyContext, runUpdate, type ApplyContext } from "../../lib/setup/apply.ts";
import type { ApplyEvent } from "../../lib/setup/contract.ts";
import { createRealProbes, type Probes } from "../../lib/setup/probes.ts";
import { readSetupState, updateSetupState } from "../../lib/setup/state.ts";
import { updateRepoIndex } from "../../lib/repo-index.ts";
import { writeTeamLocal } from "../../lib/team/team-local.ts";
import type { RelayClient } from "../../lib/team/relay-client.ts";
import { rtHealthRows } from "../../lib/setup/validators/rt-health.ts";
import { composePlan } from "../../lib/setup/plan.ts";
import { leftForMemberIn } from "../../lib/setup/steps/verify.ts";
import { rowsToChecks } from "../verify.ts";
import { startSnapshot, teamSnapshotSpec } from "../../lib/daemon/home-snapshot.ts";
import { createOnPulled } from "../../lib/daemon/team-snapshots.ts";
import { convergePackCache } from "../../lib/setup/pack-cache.ts";
import { createMaterializePullHook } from "../../lib/daemon/materialize-pull-hook.ts";
import { composePullHooks } from "../../lib/daemon/pull-hooks.ts";
import { openStateDb } from "../../lib/state/db.ts";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";

const ORIG_HOME = process.env.HOME;
const ENGINE_PACK_DIR = resolve(import.meta.dir, "..", "..", "plugins", "mattstack");
const SDM_MIGRATION = "2026-10-07-sdm-resources-key";
/** The plugins every v2.21.0 Mac already has from the app's own marketplace. */
const TRUSTED_PLUGINS = ["mattstack@mattstack", "fast-browser@mattstack", "chat@mattstack"];
const BOARD_ENGINE = "board:review";
const SDM_RESOURCES = { "acme-db-qa": { label: "QA" } };
let home: string;
let origin: string;
const marketplaces = new Map<string, string>();
const installed = new Map<string, { enabled: boolean; version: string }>();
const GIT_ENV = { ...childEnv(), GIT_AUTHOR_NAME: "dev1", GIT_AUTHOR_EMAIL: "dev1@example.com", GIT_COMMITTER_NAME: "dev1", GIT_COMMITTER_EMAIL: "dev1@example.com" };
const gitEnv = () => ({ ...GIT_ENV, HOME: home });
const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env: gitEnv(), encoding: "utf8" }).trim();
const gitAt = (args: string[]) => execFileSync("git", args, { env: gitEnv(), encoding: "utf8" });
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const writeJson = (file: string, value: unknown) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };

const SECRETS: SecretsSeams = {
  ageKeySeam: { run: async () => ok() },
  execSeam: {
    run: async () => ok(),
    fileExists: () => false, statFile: () => null, readFile: () => "", writeFile: () => {},
    ensureDir: () => {}, chmod: () => {}, fsyncAndRename: () => {}, removeFile: () => {},
  },
};

const NO_RELAY: RelayClient = {
  create: async () => { throw new Error("no relay in this harness"); },
  fetch: async () => { throw new Error("no relay in this harness"); },
  redeem: async () => { throw new Error("no relay in this harness"); },
  reply: async () => {},
  readReply: async () => { throw new Error("no relay in this harness"); },
  delete: async () => { throw new Error("no relay in this harness"); },
};

function fakeLog() {
  const calls: { level: string; args: unknown[] }[] = [];
  const mk = (level: string) => (...args: unknown[]) => { calls.push({ level, args }); };
  return { calls, info: mk("info"), warn: mk("warn"), error: mk("error"), debug: mk("debug"), child: () => fakeLog() } as unknown as import("pino").Logger & { calls: typeof calls };
}

/** The one-team layout as v2.21.0 wrote it, committed to a bare origin. */
function seedOrigin(): void {
  origin = join(home, "origin.git");
  gitAt(["init", "--bare", "-q", "-b", "main", origin]);
  const work = join(home, "seed");
  gitAt(["clone", "-q", origin, work]);
  writeJson(join(work, "mattstack", "mattstack.jsonc"), { role: "team", namespace: "widgets", org: "acme" });
  writeJson(join(work, "mattstack", "settings.team.jsonc"), { "mattstack.integrations": { forge: { provider: "gitlab", host: "gitlab.example.com" } }, "board.projects": ["acme/widgets"], "board.gitlabHost": "https://gitlab.example.com", "rt.sdmEnrichment": SDM_RESOURCES });
  writeJson(join(work, "mattstack", "team.jsonc"), { projects: ["acme/widgets"] });
  writeJson(join(work, "mattstack", "packs", "widgets", ".claude-plugin", "plugin.json"), { name: "widgets", version: "0.1.0" });
  writeJson(join(work, "mattstack", "packs", "widgets", "pack", "skills.jsonc"), { version: 1, bindings: { [BOARD_ENGINE]: { review: "widgets:board-review" } } });
  writeJson(join(work, ".claude-plugin", "marketplace.json"), { name: "widgets", owner: { name: "Acme" }, plugins: [{ name: "widgets", source: "./mattstack/packs/widgets" }] });
  git(work, ["add", "-A"]); git(work, ["commit", "-q", "-m", "one-team layout"]); git(work, ["push", "-q", "origin", "main"]);
  rmSync(work, { recursive: true, force: true });
}

/** The converted org layout pushed onto origin main. Stands in for the admin's conversion commit: sdm.resources is written here because that is where the key moves; a member's Mac only reads it. */
function convertOrigin(): void {
  const work = join(home, "convert");
  gitAt(["clone", "-q", origin, work]);
  rmSync(join(work, "mattstack"), { recursive: true, force: true });
  writeJson(join(work, "mattstack", "mattstack.jsonc"), { role: "org", org: "acme" });
  writeJson(join(work, "mattstack", "org", "settings.org.jsonc"), { "mattstack.integrations": { forge: { provider: "gitlab", host: "gitlab.example.com" } }, "mattstack.org": { admins: ["admin1"], teams: { widgets: { owners: ["admin1"] } } }, "mattstack.roster": [{ username: "dev1", teams: ["widgets"] }], "board.projects": ["acme/widgets"], "board.gitlabHost": "https://gitlab.example.com" });
  writeJson(join(work, "mattstack", "org", "packs", "acme-base", "pack", "skills.jsonc"), { version: 1, base: true });
  writeJson(join(work, "mattstack", "org", "packs", "acme-base", "attachments", "shared-note", "SKILL.md"), "# shared");
  writeJson(join(work, "mattstack", "teams", "widgets", "settings.team.jsonc"), { "sdm.resources": SDM_RESOURCES });
  writeJson(join(work, "mattstack", "teams", "widgets", "plugin", ".claude-plugin", "plugin.json"), { name: "widgets", version: "0.1.1" });
  writeJson(join(work, "mattstack", "teams", "widgets", "plugin", "pack", "skills.jsonc"), { version: 1, extends: "acme-base", bindings: { [BOARD_ENGINE]: { review: "widgets:board-review" } } });
  writeJson(join(work, ".claude-plugin", "marketplace.json"), { name: "widgets", owner: { name: "Acme" }, plugins: [{ name: "widgets", source: "./mattstack/teams/widgets/plugin" }] });
  git(work, ["add", "-A"]); git(work, ["commit", "-q", "-m", "org layout"]); git(work, ["push", "-q", "origin", "main"]);
  rmSync(work, { recursive: true, force: true });
}

/** A member's ~/.mattstack as v2.21.0 left it. */
function legacyMemberHome(): { clone: string; bindings: string } {
  const clone = join(home, ".mattstack", "teams", "widgets");
  gitAt(["clone", "-q", origin, clone]);
  const p = { ...createRealProbes(), home };
  writeTeamLocal(p, "widgets", { joinedByRt: true, createdByRt: false, rtMayManageMembership: false, agePublicKey: "age1placeholder" });
  updateSetupState(p, (s) => ({ ...s, finishedAt: "2026-09-01T00:00:00.000Z", lastApplyOk: true, lastUpdate: { version: "2.21.0", at: "2026-09-01T00:00:00.000Z" } }));
  const repo = join(home, "src", "widgets");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-q"]); git(repo, ["remote", "add", "origin", "https://gitlab.example.com/acme/widgets.git"]);
  updateRepoIndex(serializeIdentity({ kind: "remote", id: "gitlab.example.com/acme/widgets" }), repo);
  const bindings = join(home, ".mattstack", "repos", "gitlab.example.com-acme-widgets", "packs", "widgets", "skills.jsonc");
  writeJson(bindings, { version: 1, bindings: { [BOARD_ENGINE]: { review: "widgets:board-review" } } });
  marketplaces.set("widgets", clone);
  installed.set("widgets@widgets", { enabled: true, version: "0.1.0" });
  for (const id of TRUSTED_PLUGINS) installed.set(id, { enabled: true, version: "1.0.0" });
  mkdirSync(join(home, "bin"), { recursive: true });
  writeFileSync(join(home, "bin", "claude"), "#!/bin/sh\n", { mode: 0o755 });
  return { clone, bindings };
}

/** A bindings file materialize wrote from the org layout: its generated header names the zone, and the team's board fill survives the merge. */
function expectMaterialized(bindings: string): void {
  const text = readFileSync(bindings, "utf8");
  expect(text).toContain("// zone: acme/widgets");
  const manifest = JSON.parse(text.split("\n").filter((line) => !line.startsWith("//")).join("\n")) as { bindings: Record<string, Record<string, string>> };
  expect(manifest.bindings[BOARD_ENGINE]).toEqual({ review: "widgets:board-review" });
}

function marketplaceDoc(dir: string): { name: string; plugins: { name: string; source: string }[] } | null {
  try {
    return JSON.parse(readFileSync(join(dir, ".claude-plugin", "marketplace.json"), "utf8"));
  } catch {
    return null;
  }
}

/** The plugin version the named marketplace serves right now, read from its directory. */
function servedVersion(id: string): string | null {
  const [plugin, market] = id.split("@");
  const dir = market ? marketplaces.get(market) : undefined;
  const doc = dir ? marketplaceDoc(dir) : null;
  const entry = doc?.plugins.find((pl) => pl.name === plugin);
  if (!dir || !entry) return null;
  try {
    return (JSON.parse(readFileSync(join(dir, entry.source, ".claude-plugin", "plugin.json"), "utf8")) as { version: string }).version;
  } catch {
    return null;
  }
}

function fakeClaude(argv: string[]) {
  const [, , verb, sub, target] = argv;
  if (verb === "list") return ok(JSON.stringify([...installed].map(([id, s]) => ({ id, enabled: s.enabled, version: s.version }))));
  if (verb === "marketplace" && sub === "list") return ok(JSON.stringify([...marketplaces].map(([name, path]) => ({ name, source: "directory", path }))));
  if (verb === "marketplace" && sub === "add" && target) {
    const name = marketplaceDoc(target)?.name ?? basename(target);
    marketplaces.set(name, target);
    return ok(`Successfully added marketplace: ${name}`);
  }
  if (verb === "marketplace" && sub === "remove" && target) {
    marketplaces.delete(target);
    for (const id of [...installed.keys()]) if (id.endsWith(`@${target}`)) installed.delete(id);
    return ok();
  }
  if ((verb === "install" || verb === "update") && sub) {
    const version = servedVersion(sub) ?? installed.get(sub)?.version ?? "0.0.0";
    installed.set(sub, { enabled: verb === "install" || (installed.get(sub)?.enabled ?? true), version });
    return ok();
  }
  if ((verb === "enable" || verb === "disable") && sub) {
    const cur = installed.get(sub);
    if (cur) installed.set(sub, { ...cur, enabled: verb === "enable" });
    return ok();
  }
  return ok();
}

function probes(): Probes {
  const real = createRealProbes();
  return {
    ...real,
    home,
    env: { HOME: home, PATH: join(home, "bin"), USER: "dev1", RT_ENGINE_PACK_DIR: ENGINE_PACK_DIR },
    exists: (path) => !path.startsWith("/Applications/") && real.exists(path),
    exec: async (argv, opts) => {
      const bin = basename(argv[0]!);
      if (bin === "git") return real.exec(argv, { ...opts, env: { ...gitEnv(), ...(opts?.env ?? {}) } });
      if (bin === "gh" || bin === "glab") return ok(JSON.stringify({ login: "dev1", username: "dev1" }));
      if (bin === "claude") return fakeClaude(argv);
      return ok();
    },
    daemon: async () => null,
    tray: async () => ({ status: 0, json: null }),
    fetch: async () => ({ status: 0, body: "", headers: {} }),
    runRt: async () => { throw new Error("No rt subprocess is allowed in this harness"); },
  };
}

async function context(p: Probes, events: ApplyEvent[], opts: { update?: true } = {}): Promise<ApplyContext> {
  return createApplyContext({
    probes: p,
    emit: (event) => { events.push(event); },
    secrets: SECRETS,
    teamSecrets: () => SECRETS,
    relay: NO_RELAY,
    secretPresence: { has: async () => null },
    flags: { nonInteractive: true, teamOfOne: false, ci: false, ...(opts.update ? { update: true as const } : {}) },
  });
}

/**
 * The verify checks a temp HOME cannot pass: no app bundle or tray, no
 * daemon (the harness answers null so org.pull reports it not running), no
 * network, a file:// origin the access probe refuses, and exec faked for every
 * tool but git and claude. Every other required row (the org, team, pack,
 * plugin and skills rows) must pass.
 */
const MACHINE_ONLY_CHECKS = new Set(["perm.fda", "perm.login-items", "tool.macos", "tool.arch", "tool.herdr", "tool.claude", "tool.fast-browser", "tool.app", "tool.daemon", "access.team-repo", "access.forge"]);

/** No failed and no needs-you outcome; verify may fail only on the machine checks, read with verify's own inputs and its own member-task rule. */
async function expectCleanRun(run: Awaited<ReturnType<typeof runUpdate>>, ctx: ApplyContext): Promise<void> {
  const others = run.outcomes.filter((o) => o.id !== "verify");
  expect(others.filter((o) => o.state === "failed" || o.state === "needs-you")).toEqual([]);
  expect(run.failedSteps.filter((id) => id !== "verify")).toEqual([]);
  const plan = await composePlan({ p: ctx.p, secrets: ctx.secretPresence, ci: false, mode: "status", orgs: ctx.team.slug ? [ctx.team.slug] : [] });
  const rows = plan.groups.flatMap((g) => g.rows);
  const leftForMember = leftForMemberIn(rows);
  const failing = rowsToChecks(plan, { ci: false }).filter((c) => c.status === "fail" && c.severity === "critical" && !leftForMember(c.name)).map((c) => c.name);
  expect(failing.filter((name) => !MACHINE_ONLY_CHECKS.has(name))).toEqual([]);
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rt-member-upgrade-")));
  process.env.HOME = home;
  marketplaces.clear();
  installed.clear();
  seedOrigin();
});

afterEach(() => {
  closeStateDb();
  process.env.HOME = ORIG_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("member upgrade: app first, org main converts later", () => {
  test("the update run moves the clone and waits; the daemon pull finishes the move", async () => {
    const { clone, bindings } = legacyMemberHome();
    const before = readFileSync(bindings, "utf8");
    const events: ApplyEvent[] = [];
    const p = probes();
    const ctx1 = await context(p, events, { update: true });
    const run1 = await runUpdate(ctx1);

    await expectCleanRun(run1, ctx1);
    const states = Object.fromEntries(run1.outcomes.map((o) => [o.id, o.state]));
    expect(states["org.folder"]).toBe("done");
    expect(states[`migration.${SDM_MIGRATION}`]).toBe("skipped");
    expect(run1.outcomes.find((o) => o.id === `migration.${SDM_MIGRATION}`)?.detail).toBe("Your org has not moved to its new layout yet; nothing to move on this Mac");
    expect(states["skills.materialize"]).toBe("skipped");
    expect(existsSync(clone)).toBe(false);
    const moved = join(home, ".mattstack", "orgs", "acme");
    expect(existsSync(join(moved, ".git"))).toBe(true);
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "acme.json"))).toBe(true);
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "widgets.json"))).toBe(false);
    expect(marketplaces.get("widgets")).toBe(moved);
    expect(installed.get("widgets@widgets")?.version).toBe("0.1.0");
    expect(readFileSync(bindings, "utf8")).toBe(before);
    expect(existsSync(`${bindings}.stale`)).toBe(false);
    expect(readSetupState(p).migrations).toContain(SDM_MIGRATION);
    const rows = await rtHealthRows(p, { ci: false });
    expect(rows.find((r) => r.id === "org.layout")).toMatchObject({ status: "skipped", detail: "Your org has not moved to its new layout yet. rt finishes the move when it does." });
    // Only the org rows: the rt link, shell, intercepts, home backup and daemon rows read needs-you in a temp HOME with no app.
    expect(rows.find((r) => r.id === "org.folder")?.status).toBe("ready");
    expect(rows.find((r) => r.id === "team.sync")).toMatchObject({ status: "missing", detail: "The rt daemon is not running. Team clones sync once it is" });

    convertOrigin();
    const db = openStateDb(join(home, ".mattstack", "rt", "state.db"), "cli");
    const log = fakeLog();
    const onPulled = createOnPulled({ probes: p, slug: "acme", log, converge: convergePackCache, afterPull: composePullHooks([createMaterializePullHook({ log, probes: p })]) });
    const handle = startSnapshot(
      teamSnapshotSpec("acme", moved, { pullIntervalSec: 300, originUrl: origin, probes: p, ownedRoots: [], readToken: async () => null, onPulled }),
      {
        log,
        broadcast: () => {},
        db,
        watch: () => ({ close() {} }),
        readSettings: () => ({ enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30 }),
      },
    );
    await handle.ready;
    const pull = await handle.pullNow();
    await handle.settled();
    handle.stop();
    db.close();

    expect(pull.outcome).toBe("fast-forwarded");
    expect(installed.get("widgets@widgets")?.version).toBe("0.1.1");
    expectMaterialized(bindings);
    const after = await rtHealthRows(p, { ci: false });
    expect(after.find((r) => r.id === "org.layout")).toMatchObject({ status: "ready", detail: "acme on layout 2" });

    expect(getSetting("sdm.resources").value).toEqual(SDM_RESOURCES);
    const materialized = readFileSync(bindings, "utf8");

    const ctx2 = await context(p, [], { update: true });
    const run2 = await runUpdate(ctx2);
    await expectCleanRun(run2, ctx2);
    expect(run2.outcomes.some((o) => o.id.startsWith("migration."))).toBe(false);
    expect(readFileSync(bindings, "utf8")).toBe(materialized);
    expect(installed.get("widgets@widgets")).toEqual({ enabled: true, version: "0.1.1" });
    expect(marketplaces.get("widgets")).toBe(moved);
    expect(readSetupState(p).migrations).toContain(SDM_MIGRATION);
  });
});


describe("member upgrade: org main converts first, app updates later", () => {
  test("one update run lands everything", async () => {
    const { clone, bindings } = legacyMemberHome();
    convertOrigin();
    git(clone, ["pull", "-q", "--ff-only"]);
    const p = probes();
    const ctx = await context(p, [], { update: true });
    const run = await runUpdate(ctx);

    await expectCleanRun(run, ctx);
    const states = Object.fromEntries(run.outcomes.map((o) => [o.id, o.state]));
    expect(states["org.folder"]).toBe("done");
    expect(states["skills.materialize"]).toBe("done");
    expect(states["plugins.install"]).toBe("done");
    expect(states[`migration.${SDM_MIGRATION}`]).toBe("skipped");
    expect(run.outcomes.find((o) => o.id === `migration.${SDM_MIGRATION}`)?.detail).toBe("No StrongDM labels to move on this Mac");
    expect(readSetupState(p).migrations).toContain(SDM_MIGRATION);
    expect(existsSync(clone)).toBe(false);
    const moved = join(home, ".mattstack", "orgs", "acme");
    expect(existsSync(join(moved, "mattstack", "teams", "widgets", "plugin"))).toBe(true);
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "acme.json"))).toBe(true);
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "widgets.json"))).toBe(false);
    expect(marketplaces.get("widgets")).toBe(moved);
    expect(installed.get("widgets@widgets")).toEqual({ enabled: true, version: "0.1.1" });
    expectMaterialized(bindings);
    expect(existsSync(`${bindings}.stale`)).toBe(false);
    expect(getSetting("sdm.resources").value).toEqual(SDM_RESOURCES);

    const rows = await rtHealthRows(p, { ci: false });
    expect(rows.find((r) => r.id === "org.layout")).toMatchObject({ status: "ready", detail: "acme on layout 2" });
    expect(rows.find((r) => r.id === "org.folder")?.status).toBe("ready");
    expect(rows.find((r) => r.id === "team.sync")).toMatchObject({ status: "missing", detail: "The rt daemon is not running. Team clones sync once it is" });
    const drawn = (await composePlan({ p, secrets: { has: async () => null }, ci: false, mode: "status", orgs: ["acme"] })).groups.flatMap((g) => g.rows);
    expect(drawn.filter((r) => ["team.identity", "team.none"].includes(r.id) && r.status === "needs-you").map((r) => r.id)).toEqual([]);
  });
});

/**
 * What v2.21.1 leaves on disk after it held a pull onto the org layout: the fetch moved
 * refs/remotes/origin/main (and FETCH_HEAD) while HEAD and the work tree stayed on the one-team
 * commit, the engine's kv row for the old slug, one hold line in the daemon log, and the update
 * stamp. The hold itself (layoutHold, lastPullSkipped) lived only in the daemon's memory.
 */
function heldByV2211(clone: string): { held: string; fetched: string } {
  const held = git(clone, ["rev-parse", "HEAD"]);
  git(clone, ["fetch", "-q", "origin", "main"]);
  const p = { ...createRealProbes(), home };
  updateSetupState(p, (s) => ({ ...s, migrations: [...s.migrations, "2026-10-01-board-peer-trigger", "2026-10-02-retire-switchboard-url"], lastUpdate: { version: "2.21.1", at: "2026-10-07T00:00:00.000Z" } }));
  const db = openStateDb(join(home, ".mattstack", "rt", "state.db"), "cli");
  setKvValue("team-snapshot:widgets", "state", { firstSeenDirty: {} }, db);
  db.close();
  const logs = join(home, ".mattstack", "rt", "logs");
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, "daemon.2026-10-07.log"), `${JSON.stringify({ level: 30, time: 1791331200000, module: "team-snapshots", id: "team:widgets", layout: 2, reads: 1, msg: "team snapshot (widgets): holding the pull; the org is on a layout this rt does not read" })}\n`);
  return { held, fetched: git(clone, ["rev-parse", "refs/remotes/origin/main"]) };
}

describe("member upgrade: v2.21.1 held the pull, then the app updates", () => {
  test("the update run moves the held clone and the daemon pull finishes the move", async () => {
    const { clone, bindings } = legacyMemberHome();
    convertOrigin();
    const { held, fetched } = heldByV2211(clone);
    expect(fetched).not.toBe(held);
    expect(git(clone, ["status", "--porcelain"])).toBe("");
    const before = readFileSync(bindings, "utf8");

    const p = probes();
    const ctx1 = await context(p, [], { update: true });
    const run1 = await runUpdate(ctx1);

    await expectCleanRun(run1, ctx1);
    const states = Object.fromEntries(run1.outcomes.map((o) => [o.id, o.state]));
    expect(states["org.folder"]).toBe("done");
    expect(states[`migration.${SDM_MIGRATION}`]).toBe("skipped");
    expect(states["skills.materialize"]).toBe("skipped");
    expect(existsSync(clone)).toBe(false);
    const moved = join(home, ".mattstack", "orgs", "acme");
    expect(git(moved, ["rev-parse", "HEAD"])).toBe(held);
    expect(git(moved, ["rev-parse", "refs/remotes/origin/main"])).toBe(fetched);
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "acme.json"))).toBe(true);
    expect(existsSync(join(home, ".mattstack", "rt", "teams", "widgets.json"))).toBe(false);
    expect(marketplaces.get("widgets")).toBe(moved);
    expect(readFileSync(bindings, "utf8")).toBe(before);
    expect(readSetupState(p).migrations).toContain(SDM_MIGRATION);
    const rows = await rtHealthRows(p, { ci: false });
    expect(rows.find((r) => r.id === "org.layout")).toMatchObject({ status: "skipped", detail: "Your org has not moved to its new layout yet. rt finishes the move when it does." });
    expect(rows.find((r) => r.id === "org.folder")?.status).toBe("ready");
    expect(rows.find((r) => r.id === "team.sync")).toMatchObject({ status: "missing", detail: "The rt daemon is not running. Team clones sync once it is" });

    const db = openStateDb(join(home, ".mattstack", "rt", "state.db"), "cli");
    const log = fakeLog();
    const onPulled = createOnPulled({ probes: p, slug: "acme", log, converge: convergePackCache, afterPull: composePullHooks([createMaterializePullHook({ log, probes: p })]) });
    const handle = startSnapshot(
      teamSnapshotSpec("acme", moved, { pullIntervalSec: 300, originUrl: origin, probes: p, ownedRoots: [], readToken: async () => null, onPulled }),
      {
        log,
        broadcast: () => {},
        db,
        watch: () => ({ close() {} }),
        readSettings: () => ({ enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30 }),
      },
    );
    await handle.ready;
    const pull = await handle.pullNow();
    await handle.settled();
    const status = handle.status();
    handle.stop();
    db.close();

    expect(pull).toEqual({ outcome: "fast-forwarded", detail: null });
    expect(status.layoutHold ?? null).toBeNull();
    expect(git(moved, ["rev-parse", "HEAD"])).toBe(fetched);
    expect(existsSync(join(moved, "mattstack", "teams", "widgets", "plugin"))).toBe(true);
    expect(installed.get("widgets@widgets")).toEqual({ enabled: true, version: "0.1.1" });
    expectMaterialized(bindings);
    expect(existsSync(`${bindings}.stale`)).toBe(false);
    expect(getSetting("sdm.resources").value).toEqual(SDM_RESOURCES);

    const after = await rtHealthRows(p, { ci: false });
    expect(after.find((r) => r.id === "org.layout")).toMatchObject({ status: "ready", detail: "acme on layout 2" });
    expect(after.find((r) => r.id === "org.folder")?.status).toBe("ready");
    expect(after.find((r) => r.id === "team.sync")).toMatchObject({ status: "missing", detail: "The rt daemon is not running. Team clones sync once it is" });

    const materialized = readFileSync(bindings, "utf8");
    const ctx2 = await context(p, [], { update: true });
    const run2 = await runUpdate(ctx2);
    await expectCleanRun(run2, ctx2);
    expect(run2.outcomes.some((o) => o.id.startsWith("migration."))).toBe(false);
    expect(readFileSync(bindings, "utf8")).toBe(materialized);
    expect(installed.get("widgets@widgets")).toEqual({ enabled: true, version: "0.1.1" });
    expect(marketplaces.get("widgets")).toBe(moved);
    expect(readSetupState(p).migrations).toContain(SDM_MIGRATION);
    const drawn = (await composePlan({ p, secrets: { has: async () => null }, ci: false, mode: "status", orgs: ["acme"] })).groups.flatMap((g) => g.rows);
    expect(drawn.filter((r) => ["team.identity", "team.none"].includes(r.id) && r.status === "needs-you").map((r) => r.id)).toEqual([]);
  });
});
