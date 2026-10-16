/**
 * herd:lanes reads: per-worktree drift against the default ref, cross-job
 * file collisions, and the merge state of a job's branch on its forge.
 */
import { GitHubProvider } from "@mattstack/glance";
import type { HerdLaneRow } from "../../packages/rt-client/src/commands.ts";
import { forgeTokenFor, isGitHubRemote, isGitLabRemote, parseRemoteUrl } from "../enrich.ts";
import { loadSecrets } from "../linear.ts";
import { identityFromRemote, serializeIdentity } from "../settings/identity.ts";
import { remoteDefaultRef, runGit } from "../worktree/git-async.ts";
import { getRepoContext } from "./freshness.ts";
import { listMrsLive } from "./forge-reads.ts";
import { redactCredentials } from "./redact-credentials.ts";

type Drift = HerdLaneRow["drift"];
type Merge = HerdLaneRow["merge"];

export interface LaneDeps {
  git(cwd: string, args: string[]): Promise<{ stdout: string; exitCode: number }>;
  defaultRef(cwd: string): Promise<string>;
  merge(worktree: string, branch: string): Promise<Merge>;
}

export function parseNumstat(out: string): Drift {
  const files: Drift["files"] = [];
  for (const line of out.split("\n")) {
    const [added, removed, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    files.push({ path, added: Number(added) || 0, removed: Number(removed) || 0 });
  }
  return {
    files,
    filesChanged: files.length,
    insertions: files.reduce((n, f) => n + f.added, 0),
    deletions: files.reduce((n, f) => n + f.removed, 0),
  };
}

export function collisions(rows: Array<{ job: string; files: string[] }>): Array<{ path: string; jobs: string[] }> {
  const byPath = new Map<string, string[]>();
  for (const { job, files } of rows) {
    for (const path of new Set(files)) byPath.set(path, [...(byPath.get(path) ?? []), job]);
  }
  return [...byPath].filter(([, jobs]) => jobs.length > 1).map(([path, jobs]) => ({ path, jobs }));
}

export async function measureLane(deps: LaneDeps, worktree: string): Promise<
  { ok: true; base: string; commits: number; drift: Drift } | { ok: false; error: string }
> {
  const base = await deps.defaultRef(worktree);
  const [diff, count] = await Promise.all([
    deps.git(worktree, ["diff", "--numstat", "--merge-base", base]),
    deps.git(worktree, ["rev-list", "--count", `${base}..HEAD`]),
  ]);
  if (diff.exitCode !== 0 || count.exitCode !== 0) return { ok: false, error: `git could not compare ${worktree} against ${base}` };
  return { ok: true, base, commits: Number(count.stdout.trim()) || 0, drift: parseNumstat(diff.stdout) };
}

export async function originUrl(deps: Pick<LaneDeps, "git">, worktree: string): Promise<string | undefined> {
  const r = await deps.git(worktree, ["config", "--get", "remote.origin.url"]);
  const url = r.stdout.trim();
  return r.exitCode === 0 && url ? url : undefined;
}

export function forgeOf(remoteUrl: string | undefined): Merge["forge"] {
  return isGitHubRemote(remoteUrl) ? "github" : isGitLabRemote(remoteUrl) ? "gitlab" : null;
}

export function unknownMerge(forge: Merge["forge"], err: unknown): Merge {
  const message = err instanceof Error ? err.message : String(err);
  return { forge, state: "unknown", url: null, number: null, mergedAt: null, error: redactCredentials(message) };
}

function mergeState(state: string): Merge["state"] {
  if (state === "opened" || state === "locked") return "open";
  if (state === "merged" || state === "closed") return state;
  return "unknown";
}

async function readMerge(worktree: string, branch: string): Promise<Merge> {
  const url = await originUrl(realLaneDeps, worktree);
  const forge = forgeOf(url);
  try {
    if (!url || !forge) return unknownMerge(null, "origin is on neither GitHub nor GitLab");
    const remote = parseRemoteUrl(url);
    if (!remote) return unknownMerge(forge, "could not parse the origin URL");
    // forgeTokenFor falls back to the gh session for a GitHub remote.
    const picked = await forgeTokenFor(url, await loadSecrets());
    if (forge === "github") {
      if (!picked?.token) return unknownMerge(forge, "no GitHub token (run: gh auth login)");
      const pr = await new GitHubProvider(remote.host, picked.token).fetchPullRequestByBranch(remote.projectPath, branch, "all");
      if (!pr) return { forge, state: "none", url: null, number: null, mergedAt: null };
      return { forge, state: mergeState(pr.state), url: pr.webUrl, number: pr.iid, mergedAt: pr.mergedAt ?? null };
    }
    const identity = identityFromRemote(url);
    if (!identity) return unknownMerge(forge, "could not derive the repo identity from the origin URL");
    const ctx = await getRepoContext(serializeIdentity(identity), worktree);
    const listed = await listMrsLive(ctx.provider, ctx.projectPath, { sourceBranch: branch, state: "all", limit: 1 });
    if (!listed.ok) return unknownMerge(forge, listed.error);
    const mr = listed.mrs[0];
    if (!mr) return { forge, state: "none", url: null, number: null, mergedAt: null };
    return { forge, state: mergeState(mr.state), url: mr.webUrl, number: mr.iid, mergedAt: null };
  } catch (err) {
    return unknownMerge(forge, err);
  }
}

export const realLaneDeps: LaneDeps = {
  git: (cwd, args) => runGit(cwd, args),
  defaultRef: remoteDefaultRef,
  merge: readMerge,
};
