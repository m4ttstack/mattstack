import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { execSync } from "child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { runRow, runDetailBlocks, runDisplayKey, runsList, runsShow, runsAbandon, resolveRunsRepoArg, AmbiguousRunsRepo } from "../runs.ts";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../lib/settings/identity.ts";
import { updateRepoIndex, REPO_INDEX_NS } from "../../lib/repo-index.ts";
import { runsRoot } from "../../lib/runs/paths.ts";
import type { DaemonResponse } from "../../lib/daemon-client.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import * as out from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";

// mock.module mutates the live "../../lib/daemon-client.ts" namespace object
// IN PLACE, so this must be captured BEFORE any mock.module call in this
// file (same reasoning as commands/__tests__/worktree.test.ts).
const realDaemonClient = await import("../../lib/daemon-client.ts");
const realDaemonQuery = realDaemonClient.daemonQuery;
const realLastQueryTimedOut = realDaemonClient.lastQueryTimedOut;

/**
 * Mock process.exit to throw a sentinel so the real test process never
 * dies, and read the spies' recorded calls BEFORE mockRestore() -- bun's
 * mockRestore() clears .mock.calls, unlike jest's (matches
 * commands/__tests__/skills.test.ts's runExpectingCleanExit).
 */
async function runExpectingCleanExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined; errors: string[]; logs: string[] }> {
  const io = captureOut();
  out.__test__.setHuman(() => false);
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return { exitCode: undefined, errors: io.errLines(), logs: io.lines() };
  } catch {
    const exitCode = exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
    return { exitCode, errors: io.errLines(), logs: io.lines() };
  } finally {
    exitSpy.mockRestore();
    io.restore();
  }
}

describe("rt runs blocks", () => {
  const run = { id: "20260821-010101-aaaa", repo: "alpha", work_type: "feature", pipeline: "default", status: "running", current_stage: "plan", spawned_by: null, started_at: 1755750000000, ended_at: null };

  test("a run is one table row: status, id, repo, type, stage, start", () => {
    const text = renderPlain([out.table([runRow(run as any)])]);
    expect(text).toBe("running  20260821-010101-aaaa  alpha  feature  plan  2025-08-21 04:20\n");
  });

  test("a finished run shows no stage", () => {
    const text = renderPlain([out.table([runRow({ ...run, status: "done" } as any)])]);
    expect(text).toBe("done  20260821-010101-aaaa  alpha  feature    2025-08-21 04:20\n");
  });

  test("the detail has a section each for stages, fields and decisions", () => {
    const text = renderPlain(runDetailBlocks({
      run: run as any,
      stages: [{ name: "plan", status: "done", attempt: 1, started_at: 1, ended_at: 2, reason: null, detail_path: null }],
      fields: [{ key: "ticket", value: "ACME-1", produced_by: "plan", at: 1 }],
      decisions: [{ contract: "execution-strategy@1", scope: "run", selection: '{"tier":"direct-tdd"}', decided_by: "stage-plan", decided_at: 1 }],
      schemaAhead: false,
    } as any));
    expect(text).toContain("STATUS   RUN");
    expect(text).toContain("\n\nStages\n[ok] plan  attempt 1\n");
    expect(text).toContain("\n\nFields\nticket  ACME-1  plan\n");
    expect(text).toContain('\n\nDecisions\nexecution-strategy@1  run  {"tier":"direct-tdd"}  stage-plan\n');
  });

  test("a failed stage carries its reason and where its detail is", () => {
    const text = renderPlain(runDetailBlocks({
      run: run as any,
      stages: [{ name: "gates", status: "failed", attempt: 1, started_at: 1, ended_at: 2, reason: "qa-islands assertion failed", detail_path: "/tmp/gates.log" }],
      fields: [],
      decisions: [],
      schemaAhead: false,
    } as any));
    expect(text).toContain("[failed] gates  attempt 1\n  why: qa-islands assertion failed\n  note: /tmp/gates.log\n");
    expect(text).not.toContain("Fields");
    expect(text).not.toContain("Decisions");
  });

  test("a redirected stage reads as skipped and says so, never as an unknown state", () => {
    const text = renderPlain(runDetailBlocks({
      run: run as any,
      stages: [{ name: "implement", status: "redirected", attempt: 1, started_at: 1, ended_at: 2, reason: "redirected to plan", detail_path: null }],
      fields: [],
      decisions: [],
      schemaAhead: false,
    } as any));
    expect(text).toContain("[skipped] implement  attempt 1, redirected\n  why: redirected to plan\n");
    expect(text).not.toContain("[not yet] implement");
  });

  test("a run written by a newer rt says so", () => {
    const text = renderPlain(runDetailBlocks({ run: run as any, stages: [], fields: [], decisions: [], schemaAhead: true } as any));
    expect(text).toContain("[warning] A newer rt wrote this run  some of it may be missing here\n");
  });
});

