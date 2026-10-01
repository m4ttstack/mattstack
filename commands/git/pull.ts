/**
 * rt git pull: mirror of GitHub Desktop's "Pull origin" button.
 *
 * Faithful to desktop/desktop app/src/lib/git/pull.ts:
 *   git -c rebase.backend=merge pull [--ff] --recurse-submodules --progress [--no-verify] <remote>
 *
 * The merge-vs-rebase decision is delegated to the user's git config
 * (pull.rebase, branch.*.rebase), matching Desktop. --ff is added only
 * when pull.ff is unset, also matching Desktop.
 */

import { spawnSync } from "child_process";
import * as out from "../../lib/ui/out.ts";
import { getCurrentBranch, hasUncommittedChanges } from "../../lib/git-ops.ts";
import type { CommandContext } from "../../lib/command-tree.ts";
import { NOT_ON_A_BRANCH, refusalNote, uncommittedChanges } from "./shared.ts";

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

function hasPullFfConfig(cwd: string): boolean {
  const r = spawnSync("git", ["config", "--get", "pull.ff"], {
    cwd, stdio: "pipe", encoding: "utf8",
  });
  return r.status === 0 && (r.stdout ?? "").trim().length > 0;
}

export async function pullCommand(
  args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;

  const branch = getCurrentBranch(cwd);
  if (!branch) {
    out.fail(NOT_ON_A_BRANCH);
    process.exit(1);
  }

  if (hasUncommittedChanges(cwd)) {
    out.note(...refusalNote(uncommittedChanges("A pull could overwrite them.")));
    process.exit(1);
  }

  const remote = argValue(args, "--remote") ?? "origin";
  const dryRun = args.includes("--dry-run");
  const noVerify = args.includes("--no-verify");
  const forceRebase = args.includes("--rebase");
  const forceNoRebase = args.includes("--no-rebase");

  const gitArgs: string[] = ["-c", "rebase.backend=merge", "pull"];

  if (!hasPullFfConfig(cwd)) gitArgs.push("--ff");
  if (forceRebase) gitArgs.push("--rebase");
  if (forceNoRebase) gitArgs.push("--no-rebase");
  gitArgs.push("--recurse-submodules", "--progress");
  if (noVerify) gitArgs.push("--no-verify");
  gitArgs.push(remote);

  if (dryRun) {
    out.print(out.line("skipped", `Would pull ${branch} from ${remote}`, "dry run"), out.copy(`git ${gitArgs.join(" ")}`, "the command"));
    return;
  }

  out.print(out.line("running", `Pulling ${branch} from ${remote}`));
  const r = spawnSync("git", gitArgs, { cwd, stdio: "inherit" });
  if (r.status === 0) {
    out.print(out.line("done", `Pulled ${branch}`, `from ${remote}`));
    return;
  }

  process.exit(r.status ?? 1);
}
