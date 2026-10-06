import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut, type CapturedOut } from "../../lib/ui/__tests__/capture-out.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { machineSettingsPath } from "../../lib/rt-paths.ts";
import { getSetting } from "../../lib/settings/resolve.ts";
import { serializeIdentity } from "../../lib/settings/identity.ts";
import { closeStateDb, deleteKvValue, getKvValue, setKvValue } from "../../lib/state/index.ts";
import { DAEMON_SOCK_PATH } from "../../lib/daemon-config.ts";
import { manageTracking, trackListBlocks } from "../daemon.ts";
import { sharedStorePath } from "../../packages/rt-client/test/org-fixture.ts";

const REPO_NAME = "rt-rider-cli-wiring-repo";
const TEAM_NAME = "rt-rider-cli-wiring-team";
// The host/path the team file keys on (the readable `identity.id`)...
const IDENTITY = `rttest/${REPO_NAME}`;
// ...and the serialized wire form every rt store keys on now.
const SERIALIZED = serializeIdentity({ kind: "remote", id: IDENTITY });
const REPO_INDEX_NS = "repo-index";

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Restores `path` to its prior content, or removes it if it didn't exist before. */
function restore(path: string, prior: string | null): void {
  if (prior === null) {
    try { rmSync(path, { force: true }); } catch { /* already gone */ }
  } else {
    writeFileSync(path, prior);
  }
}

/**
 * The machine store is authored JSONC — `setSetting` seeds a `//` header
 * comment the first time it creates the file (write.ts's `seedHeader`), and
 * this file's `priorMachineStore` snapshot is shared ambient-HOME content
 * that another test file's real `setSetting` call may already have written
 * that header into. A bare `JSON.parse` throws on that; parse it the same
 * comment-tolerant way `readStore` does.
 */
