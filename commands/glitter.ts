/**
 * rt glitter: repos, changes, diff, and commit in one board. The command is
 * the gate and the wiring; the loop and state machine live in
 * lib/mission/driver.ts and the view paints in the bundled Go rt-ui helper.
 */
import { existsSync } from "fs";
import type { CommandContext } from "../lib/command-tree.ts";
import { createFileActions } from "../lib/file-actions.ts";
import { MissionDriver, type MissionDeps } from "../lib/mission/driver.ts";
import { publishRepo, runAction } from "../lib/mission/git-actions.ts";
import { resolveGlitterStart, readLastRepo } from "../lib/mission/launch.ts";
import { interactive } from "../lib/ui/gate.ts";
import { exit, openSession } from "../lib/ui/spawn.ts";
import { SessionDied } from "../lib/runner/runner.ts";
import { createGitClient } from "../packages/git-core/src/index.ts";
import { daemonQuery, subscribeToDaemon } from "../lib/daemon-client.ts";
import { buildWorktreeGuardMap, checkBranchGuard } from "../lib/branch-guard.ts";
import { commitStaged, amendStaged } from "../lib/commit-ops.ts";
import { getPullRebase, getRemoteDefaultBranch } from "../lib/git-ops.ts";
import { getRepoRoot } from "../lib/git.ts";
import { identityForRootReadOnly, getKnownReposCached, repoOptions, repoFromOptionValue } from "../lib/repo.ts";
import { filterableSelect } from "../lib/pick-wrappers.ts";
import { listWorktreesAsync } from "../lib/worktree/git-async.ts";
import { launchEditorDetached, resolveEditorForDir } from "./code.ts";

async function pickRepoRoot(): Promise<string | null> {
  const repos = getKnownReposCached({ includeMissing: false });
  if (repos.length === 0) {
    process.stderr.write("rt glitter: not in a git repo and no repos found under your repo roots\n");
    return null;
  }
  const picked = await filterableSelect({ message: "Pick a repo for rt glitter", options: repoOptions(repos), breadcrumb: ["rt", "glitter"] });
  if (!picked) return null;
  return repoFromOptionValue(repos, picked)?.worktrees[0]?.path ?? null;
}

export async function glitterCommand(_args: string[], _ctx: CommandContext): Promise<void> {
  if (!interactive()) {
    process.stderr.write("rt glitter needs an interactive terminal (it drives a live board from the one you are in)\n");
    return exit(1);
  }

  const start = await resolveGlitterStart({
    repoRoot: () => getRepoRoot(),
    identityOf: identityForRootReadOnly,
    readLast: readLastRepo,
    pathExists: existsSync,
    pick: pickRepoRoot,
  });
  if (start.kind === "cancelled") return exit(0);

  const deps: MissionDeps = {
    openSession,
    client: (dir: string) => createGitClient(dir),
    daemonQuery,
    subscribe: subscribeToDaemon,
    runAction,
    publishRepo: (cwd, opts) => publishRepo(cwd, opts),
    commit: commitStaged,
    amend: amendStaged,
    guard: checkBranchGuard,
    now: () => new Date(),
    resolveDefaultBranch: getRemoteDefaultBranch,
    readPullRebase: getPullRebase,
    buildGuards: buildWorktreeGuardMap,
    listGitWorktrees: listWorktreesAsync,
    fileActions: createFileActions(),
    resolveEditor: resolveEditorForDir,
    launchEditor: launchEditorDetached,
    pathExists: existsSync,
  };

  const driver = new MissionDriver(deps, {
    repo: start.repo,
    worktree: start.worktree,
  });

  const onSignal = () => {
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.once("SIGHUP", onSignal);

  try {
    await driver.run();
  } catch (err) {
    if (err instanceof SessionDied) {
      process.stderr.write(`\n  ${err.message}; the workspace was closed\n\n`);
      return exit(1);
    }
    throw err;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("SIGHUP", onSignal);
  }
}