describe("rt runs --repo flag validation", () => {
  test("a dangling --repo with no value fails loudly instead of silently listing unscoped", async () => {
    const { exitCode, errors } = await runExpectingCleanExit(() => runsList(["--repo"]));
    expect(exitCode).toBe(1);
    expect(errors).toEqual(["Which repo?", "  next: rt runs --repo <repo>"]);
  });

  test("--repo immediately followed by another flag is treated as dangling, not a value", async () => {
    const { exitCode, errors } = await runExpectingCleanExit(() => runsList(["--repo", "--json"]));
    expect(exitCode).toBe(1);
    expect(errors).toEqual(["Which repo?", "  next: rt runs --repo <repo>"]);
  });

  test("runsShow rejects a dangling --repo the same way", async () => {
    const { exitCode, errors } = await runExpectingCleanExit(() => runsShow(["20260821-010101-aaaa", "--repo"]));
    expect(exitCode).toBe(1);
    expect(errors).toEqual(["Which repo?", "  next: rt runs --repo <repo>"]);
  });
});

describe("rt runs abandon argument validation", () => {
  test("runs abandon requires a run id", async () => {
    const { exitCode, errors } = await runExpectingCleanExit(() => runsAbandon([]));
    expect(exitCode).toBe(1);
    expect(errors).toEqual(["Which run?", "  next: rt runs abandon <run>"]);
  });

  test("runs abandon rejects a dangling --reason", async () => {
    const { exitCode, errors } = await runExpectingCleanExit(() => runsAbandon(["some-id", "--reason"]));
    expect(exitCode).toBe(1);
    expect(errors).toEqual(["What is the reason?", "  next: rt runs abandon <run> --reason <text>"]);
  });
});

/**
 * `runs:list`/`runs:get`/`runs:abandon` are identity-only on the daemon side
 * (lib/daemon/handlers/runs.ts) — a bare display name resolves nothing. This
 * CLI must reverse-resolve `--repo` the same way `rt worktree` does before
 * forwarding it.
 */
