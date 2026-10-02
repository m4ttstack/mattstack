import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DAEMON_SOCK_PATH } from "../../lib/daemon-config.ts";
import { getKnownRepos, loadRepoIndex, loadRepoIndexEntries, updateRepoIndex } from "../../lib/repo-index.ts";
import { loadRepoTracking } from "../../lib/repo-tracking.ts";
import { saveRegistry } from "../../lib/worktree/registry.ts";
import { deriveRepoIdentity, serializeIdentity } from "../../lib/settings/identity.ts";
import { closeStateDb, setKvValue } from "../../lib/state/index.ts";
import * as ui from "../../lib/ui/out.ts";
import { captureOut } from "../../lib/ui/__tests__/capture-out.ts";
import { pruneBlocks, reposPrune, reposRegister, type RegisterDeps } from "../repos.ts";
import { renderPlain } from "../../lib/ui/out-plain.ts";
import { repoDataDir } from "../../lib/rt-paths.ts";

function testDeps(): RegisterDeps & { lines: string[] } {
  const lines: string[] = [];
  return { print: (s) => lines.push(s), lines };
}

/** Every usage/bad-path refusal exits via the real process.exit(2) (exitUserError), not an injectable seam. */
async function runExpectingProcessExit(fn: () => Promise<void>): Promise<number | undefined> {
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit sentinel");
  });
  try {
    await fn();
    return undefined;
  } catch {
    return exitSpy.mock.calls.at(-1)?.[0] as number | undefined;
  } finally {
    exitSpy.mockRestore();
  }
}

/** Runs a verb with plain output captured: stdout by line, and stderr whole. */
async function human(fn: () => Promise<void>): Promise<{ lines: string[]; stderr: string; code: number | undefined }> {
  const io = captureOut();
  ui.__test__.setHuman(() => false);
  try {
    const code = await runExpectingProcessExit(fn);
    return { lines: io.lines(), stderr: io.stderr(), code };
  } finally {
    io.restore();
  }
}

