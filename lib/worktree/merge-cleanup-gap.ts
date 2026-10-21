/**
 * Why merge-driven worktree cleanup cannot run for a repo, if it can't. The
 * merge reactor and the stale sweep both need the branch cache to hold PR
 * state, which takes a `branches` tracking grant and a forge token; either one
 * missing leaves merged trees claimed with nothing said anywhere.
 */

import { forgeTokenFor, type Forge } from "../enrich.ts";
import { getSetting } from "../settings/resolve.ts";
import { deriveRepoIdentity } from "../settings/identity.ts";
import { grants, loadMachineRepoTrackingRaw, type CacheKind, type RepoTracking, type TrackingMode } from "../repo-tracking.ts";
import { loadWorktreeAppConfig } from "./config.ts";
import { runCapture } from "../subprocess.ts";

/** `mode`/`caches` are the grant the repo has now, so a fix can add `branches` without dropping the rest. */
export type MergeCleanupGap =
  | { reason: "app-off"; forge: Forge }
  | { reason: "tracking-off"; forge: Forge }
  | { reason: "no-branches-grant"; forge: Forge; mode: TrackingMode | "off"; caches: CacheKind[] }
  | { reason: "no-token"; forge: Forge };

/** A null `tracking` or `secrets` (a failed read) skips only the check that needs it. */
export async function mergeCleanupGap(
  repoName: string,
  repoPath: string,
  tracking: RepoTracking | null,
  secrets: { gitlabToken?: string; githubToken?: string } | null,
): Promise<MergeCleanupGap | null> {
  if (!(await noticeWanted(repoPath))) return null;
  const remote = await runCapture(["git", "config", "--get", "remote.origin.url"], { cwd: repoPath, timeoutMs: 5000 });
  const remoteUrl = remote.exitCode === 0 ? remote.stdout.trim() || undefined : undefined;
  const forge = await forgeTokenFor(remoteUrl, secrets ?? {});
  if (!forge) return null;
  // The merge reactor never runs with worktrees off, so tracking alone would fix nothing.
  if (!loadWorktreeAppConfig().enabled) return { reason: "app-off", forge: forge.forge };
  if (optedOut(repoName)) return { reason: "tracking-off", forge: forge.forge };
  if (tracking) {
    const g = grants(tracking, repoName);
    if (!g.caches.has("branches")) return { reason: "no-branches-grant", forge: forge.forge, mode: g.mode, caches: [...g.caches] };
  }
  return secrets && !forge.token ? { reason: "no-token", forge: forge.forge } : null;
}

/** A repo with no remote identity has no repo section to opt out in, so it always gets the notice. */
async function noticeWanted(repoPath: string): Promise<boolean> {
  const derived = await deriveRepoIdentity(repoPath);
  if (derived.kind !== "remote") return true;
  return getSetting<boolean>("rt.worktreeMergeCleanupNotice", { repoIdentity: derived.id }).value !== false;
}

/** An explicit `{mode: "off"}` is this Mac's own choice, often against a team grant; offering to track would quietly undo it. */
function optedOut(repoName: string): boolean {
  try {
    const entry = loadMachineRepoTrackingRaw()[repoName];
    return typeof entry === "object" && entry !== null && (entry as { mode?: unknown }).mode === "off";
  } catch {
    return false;
  }
}
