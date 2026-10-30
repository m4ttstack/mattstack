/**
 * The home repo's remote: pointing ~/.mattstack/user at a remote and pushing
 * (`rt home remote set`, and home.init for a remote staged before Install),
 * and the staged choice itself in setup state.
 */

import { join } from "path";
import { UserActionableError } from "../errors.ts";
import { hasUrlCredentials, withoutUrls } from "../team/redact.ts";
import type { Probes } from "./probes.ts";
import { readSetupState, updateSetupState, type HomeBackupChoice } from "./state.ts";
import { homeGitDir } from "./home-paths.ts";

export type { HomeBackupChoice } from "./state.ts";

export interface HomeRemoteInput {
  url?: string;
  create?: boolean;
  name?: string;
}

export interface HomeRemoteResult {
  url: string;
  remote: "added" | "updated";
  pushed: true;
  created: boolean;
}

const HOME_REMOTE_DEFAULT_NAME = "mattstack-home";
/** URL remotes (https, ssh, git) and scp-style remotes (`[user@]host:path`, ssh-config aliases included). Local paths are not a backup, so they stay out. */
const GIT_REMOTE_URL_PATTERN = /^(?:(?:https?|ssh|git):\/\/[^\s/]+\/\S+|(?:[\w.-]+@)?[\w.-]+:[^\s-]\S*)$/;
/** git must fail rather than prompt: the app and the daemon have no terminal to answer on. */
const NO_PROMPT_ENV = { GIT_TERMINAL_PROMPT: "0" };

export function assertRemoteUrl(url: string): void {
  if (hasUrlCredentials(url)) {
    throw new UserActionableError("bad-url", "The remote URL carries a password. Drop it and let a credential helper (gh auth setup-git) supply it");
  }
  if (!GIT_REMOTE_URL_PATTERN.test(url)) {
    throw new UserActionableError("bad-url", `${withoutUrls(url)} is not a git remote (https://host/owner/repo.git, git@host:owner/repo.git or host:owner/repo.git)`);
  }
}

/**
 * Points the home repo at a remote and pushes, or creates the remote first
 * with `gh repo create` (private). Every refusal is a UserActionableError,
 * and its message passes through `withoutUrls`: git echoes the remote
 * (credentials included) in its own messages.
 */
export async function setHomeRemote(p: Probes, input: HomeRemoteInput, hooks: { onCreated?: (url: string) => void } = {}): Promise<HomeRemoteResult> {
  let url = input.url;
  if (url) assertRemoteUrl(url);

  const repoDir = join(p.home, ".mattstack", "user");
  if (!p.exists(homeGitDir(p.home))) {
    throw new UserActionableError("no-home-repo", `No home repo at ${repoDir} yet. Install creates it, or run rt home init`);
  }

  let created = false;
  if (!url) {
    const repoName = input.name ?? HOME_REMOTE_DEFAULT_NAME;
    const gh = await p.exec(["gh", "repo", "create", repoName, "--private"], { timeoutMs: 60_000, env: NO_PROMPT_ENV });
    if (gh.code !== 0) {
      throw new UserActionableError("create-failed", `Could not create ${repoName} with gh: ${withoutUrls((gh.stderr || gh.stdout).trim()) || `exit ${gh.code}`}`);
    }
    const printed = gh.stdout.trim().split("\n").find((line) => /^https?:\/\//.test(line.trim()))?.trim();
    if (!printed) throw new UserActionableError("create-failed", `gh created ${repoName} but printed no repository URL`);
    url = printed.endsWith(".git") ? printed : `${printed}.git`;
    assertRemoteUrl(url);
    created = true;
    hooks.onCreated?.(url);
  }

  const existing = await p.exec(["git", "-C", repoDir, "remote", "get-url", "origin"]);
  const previous = existing.code === 0 ? existing.stdout.trim() : null;
  const remote: "added" | "updated" = previous !== null ? "updated" : "added";
  const set = await p.exec(
    remote === "updated"
      ? ["git", "-C", repoDir, "remote", "set-url", "origin", url]
      : ["git", "-C", repoDir, "remote", "add", "origin", url],
  );
  if (set.code !== 0) throw new UserActionableError("remote-failed", `Could not set the remote: ${withoutUrls(set.stderr.trim()) || `exit ${set.code}`}`);

  const push = await p.exec(["git", "-C", repoDir, "push", "-u", "origin", "HEAD"], { timeoutMs: 120_000, env: NO_PROMPT_ENV });
  if (push.code !== 0) {
    const reason = withoutUrls(push.stderr.trim()) || `exit ${push.code}`;
    if (previous !== null) {
      // The old origin was working; a URL that cannot take a push must not replace it.
      const restore = await p.exec(["git", "-C", repoDir, "remote", "set-url", "origin", previous]);
      if (restore.code !== 0) {
        throw new UserActionableError("push-failed", `The push to the new URL failed, and the previous origin could not be restored (${withoutUrls(restore.stderr.trim()) || `exit ${restore.code}`}). Check git remote -v in ${repoDir}: ${reason}`);
      }
      throw new UserActionableError("push-failed", `The push to the new URL failed, so origin is back on the previous remote: ${reason}`);
    }
    throw new UserActionableError("push-failed", `Origin is set, but the push failed: ${reason}`);
  }

  return { url, remote, pushed: true, created };
}

type StateProbes = Parameters<typeof updateSetupState>[0];

export function stageHomeRemote(p: StateProbes, input: HomeRemoteInput): HomeBackupChoice {
  const choice: HomeBackupChoice = { mode: "remote", ...input };
  updateSetupState(p, (s) => ({ ...s, homeBackup: choice }));
  return choice;
}

export function writeHomeBackup(p: StateProbes, mode: "local" | "remote"): HomeBackupChoice {
  const choice: HomeBackupChoice = mode === "local" ? { mode: "local" } : { ...readSetupState(p).homeBackup, mode: "remote" };
  updateSetupState(p, (s) => ({ ...s, homeBackup: choice }));
  return choice;
}

/** A staged remote no push has landed on yet. */
export function pendingHomeRemote(p: Pick<Probes, "readFile" | "exists" | "home" | "now">): HomeRemoteInput | null {
  const choice = readSetupState(p).homeBackup;
  if (choice?.mode !== "remote" || choice.appliedAt !== undefined) return null;
  const { url, create, name } = choice;
  if (url !== undefined) return { url };
  if (create) return { create, ...(name !== undefined ? { name } : {}) };
  return null;
}

/** Written only after a push lands, so the remote is no longer staged. */
export function markHomeRemoteApplied(p: StateProbes, result: HomeRemoteResult): void {
  updateSetupState(p, (s) => ({ ...s, homeBackup: { mode: "remote", url: result.url, appliedAt: p.now().toISOString() } }));
}