describe("rt runs --repo identity resolution", () => {
  interface Captured { cmd: string; payload?: Record<string, unknown> }

  function installFakeDaemon(response: DaemonResponse): Captured[] {
    const calls: Captured[] = [];
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: async (cmd: string, payload?: Record<string, unknown>) => {
        calls.push({ cmd, payload });
        return response;
      },
      lastQueryTimedOut: () => false,
    }));
    return calls;
  }

  const origHome = process.env.HOME;
  const origCwd = process.cwd();
  let home: string;
  let reposRoot: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-runs-cli-home-")));
    reposRoot = realpathSync(mkdtempSync(join(tmpdir(), "rt-runs-cli-repos-")));
    process.env.HOME = home;
    closeStateDb();
    process.chdir(home);
  });

  afterEach(() => {
    mock.module("../../lib/daemon-client.ts", () => ({
      ...realDaemonClient,
      daemonQuery: realDaemonQuery,
      lastQueryTimedOut: realLastQueryTimedOut,
    }));
    process.chdir(origCwd);
    process.env.HOME = origHome;
    closeStateDb();
    rmSync(home, { recursive: true, force: true });
    rmSync(reposRoot, { recursive: true, force: true });
  });

  function makeGitRepo(name: string): string {
    const dir = realpathSync(mkdtempSync(join(reposRoot, `${name}-`)));
    execSync("git init -q -b main", { cwd: dir });
    return dir;
  }

  test("--repo <name> resolves to the run-dir display key before it reaches the daemon", async () => {
    const repoPath = makeGitRepo("runs-named-repo");
    process.chdir(repoPath);
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    // A bare --repo name resolves by reverse-lookup against the repo index, so
    // the repo must be registered there for the name to match its basename.
    updateRepoIndex(identity, repoPath);
    process.chdir(home); // leave the repo — --repo must do the resolving, not cwd

    const calls = installFakeDaemon({ ok: true, data: { runs: [] } });

    await runsList(["--repo", basename(repoPath), "--json"]);

    const call = calls.find((c) => c.cmd === "runs:list");
    expect(call).toBeDefined();
    // The daemon's runs:* handlers key run dirs verbatim -- the wire identity
    // (":", "%") never named a real dir, only the display key does.
    expect(call!.payload!.repo).not.toMatch(/^(remote|path):/);
    expect(call!.payload!.repo).toBe(runDisplayKey(identity));
  });

  test("--repo <path> derives the identity from the directory", async () => {
    const repoPath = makeGitRepo("runs-path-repo");
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));

    const calls = installFakeDaemon({ ok: true, data: { runs: [] } });

    await runsList(["--repo", repoPath, "--json"]);

    const call = calls.find((c) => c.cmd === "runs:list");
    expect(call?.payload?.repo).toBe(runDisplayKey(identity));
  });

  test("no --repo forwards undefined so the daemon lists across all repos", async () => {
    const calls = installFakeDaemon({ ok: true, data: { runs: [] } });

    await runsList(["--json"]);

    const call = calls.find((c) => c.cmd === "runs:list");
    expect(call?.payload?.repo).toBeUndefined();
  });

  test("runsShow resolves --repo the same way", async () => {
    const repoPath = makeGitRepo("runs-show-repo");
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));

    const calls = installFakeDaemon({ ok: true, data: { run: { id: "x" } } });

    await runsShow(["some-run-id", "--repo", repoPath, "--json"]);

    const call = calls.find((c) => c.cmd === "runs:get");
    expect(call?.payload?.repo).toBe(runDisplayKey(identity));
  });

  test("runsAbandon resolves --repo the same way", async () => {
    const repoPath = makeGitRepo("runs-abandon-repo");
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));

    const calls = installFakeDaemon({ ok: true, data: {} });

    await runsAbandon(["some-run-id", "--repo", repoPath]);

    const call = calls.find((c) => c.cmd === "runs:abandon");
    expect(call?.payload?.repo).toBe(runDisplayKey(identity));
  });

  test("an unresolvable --repo forwards the raw arg as a run-dir key when that dir already exists (pre-cutover run dirs keep their pipeline's key)", async () => {
    mkdirSync(join(runsRoot(), "legacy-run-dir-name"), { recursive: true });
    const calls = installFakeDaemon({ ok: true, data: { runs: [] } });

    await runsList(["--repo", "legacy-run-dir-name", "--json"]);

    const call = calls.find((c) => c.cmd === "runs:list");
    expect(call?.payload?.repo).toBe("legacy-run-dir-name");
  });

  test("an unresolvable --repo with no matching run dir errors instead of silently listing nothing", async () => {
    installFakeDaemon({ ok: true, data: { runs: [] } });

    const { exitCode, logs } = await runExpectingCleanExit(() =>
      runsList(["--repo", "definitely-not-a-repo", "--json"]),
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(logs.at(-1)!)).toEqual({ ok: false, error: "unknown repo: definitely-not-a-repo" });
  });

  test("the same unknown --repo fails on stderr, exit 1, without --json", async () => {
    installFakeDaemon({ ok: true, data: { runs: [] } });

    const { exitCode, errors } = await runExpectingCleanExit(() =>
      runsList(["--repo", "definitely-not-a-repo"]),
    );

    expect(exitCode).toBe(1);
    expect(errors).toEqual(["rt does not know a repo called definitely-not-a-repo"]);
  });

  test("runsShow surfaces the same unknown-repo error", async () => {
    installFakeDaemon({ ok: true, data: { run: { id: "x" } } });

    const { exitCode, logs } = await runExpectingCleanExit(() =>
      runsShow(["some-run-id", "--repo", "definitely-not-a-repo", "--json"]),
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(logs.at(-1)!)).toEqual({ ok: false, error: "unknown repo: definitely-not-a-repo" });
  });

  test("runsAbandon surfaces the same unknown-repo error", async () => {
    installFakeDaemon({ ok: true, data: {} });

    const { exitCode, logs } = await runExpectingCleanExit(() =>
      runsAbandon(["some-run-id", "--repo", "definitely-not-a-repo", "--json"]),
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(logs.at(-1)!)).toEqual({ ok: false, error: "unknown repo: definitely-not-a-repo" });
  });

  test("an unknown --repo under --json writes the same envelope and nothing on stderr", async () => {
    installFakeDaemon({ ok: true, data: { runs: [] } });
    const { exitCode, logs, errors } = await runExpectingCleanExit(() => runsList(["--repo", "definitely-not-a-repo", "--json"]));
    expect(exitCode).toBe(1);
    expect(logs).toEqual(['{"ok":false,"error":"unknown repo: definitely-not-a-repo"}']);
    expect(errors).toEqual([]);
  });

  test("an ambiguous --repo without --json names both repos", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Fone%2Fwidgets", "/repos/a/widgets");
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Ftwo%2Fwidgets", "/repos/b/widgets");
    installFakeDaemon({ ok: true, data: { runs: [] } });
    const { exitCode, errors } = await runExpectingCleanExit(() => runsList(["--repo", "widgets"]));
    expect(exitCode).toBe(1);
    expect(errors[0]).toBe("More than one repo is called widgets");
    // Short labels, never the serialized ids; the resolver decides the order.
    expect([
      "  why: It could be one/widgets or two/widgets. Use the full name of the one you mean.",
      "  why: It could be two/widgets or one/widgets. Use the full name of the one you mean.",
    ]).toContain(errors[1]!);
  });

  test("--json list and show write the daemon's data on one line, as before", async () => {
    installFakeDaemon({ ok: true, data: { runs: [] } });
    const list = await runExpectingCleanExit(() => runsList(["--json"]));
    expect(list.logs).toEqual(['{"runs":[]}']);
    installFakeDaemon({ ok: true, data: { run: { id: "x" } } });
    const show = await runExpectingCleanExit(() => runsShow(["x", "--json"]));
    expect(show.logs).toEqual(['{"run":{"id":"x"}}']);
  });

  test("the list is one table, and no runs is one skipped line", async () => {
    const run = { id: "20260821-010101-aaaa", repo: "alpha", work_type: "feature", pipeline: "default", status: "failed", current_stage: null, spawned_by: null, started_at: 1755750000000, ended_at: null };
    installFakeDaemon({ ok: true, data: { runs: [run] } });
    const listed = await runExpectingCleanExit(() => runsList([]));
    // The plain table pads every cell but the last to its column and joins with two spaces.
    const cols = (cells: string[]): string => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd([6, 20, 5, 7, 5][i]!))).join("  ");
    expect(listed.logs).toEqual([
      cols(["STATUS", "RUN", "REPO", "TYPE", "STAGE", "STARTED"]),
      cols(["failed", "20260821-010101-aaaa", "alpha", "feature", "", "2025-08-21 04:20"]),
    ]);
    installFakeDaemon({ ok: true, data: { runs: [] } });
    const none = await runExpectingCleanExit(() => runsList([]));
    expect(none.logs).toEqual(["[skipped] No runs yet"]);
  });

  test("a daemon that is not running, a daemon error, a stray word and a done abandon each read plainly", async () => {
    installFakeDaemon(null as unknown as DaemonResponse);
    const down = await runExpectingCleanExit(() => runsList([]));
    expect(down.exitCode).toBe(1);
    expect(down.errors).toEqual(["The rt daemon is not running", "  why: It keeps the record of your runs.", "  next: rt daemon start"]);

    installFakeDaemon({ ok: false, error: "no such run: x" });
    const missing = await runExpectingCleanExit(() => runsShow(["x"]));
    expect(missing.exitCode).toBe(1);
    expect(missing.errors).toEqual(["Could not read that run", "  why: no such run: x"]);

    const stray = await runExpectingCleanExit(() => runsList(["bogus"]));
    expect(stray.exitCode).toBe(2);
    expect(stray.errors).toEqual(["rt runs has no command called bogus", "  next: rt runs --help"]);

    installFakeDaemon({ ok: true, data: {} });
    const done = await runExpectingCleanExit(() => runsAbandon(["20260821-010101-aaaa"]));
    expect(done.exitCode).toBeUndefined();
    expect(done.logs).toEqual(["[ok] Marked 20260821-010101-aaaa abandoned"]);
  });

  // Regression: an ambiguous selector must never fall through to the
  // literal-dir fallback, even when it happens to equal a legacy run dir's
  // name -- that fallback is for a resolver that found nothing, not one that
  // found two repos and can't tell them apart.
  test("an ambiguous --repo that also matches a legacy run dir errors ambiguous, never falls back to the dir", async () => {
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Fone%2Fwidgets", "/repos/a/widgets");
    setKvValue(REPO_INDEX_NS, "remote:github.com%2Ftwo%2Fwidgets", "/repos/b/widgets");
    mkdirSync(join(runsRoot(), "widgets"), { recursive: true });

    await expect(resolveRunsRepoArg("widgets")).rejects.toBeInstanceOf(AmbiguousRunsRepo);

    installFakeDaemon({ ok: true, data: { runs: [] } });
    const { exitCode, logs } = await runExpectingCleanExit(() =>
      runsList(["--repo", "widgets", "--json"]),
    );
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(logs.at(-1)!);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain("matches more than one repo");
    expect(parsed.error).not.toContain("unknown repo");
  });
});
