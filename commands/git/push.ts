/**
 * rt git push         Push the current branch, guaranteeing upstream is
 *                     origin/<branch>. Detects post-rebase divergence and
 *                     points the user at `rt git push force`.
 * rt git push force   Same, with --force-with-lease (for rebased or amended
 *                     branches). Plain --force is intentionally unsupported.
 * rt git upstream     Fix branch.<name>.remote and .merge without pushing.
 *
 * Fixes the common "new feature branch tracks origin/master" issue by
 * rewriting the tracking config before the push and using an explicit
 * `git push -u origin <branch>` refspec, so a stale upstream cannot
 * misdirect the push.
 */

import { execFileSync, spawnSync } from "child_process";
import * as out from "../../lib/ui/out.ts";
import { getCurrentBranch } from "../../lib/git-ops.ts";
import { withoutUrls } from "../../lib/team/redact.ts";
import type { CommandContext } from "../../lib/command-tree.ts";
import { NOT_ON_A_BRANCH } from "./shared.ts";

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

interface UpstreamConfig {
  remote: string;
  merge: string;
}

function gitConfigGet(key: string, cwd: string): string | null {
  const r = spawnSync("git", ["config", "--get", key], {
    cwd, stdio: "pipe", encoding: "utf8",
  });
  if (r.status !== 0) return null;
  const value = (r.stdout ?? "").trim();
  return value.length > 0 ? value : null;
}

function getUpstreamConfig(branch: string, cwd: string): UpstreamConfig | null {
  const remote = gitConfigGet(`branch.${branch}.remote`, cwd);
  const merge = gitConfigGet(`branch.${branch}.merge`, cwd);
  if (!remote || !merge) return null;
  return { remote, merge };
}