function parseMachineStore(raw: string): Record<string, unknown> {
  const parsed = parseJsonc(raw, undefined, { allowTrailingComma: true }) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

describe("manageTracking off-branch (CLI wiring)", () => {
  let io: CapturedOut;
  let priorRepoIndexEntry: string | null;
  let priorTeamStore: string | null;
  let priorMachineStore: string | null;
  let repoPath: string;
  let priorHome: string | undefined;
  let fixtureHome: string;

  beforeEach(() => {
    priorHome = process.env.HOME;
    closeStateDb();
    fixtureHome = realpathSync(mkdtempSync(join(tmpdir(), "rt-tracking-home-")));
    process.env.HOME = fixtureHome;
    io = captureOut();
    ui.__test__.setHuman(() => false);

    priorRepoIndexEntry = getKvValue<string | null>(REPO_INDEX_NS, SERIALIZED, null);
    priorTeamStore = readOrNull(sharedStorePath(TEAM_NAME));
    priorMachineStore = readOrNull(machineSettingsPath());

    // A real git repo with a fake-but-normalizable remote — identity derives
    // directly (`rttest/${REPO_NAME}`), no override plumbing needed.
    repoPath = realpathSync(mkdtempSync(join(tmpdir(), "rt-rider-cli-repo-")));
    execSync("git init -q", { cwd: repoPath });
    execSync(`git remote add origin git@rttest:${REPO_NAME}.git`, { cwd: repoPath });

    // The index keys on the serialized identity now; the operator still types
    // the bare name, which manageTracking reverse-resolves to this key.
    setKvValue(REPO_INDEX_NS, SERIALIZED, repoPath);

    // Team intent still declares this repo — mattstack.tracking's VALUE has
    // its own "repos" field (identity → intent); it is not the store file's
    // top-level repo-section sharding (that's for repo-scoped setting keys).
    const teamStore = sharedStorePath(TEAM_NAME);
    mkdirSync(dirname(teamStore), { recursive: true });
    writeFileSync(teamStore, JSON.stringify({
      "mattstack.tracking": { repos: { [IDENTITY]: { caches: ["branches"] } } },
    }));

    // An existing machine grant for it, as if it had been tracked already.
    const machineStore = machineSettingsPath();
    mkdirSync(dirname(machineStore), { recursive: true });
    const machine = priorMachineStore ? parseMachineStore(priorMachineStore) : {};
    machine["rt.repoTracking"] = {
      ...(machine["rt.repoTracking"] ?? {}),
      [SERIALIZED]: { mode: "live", caches: ["branches"] },
    };
    writeFileSync(machineStore, JSON.stringify(machine));
  });

  afterEach(() => {
    io.restore();
    rmSync(repoPath, { recursive: true, force: true });
    if (priorRepoIndexEntry === null) deleteKvValue(REPO_INDEX_NS, SERIALIZED);
    else setKvValue(REPO_INDEX_NS, SERIALIZED, priorRepoIndexEntry);
    restore(sharedStorePath(TEAM_NAME), priorTeamStore);
    restore(machineSettingsPath(), priorMachineStore);
    closeStateDb();
    process.env.HOME = priorHome;
    rmSync(fixtureHome, { recursive: true, force: true });
  });

  test("off on a team-tracked repo plants an explicit {mode:\"off\"} marker, not a delete", async () => {
    await manageTracking([REPO_NAME, "off"]);

    const saved = getSetting<Record<string, unknown>>("rt.repoTracking").value;
    expect(saved[SERIALIZED]).toEqual({ mode: "off" });
    expect(io.stdout()).toContain(`[ok] Stopped tracking ${REPO_NAME}`);
    expect(io.stdout()).toContain("Your team still tracks it");
    expect(saved[REPO_NAME]).toBeUndefined();
  });

  test("poll prints its cadence and live refusal leaves the grant unchanged", async () => {
    await manageTracking([REPO_NAME, "poll"]);
    expect(io.stdout()).toContain(`[ok] Tracking ${REPO_NAME}: every 5 minutes`);
    expect(io.stdout()).toContain("The daemon did not apply this tracking change");
    expect(io.stdout()).toContain("this applies when it next starts or refreshes");
    const saved = getSetting<Record<string, unknown>>("rt.repoTracking").value;
    io.clear();
    await manageTracking([REPO_NAME, "live"]);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toContain(`[refused] rt cannot watch ${REPO_NAME} live`);
    expect(io.stderr()).toContain(`next: rt daemon track ${REPO_NAME} poll`);
    expect(getSetting<Record<string, unknown>>("rt.repoTracking").value).toEqual(saved);
  });

  test("invalid mode and cache print failures without changing tracking", async () => {
    const saved = getSetting<Record<string, unknown>>("rt.repoTracking").value;
    await manageTracking([REPO_NAME, "invalid"]);
    expect(io.stdout()).toBe("");
    expect(io.stderr()).toStartWith("Which tracking mode?");
    io.clear();
    await manageTracking([REPO_NAME, "poll", "bad-cache"]);
    expect(io.stderr()).toContain('"bad-cache" has a cache rt does not know');
    expect(getSetting<Record<string, unknown>>("rt.repoTracking").value).toEqual(saved);
  });

  test("unknown repo guidance registers a checkout without changing tracking", async () => {
    const saved = getSetting<Record<string, unknown>>("rt.repoTracking").value;
    for (const args of [["rt-unknown-final-fix"], ["rt-unknown-final-fix", "poll"]]) {
      io.clear();
      await manageTracking(args);
      expect(io.stderr()).toContain("next: rt repos register <path>");
      expect(getSetting<Record<string, unknown>>("rt.repoTracking").value).toEqual(saved);
    }
  });

  test("a rejected reconcile preserves intent and describes the unsuccessful request", async () => {
    mkdirSync(dirname(DAEMON_SOCK_PATH), { recursive: true });
    const server = Bun.serve({ unix: DAEMON_SOCK_PATH, fetch: () => Response.json({ ok: false, error: "busy" }) });
    try {
      await manageTracking([REPO_NAME, "poll"]);
      expect(io.stdout()).toContain("The daemon did not apply this tracking change");
      expect(io.stdout()).toContain("this applies when it next starts or refreshes");
      expect(io.stdout()).not.toContain("The daemon is not running");
      expect(getSetting<Record<string, unknown>>("rt.repoTracking").value[SERIALIZED]).toEqual({ mode: "poll", caches: ["branches"] });
    } finally {
      server.stop(true);
      rmSync(DAEMON_SOCK_PATH, { force: true });
    }
  });

  test("off on a repo the team no longer names deletes outright", async () => {
    writeFileSync(sharedStorePath(TEAM_NAME), JSON.stringify({ "mattstack.tracking": { repos: {} } }));

    await manageTracking([REPO_NAME, "off"]);

    const saved = getSetting<Record<string, unknown>>("rt.repoTracking").value;
    expect(saved[SERIALIZED]).toBeUndefined();
  });
});

test("the tracking list is one table, off repos quiet, unknown tracked repos flagged", () => {
  const id = (n: string) => serializeIdentity({ kind: "remote", id: `gitlab.example.com/acme/${n}` });
  const blocks = trackListBlocks(
    { [id("alpha")]: "/code/alpha", [id("beta")]: "/code/beta", [id("delta")]: "/code/delta", [id("gamma")]: "/code/gamma" },
    { [id("alpha")]: { mode: "live", caches: ["branches", "project-mrs"] }, [id("gone")]: { mode: "poll", caches: ["branches"] }, [id("delta")]: { mode: "poll", caches: ["branches"], projectMrsWindowDays: 45 }, [id("gamma")]: { mode: "live", caches: ["branches"] } },
    { [id("alpha")]: { state: "connected" } },
  );
  const text = renderPlain(blocks);
  expect(text).toContain("Repo tracking");
  expect(text).toMatch(/live +alpha +watcher connected · caches branches, project-mrs · window \(default 30\)/);
  expect(text).toMatch(/off +beta/);
  expect(text).toMatch(/every 5 minutes +delta +caches branches · window 45d/);
  expect(text).toContain("watcher starting");
  expect(text).toContain("[warning] gone is tracked, but rt does not know where it is");
  expect(text).toContain("next: rt daemon track <repo> live|poll|off");
  expect(text).toContain("next: rt repos register <path>");
  expect(text).not.toContain("remote:");
});
