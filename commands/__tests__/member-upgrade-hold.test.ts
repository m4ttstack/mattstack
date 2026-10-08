import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { Logger } from "pino";
import { startTeamSnapshots, type TeamSnapshotsHandle } from "../../lib/daemon/team-snapshots.ts";
import { createRealProbes } from "../../lib/setup/probes.ts";
import { orgLayoutRow } from "../../lib/setup/validators/rt-health.ts";
import { openStateDb } from "../../lib/state/db.ts";
import { teamLocalPath } from "../../lib/team/team-local.ts";
import { updateSentence } from "../../lib/team/org-marker.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function put(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
const BOARD = json({ "board.title": "Widgets", "board.projects": ["acme/widgets"] });

function legacyMemberHome() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rt-member-upgrade-hold-")));
  const origin = join(root, "origin.git");
  const admin = join(root, "admin");
  const home = join(root, "home");
  const clone = join(home, ".mattstack", "teams", "widgets");
  execFileSync("git", ["init", "--bare", "-q", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", admin]);
  git(admin, "config", "user.email", "dev1@example.test");
  git(admin, "config", "user.name", "dev1");
  git(admin, "remote", "add", "origin", origin);
  put(admin, {
    "mattstack/mattstack.jsonc": json({ role: "team", namespace: "widgets", org: "acme" }),
    "mattstack/settings.team.jsonc": BOARD,
    "mattstack/packs/widgets/.claude-plugin/plugin.json": json({ name: "widgets", version: "1.0.0" }),
    ".claude-plugin/marketplace.json": json({ name: "widgets", owner: { name: "Widgets" }, plugins: [{ name: "widgets", source: "./mattstack/packs/widgets" }] }),
  });
  git(admin, "add", "-A");
  git(admin, "commit", "-q", "-m", "one-team layout");
  git(admin, "push", "-q", "origin", "main");
  mkdirSync(dirname(clone), { recursive: true });
  execFileSync("git", ["clone", "-q", origin, clone]);
  put(home, { [teamLocalPath(home, "widgets").slice(home.length + 1)]: json({ joinedByRt: true }) });

  function convertOrigin(): void {
    git(admin, "rm", "-q", "-r", "mattstack/settings.team.jsonc", "mattstack/packs");
    put(admin, {
      "mattstack/mattstack.jsonc": json({ role: "org", org: "acme" }),
      "mattstack/org/settings.org.jsonc": json({}),
      "mattstack/teams/widgets/settings.team.jsonc": BOARD,
      "mattstack/teams/widgets/plugin/.claude-plugin/plugin.json": json({ name: "widgets", version: "1.1.0" }),
      ".claude-plugin/marketplace.json": json({ name: "widgets", owner: { name: "Widgets" }, plugins: [{ name: "widgets", source: "./mattstack/teams/widgets/plugin" }] }),
    });
    git(admin, "add", "-A");
    git(admin, "commit", "-q", "-m", "org layout");
    git(admin, "push", "-q", "origin", "main");
  }

  return { root, home, clone, convertOrigin };
}

function quietLog(): Logger {
  const noop = () => {};
  const log = { info: noop, warn: noop, error: noop, debug: noop, child: () => log } as unknown as Logger;
  return log;
}

describe("v2.21.1 member whose origin converts", () => {
  let handle: TeamSnapshotsHandle | null = null;
  let root: string | null = null;
  afterEach(() => {
    handle?.stop();
    handle = null;
    if (root) rmSync(root, { recursive: true, force: true });
    root = null;
  });

  test("pullNow holds, the working tree stays on the one-team commit, the board keeps its settings, and the row names the update", async () => {
    const fx = legacyMemberHome();
    root = fx.root;
    const before = git(fx.clone, "rev-parse", "HEAD");
    fx.convertOrigin();

    const probes = { ...createRealProbes(), home: fx.home };
    let converged = 0;
    handle = startTeamSnapshots({
      log: quietLog(),
      broadcast: () => {},
      teamsDir: join(fx.home, ".mattstack", "teams"),
      probes,
      db: openStateDb(join(fx.root, "state.db"), "cli"),
      readSettings: () => ({ enabled: true, debounceSec: 20, pushDelaySec: 60, janitorThresholdHours: 6, janitorIntervalMin: 30, pullIntervalSec: 300 }),
      watch: () => ({ close() {} }),
      converge: async () => { converged++; },
    });
    await handle.ready;

    const result = await handle.pullNow("widgets");
    expect(result).toEqual({ outcome: "skipped", detail: updateSentence(2), hold: { layout: 2, reads: 1 } });

    expect(git(fx.clone, "rev-parse", "HEAD")).toBe(before);
    expect(git(fx.clone, "status", "--porcelain")).toBe("");
    expect(JSON.parse(readFileSync(join(fx.clone, "mattstack", "mattstack.jsonc"), "utf8"))).toEqual({ role: "team", namespace: "widgets", org: "acme" });
    expect(readFileSync(join(fx.clone, "mattstack", "settings.team.jsonc"), "utf8")).toBe(BOARD);
    expect(converged).toBe(0);

    const entry = handle.status().find((e) => e.slug === "widgets");
    expect(entry?.layoutHold).toEqual({ layout: 2, reads: 1 });
    expect(entry?.lastPullAt).toBeGreaterThan(0);

    const row = await orgLayoutRow(probes, async () => handle!.status());
    expect(row).toMatchObject({ id: "org.layout", status: "needs-you", detail: updateSentence(2) });
  });
});
