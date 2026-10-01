/**
 * The --json output of rt worktree, byte for byte. The capture reads both
 * doors (console.log and process.stdout), so the same file pins the bytes
 * before and after the verbs move onto the output layer.
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  worktreeAdopt,
  worktreeAwaitReady,
  worktreeCreate,
  worktreeDispose,
  worktreeFreshen,
  worktreeList,
  worktreeProvision,
  worktreeReadyApprove,
  worktreeRestore,
  worktreeTriage,
} from "../worktree.ts";
import { getRepoIdentity } from "../../lib/repo.ts";
import { closeStateDb } from "../../lib/state/index.ts";
import type { DaemonResponse } from "../../lib/daemon-client.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { teamSettingsPath } from "../../lib/rt-paths.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../lib/settings/identity.ts";
import { loadWorktreeRepoConfig } from "../../lib/worktree/config.ts";
import { readyLadderHash, writeReadyApproval } from "../../lib/worktree/ready-approval.ts";

// mock.module rewrites the live namespace in place: keep the real bindings to restore.
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realLastQueryTimedOut = realDaemonClient.lastQueryTimedOut;
const realDaemonTest = realDaemonClient.__test__;

function fakeDaemon(response: DaemonResponse | null): void {
  mock.module("../../lib/daemon-client.ts", () => ({
    ...realDaemonClient,
    daemonQuery: async () => response,
    lastQueryTimedOut: () => false,
  }));
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

describe("rt worktree --json bytes", () => {
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let repo: string;
  let io: ReturnType<typeof captureOut>;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-worktree-json-home-")));
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rt-worktree-json-repo-")));
    process.env.HOME = home;
    closeStateDb();
    execSync("git init -q -b main", { cwd: repo });
    process.chdir(repo);
    getRepoIdentity();

    io = captureOut({ console: true });
    ui.__test__.reset();
    ui.__test__.setHuman(() => false);
  });

  afterEach(() => {
    io.restore();
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: realDaemonQuery,
      lastQueryTimedOut: realLastQueryTimedOut,
    }));
    realDaemonTest.resetDownWarning();
    process.exitCode = 0;
    process.chdir(origCwd);
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const CASES: Array<[string, (args: string[]) => Promise<void>, string[], Record<string, unknown>]> = [
    ["provision", (a) => worktreeProvision(a, {}), ["--branch", "feature/one", "--json"], { tree: "alpha", path: "/pool/alpha", branch: "feature/one", branchState: "new", readyPending: true, readySteps: ["install"] }],
    ["create", (a) => worktreeCreate(a, {}), ["--json"], { tree: "alpha", path: "/pool/alpha" }],
    ["await-ready", (a) => worktreeAwaitReady(a, {}), ["alpha", "--json"], { tree: "alpha", path: "/pool/alpha", ready: false, readyAt: null }],
    ["dispose", (a) => worktreeDispose(a, {}), ["alpha", "--json"], { disposed: [], refused: [{ tree: "alpha", reason: "dirty" }], recoverable: [] }],
    ["restore", (a) => worktreeRestore(a, {}), ["alpha", "--json"], { restored: true, path: "/pool/alpha", tree: "alpha" }],
    ["triage", (a) => worktreeTriage(a, {}), ["--json"], { rows: [], banners: [], counts: { needsDecision: 0 } }],
    ["freshen", (a) => worktreeFreshen(a, {}), ["alpha", "--json"], { ran: ["alpha"] }],
  ];

  test.each(CASES)("%s prints the daemon's data, indented by two", async (_name, run, args, data) => {
    fakeDaemon({ ok: true, data });
    await run(args);
    expect(io.stdout()).toBe(pretty(data));
  });

  test("adopt prints the daemon's data, indented by two", async () => {
    const data = { main: "main", claimed: ["alpha"], unmanaged: [], disposed: [], refused: [] };
    fakeDaemon({ ok: true, data });
    await worktreeAdopt(["--repo", repo, "--json"], {});
    expect(io.stdout()).toBe(pretty(data));
  });

  test("list prints trees, readyHeldRepos and mergeCleanupOff, in that order", async () => {
    fakeDaemon({ ok: true, data: { trees: [], readyHeldRepos: ["path:/sample"] } });
    await worktreeList(["--json"], {});
    expect(io.stdout()).toBe(pretty({ trees: [], readyHeldRepos: ["path:/sample"], mergeCleanupOff: [] }));
  });

  test("restore --list prints the entries", async () => {
    fakeDaemon({ ok: true, data: {} });
    await worktreeRestore(["--list", "--json"], {});
    expect(io.stdout()).toBe(pretty({ entries: [] }));
  });

  test("a daemon refusal is one compact error line, exit 1", async () => {
    fakeDaemon({ ok: false, error: "busy" });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeFreshen(["alpha", "--json"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe('{"error":"busy"}\n');
    } finally {
      exitSpy.mockRestore();
    }
  });

  test("a usage refusal is one compact error line, exit 1", async () => {
    fakeDaemon({ ok: true, data: {} });
    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit sentinel");
    }) as never);
    try {
      await expect(worktreeAdopt(["--json"], {})).rejects.toThrow("process.exit sentinel");
      expect(exitSpy.mock.calls.at(-1)?.[0]).toBe(1);
      expect(io.stdout()).toBe('{"error":"--repo <name> is required for adopt"}\n');
    } finally {
      exitSpy.mockRestore();
    }
  });
});

describe("rt worktree ready-approve --json bytes", () => {
  // ready-approve reads the repo's own settings, not the daemon, so these run
  // the real verb against a repo with a remote and real settings stores.
  const REMOTE = "git@git.example.com:sample-team/approve-pin.git";
  const IDENTITY = "git.example.com/sample-team/approve-pin";
  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let repo: string;
  let wire: string;
  let io: ReturnType<typeof captureOut>;

  beforeEach(async () => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-ready-approve-json-home-")));
    repo = realpathSync(mkdtempSync(join(tmpdir(), "rt-ready-approve-json-repo-")));
    process.env.HOME = home;
    closeStateDb();
    execSync("git init -q -b main", { cwd: repo });
    execSync(`git remote add origin ${REMOTE}`, { cwd: repo });
    process.chdir(repo);
    getRepoIdentity();
    wire = serializeIdentity(await deriveRepoIdentity(repo));

    io = captureOut({ console: true });
    ui.__test__.reset();
    ui.__test__.setHuman(() => false);
  });

  afterEach(() => {
    io.restore();
    process.chdir(origCwd);
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  test("a repo with no team setup steps is one compact line", async () => {
    await worktreeReadyApprove([wire, "--json"], {});
    expect(io.stdout()).toBe('{"teamOwned":false}\n');
  });

  test("an approved team ladder is one compact line with its hash", async () => {
    const store = teamSettingsPath("sample-team");
    mkdirSync(dirname(store), { recursive: true });
    writeFileSync(store, JSON.stringify({ repos: { [IDENTITY]: { "rt.worktrees": { onDeck: 1, ready: [{ run: "make setup" }] } } } }, null, 2));
    const hash = readyLadderHash((await loadWorktreeRepoConfig(wire, repo)).ready);
    writeReadyApproval(IDENTITY, hash);

    await worktreeReadyApprove([wire, "--json"], {});

    expect(io.stdout()).toBe(`{"teamOwned":true,"approved":true,"hash":"${hash}"}\n`);
  });
});