describe("reposRegister", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    // A per-test HOME (not the ambient test-setup.ts one) — reposRegister
    // writes real repos.json + settings-store files, and the ambient HOME is
    // shared with other test files that assume nothing else touches it.
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-repos-register-home-")));
    process.env.HOME = home;
    // getStateDb()'s singleton binds to whatever HOME is live on its first
    // call and is held for the rest of the process — without this reset,
    // this test's loadRepoIndex traffic reuses a handle opened under a
    // different HOME (or, after afterEach below, a deleted one).
    closeStateDb();
  });

  afterEach(() => {
    closeStateDb();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function makeTempRepo(): string {
    const dir = realpathSync(mkdtempSync(join(home, "repo-")));
    execSync("git init -q", { cwd: dir });
    return dir;
  }

  test("registers a repo path into the global index", async () => {
    const repoPath = makeTempRepo();
    const name = basename(repoPath);
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    const deps = testDeps();

    const { lines } = await human(() => reposRegister([repoPath], {}, deps));

    const entry = getKnownRepos().find((r) => r.repoName === identity);
    expect(entry).toBeDefined();
    expect(entry!.worktrees[0]!.path).toBe(repoPath);
    expect(lines).toEqual([`[ok] Registered ${name}  ${repoPath}`]);
    expect(deps.lines).toEqual([]);
  });

  test("register keys the index by the repo's identity, not its directory basename", async () => {
    const repoPath = makeTempRepo();
    execSync("git remote add origin git@gitlab.com:group/canonical.git", { cwd: repoPath, stdio: "pipe" });
    const deps = testDeps();

    await human(() => reposRegister([repoPath], {}, deps));

    const keys = Object.keys(loadRepoIndex());
    expect(keys).toContain("remote:gitlab.com%2Fgroup%2Fcanonical");
    expect(keys).not.toContain(basename(repoPath));
  });

  test("--track poll --caches branches,project-mrs grants tracking", async () => {
    const repoPath = makeTempRepo();
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    const deps = testDeps();

    await human(() => reposRegister([repoPath, "--track", "poll", "--caches", "branches,project-mrs"], {}, deps));

    const tracking = loadRepoTracking();
    expect(tracking[identity]).toEqual({ mode: "poll", caches: ["branches", "project-mrs"] });
  });

  test("--track without --caches defaults to branches", async () => {
    const repoPath = makeTempRepo();
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    const deps = testDeps();

    await human(() => reposRegister([repoPath, "--track", "live"], {}, deps));

    const tracking = loadRepoTracking();
    expect(tracking[identity]).toEqual({ mode: "live", caches: ["branches"] });
  });

  test("--json prints a contract envelope naming the registered repo", async () => {
    const repoPath = makeTempRepo();
    const name = basename(repoPath);
    const deps = testDeps();

    await reposRegister([repoPath, "--json"], {}, deps);

    expect(deps.lines).toHaveLength(1);
    const { at, ...body } = JSON.parse(deps.lines[0]!);
    expect(typeof at).toBe("string");
    expect(body).toEqual({ contract: 1, registered: [{ name, path: repoPath, tracking: null }] });
  });

  test("a repo whose move cannot be applied exits 2 instead of reporting it registered", async () => {
    const repoPath = makeTempRepo();
    execSync("git remote add origin git@gitlab.com:group/moved.git", { cwd: repoPath, stdio: "pipe" });
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    const gone = join(home, "gone-away");
    setKvValue("repo-index", identity, gone);
    // A registry record whose re-rooted spelling is occupied by something git
    // does not list as a worktree — the apply refuses at verification, so
    // nothing is written and the row keeps naming the gone path.
    saveRegistry(identity, [
      { name: "main", path: gone, kind: "main", branch: "main", createdAt: "2026-01-01T00:00:00.000Z" },
      { name: "t1", path: join(gone, ".worktrees", "t1"), kind: "ephemeral", state: "on-deck", branch: "feat", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    mkdirSync(join(repoPath, ".worktrees", "t1"), { recursive: true });
    const deps = testDeps();

    const { code, stderr } = await human(() => reposRegister([repoPath], {}, deps));

    expect(code).toBe(2);
    expect(deps.lines.some((l) => l.includes("registered"))).toBe(false);
    expect(stderr).toStartWith(`rt could not move ${basename(repoPath)} to ${repoPath}: `);
    expect(stderr).toContain("  why: rt knows it at a folder that is gone, and moving its records did not finish.\n");
    expect(loadRepoIndex()[identity]).toBe(gone);
  });

  test("--json reports a failed move as an error envelope, never a registered one", async () => {
    const repoPath = makeTempRepo();
    execSync("git remote add origin git@gitlab.com:group/moved-json.git", { cwd: repoPath, stdio: "pipe" });
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    const gone = join(home, "gone-away-json");
    setKvValue("repo-index", identity, gone);
    saveRegistry(identity, [
      { name: "t1", path: join(gone, ".worktrees", "t1"), kind: "ephemeral", state: "on-deck", branch: "feat", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    mkdirSync(join(repoPath, ".worktrees", "t1"), { recursive: true });
    const deps = testDeps();

    await runExpectingProcessExit(() => reposRegister([repoPath, "--json"], {}, deps));

    expect(deps.lines).toHaveLength(1);
    const body = JSON.parse(deps.lines[0]!);
    expect(body.error?.code).toBe("locate-failed");
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
    expect(body.registered).toBeUndefined();
  });

  test("a move the daemon did not answer fails with the command that checks on it", async () => {
    const repoPath = makeTempRepo();
    execSync("git remote add origin git@gitlab.com:group/silent.git", { cwd: repoPath, stdio: "pipe" });
    const identity = serializeIdentity(await deriveRepoIdentity(repoPath));
    setKvValue("repo-index", identity, join(home, "gone-silent"));
    // The socket path is bound to the preload's throwaway HOME; a plain file
    // there reads as a present daemon that never answers.
    expect(DAEMON_SOCK_PATH).toContain("/rt-tests/");
    expect(existsSync(DAEMON_SOCK_PATH)).toBe(false);
    mkdirSync(dirname(DAEMON_SOCK_PATH), { recursive: true });
    writeFileSync(DAEMON_SOCK_PATH, "");
    try {
      const { code, stderr } = await human(() => reposRegister([repoPath], {}, testDeps()));
      expect(code).toBe(2);
      expect(stderr).toBe(
        `rt could not move ${basename(repoPath)} to ${repoPath}: the rt daemon is running but did not answer\n` +
          "  why: rt knows it at a folder that is gone, and moving its records did not finish.\n" +
          "  next: rt daemon status\n",
      );

      const deps = testDeps();
      expect(await runExpectingProcessExit(() => reposRegister([repoPath, "--json"], {}, deps))).toBe(2);
      const body = JSON.parse(deps.lines[0]!);
      expect(body.error).toEqual({ code: "locate-failed", message: `rt could not move ${basename(repoPath)} to ${repoPath}: the rt daemon is running but did not answer` });
    } finally {
      rmSync(DAEMON_SOCK_PATH, { force: true });
    }
  });

  test("the error envelopes the copy pass rewords keep their shape and codes", async () => {
    const plainDir = realpathSync(mkdtempSync(join(home, "notarepo-")));
    const cases: Array<[string[], string]> = [
      [["/no/such/path/here", "--json"], "bad-path"],
      [[plainDir, "--json"], "not-a-git-repo"],
    ];
    for (const [args, code] of cases) {
      const deps = testDeps();
      expect(await runExpectingProcessExit(() => reposRegister(args, {}, deps))).toBe(2);
      expect(deps.lines).toHaveLength(1);
      const body = JSON.parse(deps.lines[0]!);
      expect(Object.keys(body).sort()).toEqual(["at", "contract", "error"]);
      expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
      expect(body.error.code).toBe(code);
      expect(typeof body.error.message).toBe("string");
    }
  });

  test("no paths exits 2 with a usage error", async () => {
    const deps = testDeps();
    const { code, stderr } = await human(() => reposRegister([], {}, deps));
    expect(code).toBe(2);
    expect(stderr).toBe("Which repo?\n  next: rt repos register <path…> [--track live|poll] [--caches branches,project-mrs] [--json]\n");
  });

  test("a nonexistent path exits 2 with a bad-path error", async () => {
    const deps = testDeps();
    const { code, stderr } = await human(() => reposRegister(["/no/such/path/here"], {}, deps));
    expect(code).toBe(2);
    expect(stderr).toBe("There is no folder at /no/such/path/here\n");
  });

  test("an unknown --track value exits 2", async () => {
    const repoPath = makeTempRepo();
    const deps = testDeps();
    const { code, stderr } = await human(() => reposRegister([repoPath, "--track", "bogus"], {}, deps));
    expect(code).toBe(2);
    expect(stderr).toStartWith('Tracking is live or poll\n  why: You passed "bogus".\n');
  });

  test("a directory that exists but isn't a git repo exits 2, not a claimed success", async () => {
    const plainDir = realpathSync(mkdtempSync(join(home, "notarepo-")));
    const deps = testDeps();

    const { code, stderr } = await human(() => reposRegister([plainDir], {}, deps));

    expect(code).toBe(2);
    expect(stderr).toBe(`${plainDir} is not a git repo\n  why: rt can only register a folder that git tracks.\n`);
    expect(getKnownRepos().find((r) => r.repoName === basename(plainDir))).toBeUndefined();
  });

  test("multi-path register is all-or-nothing: a bad path later in the list leaves an earlier good one untouched", async () => {
    const goodPath = makeTempRepo();
    const goodName = basename(goodPath);
    const badPath = realpathSync(mkdtempSync(join(home, "notarepo-")));
    const deps = testDeps();

    const { code } = await human(() => reposRegister([goodPath, badPath, "--track", "live"], {}, deps));

    expect(code).toBe(2);
    // Neither the index nor the tracking grant for the good path was written —
    // a partial apply would leave it indexed without the --track it asked for.
    expect(getKnownRepos().find((r) => r.repoName === goodName)).toBeUndefined();
    expect(loadRepoTracking()[goodName]).toBeUndefined();
  });
});

describe("reposPrune", () => {
  const origHome = process.env.HOME;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "rt-repos-prune-home-")));
    process.env.HOME = home;
    closeStateDb();
  });

  afterEach(() => {
    closeStateDb();
    process.env.HOME = origHome;
    rmSync(home, { recursive: true, force: true });
  });

  function makeTempRepo(name: string): string {
    const dir = join(home, name);
    mkdirSync(dir, { recursive: true });
    execSync("git init -q", { cwd: dir });
    return realpathSync(dir);
  }

  test("reports a clean index as clean", async () => {
    updateRepoIndex("alpha", makeTempRepo("alpha"));
    const deps = testDeps();

    const { lines } = await human(() => reposPrune([], {}, deps));

    expect(lines).toEqual(["[skipped] Nothing to prune  every repo rt knows is still there"]);
  });

  test("removes a renamed repo's retired name and says which name kept the directory", async () => {
    const deck = makeTempRepo("deck");
    symlinkSync(deck, join(home, "local-apps"));
    updateRepoIndex("local-apps", join(home, "local-apps"));
    updateRepoIndex("deck", deck);
    const deps = testDeps();

    const { lines } = await human(() => reposPrune([], {}, deps));

    // updateRepoIndex stores what `git worktree list` reports, which resolves
    // the symlink — so both names land on the SAME spelling here. The other
    // shape (a row still holding the symlink path, from an older write or the
    // legacy repos.json import) is covered in repo-index-rename.test.ts.
    expect(lines).toEqual([`[ok] Removed local-apps  ${deck.replace(homedir(), "~")} · same folder as deck`]);
    expect(loadRepoIndexEntries().map((e) => e.repoName)).toEqual(["deck"]);
  });

  test("--dry-run says what it would do and writes nothing", async () => {
    updateRepoIndex("gone", join(home, "never-existed"));
    const deps = testDeps();

    const { lines } = await human(() => reposPrune(["--dry-run"], {}, deps));

    expect(lines).toEqual([`[not yet] Would remove gone  ${join(home, "never-existed").replace(homedir(), "~")} · its folder is gone`]);
    expect(loadRepoIndexEntries().map((e) => e.repoName)).toEqual(["gone"]);
  });

  test("a dropped dead registry is named in the removal line", async () => {
    updateRepoIndex("deleted", join(home, "deleted-repo"));
    setKvValue("worktree-registry", "deleted", [
      { name: "deleted", path: join(home, "deleted-repo"), kind: "main", branch: "main", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const deps = testDeps();

    const { lines } = await human(() => reposPrune([], {}, deps));

    expect(lines).toEqual([`[ok] Removed deleted  ${join(home, "deleted-repo").replace(homedir(), "~")} · its folder is gone; dropped its worktree list, which only named folders that are gone`]);
  });

  test("--json emits the removals in an envelope", async () => {
    updateRepoIndex("gone", join(home, "never-existed"));
    const deps = testDeps();

    await reposPrune(["--json"], {}, deps);

    const parsed = JSON.parse(deps.lines[0]!);
    expect(parsed.contract).toBe(1);
    expect(parsed.dryRun).toBe(false);
    expect(parsed.removed).toEqual([
      { repoName: "gone", path: join(home, "never-existed"), reason: "missing" },
    ]);
  });

  test("an unknown flag is a usage error, not a silent no-op prune", async () => {
    updateRepoIndex("gone", join(home, "never-existed"));
    const deps = testDeps();

    const { code, stderr } = await human(() => reposPrune(["--force"], {}, deps));

    expect(code).toBe(2);
    expect(stderr).toBe("This command has no option called --force\n  next: rt repos prune [--dry-run] [--json]\n");
    expect(loadRepoIndexEntries().map((e) => e.repoName)).toEqual(["gone"]);
  });

  test("a name folded into the identity row names that repo in full, never its key", async () => {
    const widgets = makeTempRepo("widgets");
    const identity = "remote:github.com%2Facme%2Fwidgets";
    setKvValue("repo-index", "widgets", widgets);
    setKvValue("repo-index", identity, widgets);
    mkdirSync(repoDataDir("widgets"), { recursive: true });
    writeFileSync(join(repoDataDir("widgets"), "notes.json"), "{}");

    const { lines } = await human(() => reposPrune([], {}, testDeps()));

    expect(lines).toEqual([
      `[ok] Removed widgets  ${widgets.replace(homedir(), "~")} · same folder as github.com/acme/widgets; carried 1 file to github.com/acme/widgets`,
    ]);
    expect(loadRepoIndexEntries().map((e) => e.repoName)).toEqual([identity]);
  });

  test("a row rt was too busy to clear is kept, with the command to try again", () => {
    const text = renderPlain(pruneBlocks([{ repoName: "gone", path: "/x/gone", reason: "missing", registry: "busy", retained: true }], false));
    expect(text).toBe("[warning] Kept gone  /x/gone · its folder is gone, and rt was busy and could not clear its worktree list\n  next: rt repos prune\n");
  });

  test("a duplicate whose data could not all move is kept, naming the repo that kept the folder", () => {
    const text = renderPlain(
      pruneBlocks(
        [
          {
            repoName: "widgets",
            path: "/x/widgets",
            reason: "duplicate",
            keptAs: "remote:github.com%2Facme%2Fwidgets",
            data: { moved: [], merged: [], refused: ["notes.json"], removedDir: false, registry: "none" },
            retained: true,
          },
        ],
        false,
      ),
    );
    expect(text).toBe(
      "[warning] Kept widgets  /x/widgets · same folder as github.com/acme/widgets, but not all of its data could move; kept both copies of notes.json\n",
    );
  });

  test("a retained missing row tells the operator to locate it", async () => {
    const { setKvValue } = await import("../../lib/state/index.ts");
    updateRepoIndex("moved-repo", join(home, "gone-away"));
    setKvValue("worktree-registry", "moved-repo", [
      { name: "t1", path: join(home, "gone-away", ".worktrees", "t1"), kind: "ephemeral", state: "on-deck", branch: "on-deck/t1", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const deps = testDeps();

    const { lines } = await human(() => reposPrune([], {}, deps));

    expect(lines[0]).toStartWith("[needs you] Kept moved-repo  ");
    expect(lines[0]).toEndWith("its folder is gone, but it still has worktrees on record");
    expect(lines[1]).toBe("  next: rt repos locate <new-path> --repo moved-repo");
    expect(loadRepoIndex()["moved-repo"]).toBeDefined();
  });
});
