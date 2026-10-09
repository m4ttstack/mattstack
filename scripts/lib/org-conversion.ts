import { execFileSync } from "child_process";
import { lstatSync } from "fs";
import { basename, join, resolve } from "path";
import { UserActionableError } from "../../lib/errors.ts";
import { shellQuote } from "../../lib/herdr-launch.ts";
import { getSetting } from "../../lib/settings/resolve.ts";
import { childEnv } from "../../lib/subprocess.ts";
import { readForgeUsername, sameUser } from "../../packages/rt-client/src/index.ts";

/** A conversion that declines by policy; the script shell prints it with `refuse` and exits 2. */
export class ConversionRefusal extends Error {
  constructor(message: string, readonly why?: string, readonly next?: string | string[]) {
    super(message);
  }
}

export interface Clone { path: string; git: (...argv: string[]) => string }

/** The clone root check. Runs before planning, in plan mode too. */
export function cloneRoot(cloneArg: string): Clone {
  const path = resolve(cloneArg);
  const git = (...argv: string[]) => execFileSync("git", ["-C", path, ...argv], { encoding: "utf8", env: childEnv(), stdio: "pipe" });
  if (resolve(git("rev-parse", "--show-toplevel").trim()) !== path) throw new ConversionRefusal("Choose the root of the clone");
  return { path, git };
}

/** Refuses when any segment of `rel` under the clone is a symbolic link. */
export function assertNoLink(clone: string, rel: string): void {
  let path = clone;
  for (const part of rel.split("/")) {
    path = join(path, part);
    let stat;
    try { stat = lstatSync(path); } catch (err) {
      if (["ENOENT", "ENOTDIR"].includes((err as NodeJS.ErrnoException).code ?? "")) break;
      throw err;
    }
    if (stat.isSymbolicLink()) throw new ConversionRefusal("The move paths contain a symbolic link", "Use ordinary files and folders so the move stays inside this clone.");
  }
}

/** The write-time checks. Returns the branch and the commit to roll back to. `usage` is the script line a mismatched admin reruns. */
export function preflight(clone: Clone, admin: string, opts: { managedFolders: readonly string[]; usage?: string }): { branch: string; start: string } {
  const { git } = clone;
  const quoted = shellQuote(clone.path);
  if (getSetting<{ enabled?: boolean }>("rt.teamSnapshot").value?.enabled !== false) {
    throw new ConversionRefusal("Team sync is on for this Mac", "It could push the move before you review it. Turn sync off, restart the daemon, and turn it back on after you publish.", ["rt settings set rt.teamSnapshot '{\"enabled\": false}' --scope machine", "rt daemon restart"]);
  }
  const recorded = readForgeUsername(basename(clone.path));
  if (recorded === null || !sameUser(recorded, admin)) {
    throw new ConversionRefusal(recorded === null ? "This Mac has no recorded forge username" : `This Mac is recorded as ${recorded}`, `The recorded username must match ${admin} so you can publish as this org's admin.`, recorded === null ? "rt setup apply --only team.identity" : opts.usage);
  }
  if (git("status", "--porcelain", "--untracked-files=all").trim() !== "") throw new ConversionRefusal("The clone has uncommitted changes", "Commit or discard them before moving.");
  if (git("status", "--porcelain", "--untracked-files=all", "--ignored", "--", ...opts.managedFolders).trim() !== "") throw new ConversionRefusal("The clone has ignored files in its managed folders", "Move them aside before moving so a failed move can restore the clean start.");
  let branch: string | null;
  try {
    branch = git("symbolic-ref", "-q", "--short", "HEAD").trim() || null;
  } catch {
    branch = null;
  }
  if (branch === null) throw new ConversionRefusal("The clone has no branch checked out", "The move commits to the branch you are on, and rt publishes that branch.", `git -C ${quoted} switch main`);
  try {
    execFileSync("git", ["-C", clone.path, "fetch", "-q", "origin"], { encoding: "utf8", env: { ...childEnv(), GIT_TERMINAL_PROMPT: "0" }, stdio: "pipe" });
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr;
    throw new UserActionableError("fetch-failed", "Could not fetch origin to check that the clone is current", {}, { next: `git -C ${quoted} fetch origin`, log: stderr || (err instanceof Error ? err.message : String(err)) });
  }
  let originBranch: string;
  try {
    originBranch = git("rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`).trim();
  } catch {
    throw new ConversionRefusal(`Origin has no ${branch} branch`, "rt publishes the branch you are on, so origin needs it before moving. Push it once.", `git -C ${quoted} push -u origin ${shellQuote(branch)}`);
  }
  const [ahead, behind] = git("rev-list", "--left-right", "--count", `HEAD...${originBranch}`).trim().split(/\s+/).map(Number);
  if (ahead === 0 && behind! > 0) throw new ConversionRefusal("The clone is behind origin", `Origin has ${behind} commit${behind === 1 ? "" : "s"} this clone does not. Moving now would leave them out, and the publish would be refused.`, `git -C ${quoted} pull --ff-only`);
  if (ahead! > 0) throw new ConversionRefusal("The clone has commits origin does not have", "Publish or drop them first, so the move is the only change you publish.", `git -C ${quoted} log --oneline ${shellQuote(`origin/${branch}..HEAD`)}`);
  return { branch, start: git("rev-parse", "HEAD").trim() };
}