function setUpstreamConfig(branch: string, remote: string, cwd: string): void {
  execFileSync("git", ["config", `branch.${branch}.remote`, remote], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", `branch.${branch}.merge`, `refs/heads/${branch}`], { cwd, stdio: "pipe" });
}

const SCHEME_USERINFO_RE = /^([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/i;

/** The only way a remote name or URL reaches the screen: userinfo of any scheme and token shapes are dropped. The argv given to git stays the real value. */
function printable(remote: string): string {
  return withoutUrls(remote).replace(SCHEME_USERINFO_RE, "$1");
}

function labelUpstream(u: UpstreamConfig | null): string {
  if (!u) return "nothing";
  return `${printable(u.remote)}/${u.merge.replace(/^refs\/heads\//, "")}`;
}

function isUpstreamCorrect(
  current: UpstreamConfig | null,
  branch: string,
  remote: string,
): boolean {
  return !!current
    && current.remote === remote
    && current.merge === `refs/heads/${branch}`;
}

// ─── rt git upstream ────────────────────────────────────────────────────────

export async function upstreamCommand(
  args: string[],
  ctx: CommandContext,
): Promise<void> {
  const cwd = ctx.identity!.repoRoot;
  const dryRun = args.includes("--dry-run");
  const remote = argValue(args, "--remote") ?? "origin";

  const branch = getCurrentBranch(cwd);
  if (!branch) {
    out.fail(NOT_ON_A_BRANCH);
    process.exit(1);
  }

  const current = getUpstreamConfig(branch, cwd);
  const wanted = `${printable(remote)}/${branch}`;

  if (isUpstreamCorrect(current, branch, remote)) {
    out.print(out.line("done", `${branch} already tracks ${wanted}`));
    return;
  }

  if (dryRun) {
    out.print(out.line("skipped", `Would point ${branch} at ${wanted}`, `it tracks ${labelUpstream(current)} now`));
    return;
  }

  setUpstreamConfig(branch, remote, cwd);
  out.print(out.line("done", `${branch} now tracks ${wanted}`, `it tracked ${labelUpstream(current)}`));
}

// ─── rt git push ────────────────────────────────────────────────────────────

/**
 * Returns true if origin/<branch> is an ancestor of HEAD (fast-forward push
 * possible), false if they've diverged (force needed), or null if the remote
 * branch doesn't exist yet (first push).
 */
function isFastForwardPossible(
  branch: string,
  remote: string,
  cwd: string,
): boolean | null {
  const verify = spawnSync("git", ["rev-parse", "--verify", `${remote}/${branch}`], {
    cwd, stdio: "pipe",
  });
  if (verify.status !== 0) return null;

  const r = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", `${remote}/${branch}`, "HEAD"],
    { cwd, stdio: "pipe" },
  );
  return r.status === 0;
}

interface PushOptions {
  force: boolean;
}

/** Returns false when the user cancelled at the diverged-branch prompt;
 *  true when the push ran (or --dry-run rehearsed it). Hard failures exit. */
async function runPush(
  args: string[],
  ctx: CommandContext,
  opts: PushOptions,
): Promise<boolean> {
  const cwd = ctx.identity!.repoRoot;
  const dryRun = args.includes("--dry-run");
  const noVerify = args.includes("--no-verify");
  const remote = argValue(args, "--remote") ?? "origin";
  const shown = printable(remote);

  const branch = getCurrentBranch(cwd);
  if (!branch) {
    out.fail(NOT_ON_A_BRANCH);
    process.exit(1);
  }

  let force = opts.force;

  // Non-force path: detect divergence up front. Offer force-with-lease
  // interactively so the user doesn't have to re-invoke the command.
  if (!force) {
    const ff = isFastForwardPossible(branch, remote, cwd);
    if (ff === false) {
      if (process.stdin.isTTY) {
        const { select } = await import("../../lib/rt-render.ts");
        const choice = await select({
          message: `${branch} and ${shown}/${branch} have diverged, usually after a rebase or an amend. Force push?`,
          options: [
            { value: "force", label: "Force push with --force-with-lease" },
            { value: "cancel", label: "Cancel" },
          ],
        });
        if (choice !== "force") {
          out.print(out.line("skipped", "Nothing was pushed"));
          return false;
        }
        force = true;
      } else {
        out.fail({
          title: `${branch} and ${shown}/${branch} have diverged`,
          why: "This usually follows a rebase or an amend, and a plain push would be rejected.",
          next: out.cmd("rt git push force"),
        });
        process.exit(1);
      }
    }
  }

  // Pre-push: rewrite branch config so a later bare `git push` also works.
  // This is the fix for the "new branch tracks origin/master" problem.
  const current = getUpstreamConfig(branch, cwd);
  const upstreamWasWrong = !isUpstreamCorrect(current, branch, remote);
  if (upstreamWasWrong && !dryRun) {
    setUpstreamConfig(branch, remote, cwd);
  }

  const gitArgs: string[] = ["push"];
  if (force) gitArgs.push("--force-with-lease");
  if (noVerify) gitArgs.push("--no-verify");
  gitArgs.push("-u", remote, branch);

  const target = `${shown}/${branch}`;

  if (dryRun) {
    out.print(
      out.line("skipped", `Would push ${branch} to ${target}`, force ? "dry run, forcing with a lease" : "dry run"),
      ...(upstreamWasWrong ? [out.callout("note", `This branch tracks ${labelUpstream(current)}. A real push points it at ${target}.`)] : []),
      out.copy(`git ${[...gitArgs.slice(0, -2), shown, branch].join(" ")}`, "the command"),
    );
    return true;
  }

  out.print(
    out.line("running", `Pushing ${branch} to ${target}`, force ? "forcing, with a lease" : undefined),
    ...(upstreamWasWrong ? [out.callout("note", `This branch tracked ${labelUpstream(current)}. It now tracks ${target}.`)] : []),
  );

  const r = spawnSync("git", gitArgs, { cwd, stdio: "inherit" });
  if (r.status === 0) {
    out.print(out.line("done", `Pushed ${branch}`, `to ${target}`));
    return true;
  }
  process.exit(r.status ?? 1);
}

export async function pushCommand(
  args: string[],
  ctx: CommandContext,
): Promise<boolean> {
  return runPush(args, ctx, { force: false });
}

export async function forcePushCommand(
  args: string[],
  ctx: CommandContext,
): Promise<boolean> {
  return runPush(args, ctx, { force: true });
}
