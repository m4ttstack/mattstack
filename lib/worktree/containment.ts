import { headSha, isAncestorAsync, remoteDefaultRef, remoteRefExists, runGit } from "./git-async.ts";
import { runGitOrigin } from "./fetch-auth.ts";
import { childEnv } from "../subprocess.ts";

export type Containment = "in-default" | "on-remote" | "in-merged-mr" | "patch-identical" | "none";

const FETCH_TIMEOUT_MS = 60_000;
const PATCH_ID_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 2_000;

async function fetchSha(treePath: string, sha: string): Promise<boolean> {
  const r = await runGitOrigin(treePath, ["fetch", "--no-tags", "-q", "origin", sha], { timeoutMs: FETCH_TIMEOUT_MS });
  return r.exitCode === 0;
}

async function hasObject(treePath: string, sha: string): Promise<boolean> {
  return (await runGit(treePath, ["cat-file", "-e", `${sha}^{commit}`])).exitCode === 0;
}

/**
 * Stable patch-ids of `range`, one per commit. `git log -p` streams straight
 * into `git patch-id`: a range that brings a default branch's history along
 * runs to tens of MB, and holding it as a string on every 10s triage poll
 * churned the daemon's allocator until its RSS read in the gigabytes.
 */
async function patchIds(treePath: string, range: string): Promise<Set<string> | null> {
  const opts = { cwd: treePath, env: childEnv(), stderr: "ignore" } as const;
  let log: ReturnType<typeof Bun.spawn> | undefined;
  let pid: ReturnType<typeof Bun.spawn> | undefined;
  const signal = (sig: "SIGTERM" | "SIGKILL") => {
    for (const p of [log, pid]) { try { p?.kill(sig); } catch { /* already exited */ } }
  };
  try {
    log = Bun.spawn(["git", "log", "-p", "--no-merges", "--format=commit %H", range], { ...opts, stdout: "pipe" });
    pid = Bun.spawn(["git", "patch-id", "--stable"], { ...opts, stdin: log.stdout as ReadableStream, stdout: "pipe" });
  } catch {
    signal("SIGKILL");
    return null;
  }

  // Dispose holds the tree lock while this runs, hence the deadline.
  const run = Promise.all([new Response(pid.stdout as ReadableStream).text(), log.exited, pid.exited])
    .then(([out, logCode, pidCode]) => (logCode === 0 && pidCode === 0 ? out : null))
    .catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      signal("SIGTERM");
      setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS).unref?.();
      resolve(null);
    }, PATCH_ID_TIMEOUT_MS);
  });
  let out: string | null;
  try {
    out = await Promise.race([run, deadline]);
  } finally {
    clearTimeout(timer);
  }
  if (out === null) return null;
  return new Set(out.split("\n").filter(Boolean).map((l) => l.split(" ")[0]!));
}

type Fetch = (sha: string) => Promise<boolean>;

/** The commit is local, fetching it first when it is not. */
async function haveCommit(treePath: string, sha: string, fetch: Fetch = (s) => fetchSha(treePath, s)): Promise<boolean> {
  return (await hasObject(treePath, sha)) || ((await fetch(sha)) && (await hasObject(treePath, sha)));
}

/**
 * Every commit on `tip` that the default branch lacks has a patch-identical
 * twin on the MR side. Squash merges never match (their one commit is a new
 * patch); they still pass through the MR-sha ancestry check in containmentOf.
 * Missing objects fail closed.
 *
 * The MR side ranges from merge-base(tip, mrSha), not merge-base(defaultRef,
 * mrSha): once the forge's own merge (a merge commit or a fast-forward) has
 * landed, mrSha is itself an ancestor of defaultRef, collapsing
 * merge-base(defaultRef, mrSha) to mrSha and leaving the range empty. The tip
 * never moved, so merge-base(tip, mrSha) still finds the real fork point.
 *
 * --no-merges on the local side would pass a local merge commit's own diff
 * (a conflict resolution, a file staged only at merge time) through unseen,
 * so any merge commit ahead of defaultRef fails the whole check closed
 * before patch-ids are even compared.
 */
export async function patchIdenticalToMr(
  treePath: string,
  mrSha: string,
  defaultRef: string,
  fetch?: Fetch,
  tip = "HEAD",
): Promise<boolean> {
  if (!(await haveCommit(treePath, mrSha, fetch))) return false;
  const resolved = await runGit(treePath, ["rev-parse", `${tip}^{commit}`, `${defaultRef}^{commit}`]);
  if (resolved.exitCode !== 0) return false;
  const key = `${resolved.stdout.trim().split("\n").join("|")}|${mrSha}`;
  const known = patchIdenticalMemo.get(key);
  if (known !== undefined) return known;

  const verdict = await comparePatchIds(treePath, mrSha, defaultRef, tip);
  if (verdict !== null) remember(key, verdict);
  return verdict ?? false;
}

/** null when git could not answer (a timeout, a failed spawn): fail closed, but never remembered. */
async function comparePatchIds(treePath: string, mrSha: string, defaultRef: string, tip: string): Promise<boolean | null> {
  const localMerges = await runGit(treePath, ["rev-list", "--merges", `${defaultRef}..${tip}`]);
  if (localMerges.exitCode !== 0) return null;
  if (localMerges.stdout.trim().length > 0) return false;
  const mrBase = await runGit(treePath, ["merge-base", tip, mrSha]);
  if (mrBase.exitCode !== 0) return false;
  const local = await patchIds(treePath, `${defaultRef}..${tip}`);
  const merged = await patchIds(treePath, `${mrBase.stdout.trim()}..${mrSha}`);
  if (!local || !merged) return null;
  if (local.size === 0) return false;
  for (const id of local) if (!merged.has(id)) return false;
  return true;
}

/**
 * Keyed by the resolved tip, default-branch and MR commits, which fix the
 * answer: the tray asks every 10s, and each fresh answer re-reads every patch
 * in the MR's range.
 */
const patchIdenticalMemo = new Map<string, boolean>();
const PATCH_MEMO_MAX = 256;

function remember(key: string, verdict: boolean): void {
  if (patchIdenticalMemo.size >= PATCH_MEMO_MAX) patchIdenticalMemo.delete(patchIdenticalMemo.keys().next().value!);
  patchIdenticalMemo.set(key, verdict);
}

export const __test__ = {
  memoSize: () => patchIdenticalMemo.size,
  remember,
  clearMemo: () => patchIdenticalMemo.clear(),
  PATCH_MEMO_MAX,
};

type MrHead = { state?: string | null; sha?: string | null };

/** Weakest first: a tree is only as contained as its least-contained tip. */
const STRENGTH: Containment[] = ["none", "patch-identical", "in-merged-mr", "on-remote", "in-default"];

/**
 * Every tip dispose drops: HEAD, and the branch it deletes, which need not be
 * checked out. A branch at HEAD's own commit is left out, so the patch-id
 * pass never runs twice for one commit.
 */
async function droppedTips(treePath: string, branch: string | null): Promise<string[]> {
  const tips = ["HEAD"];
  if (!branch) return tips;
  const tip = await runGit(treePath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]);
  if (tip.exitCode === 0 && tip.stdout.trim() !== (await headSha(treePath))) tips.push(`refs/heads/${branch}`);
  return tips;
}

const mergedShaOf = (mr: MrHead | null): string | null => (mr?.state === "merged" && mr.sha ? mr.sha : null);

/**
 * A merged MR proves containment only for the commits it actually merged: a
 * reused branch name can resurface an older lifecycle's merged entry (the
 * cache is branch-keyed, and a by-branch API lookup returns the old MR until
 * a new one opens), and trusting it would dispose committed work the merge
 * never saw. The MR's source head sha settles it: squash/rebase merges
 * rewrite the TARGET, never the source branch, so a tip being an ancestor of
 * `mr.sha` means everything on it reached the MR that merged.
 * No sha (pre-field cache rows) or an unknown sha never covers.
 */
export async function mergedMrCoversTips(treePath: string, branch: string | null, mr: MrHead | null): Promise<boolean> {
  const mergedSha = mergedShaOf(mr);
  if (!mergedSha) return false;
  for (const tip of await droppedTips(treePath, branch)) if (!(await isAncestorAsync(treePath, tip, mergedSha))) return false;
  return true;
}

/**
 * The one "is this work safe to drop" rule: triage offers Dispose on it and
 * dispose's containment guard refuses on it, so the two can never disagree.
 * Every tip dispose drops must be on the default branch, on origin/<branch>,
 * inside a merged MR's source head, or patch-identical to it. The MR checks
 * exist because squash and rebase merges leave local heads diverged from
 * what landed, so every ancestry check against the target reads "unpushed"
 * for work that demonstrably merged; the MR's commit is fetched when it is
 * not local, before either MR check. A tip in the default branch is
 * contained even when a stale origin/<branch> disagrees: a forge's
 * delete-on-merge leaves the tracking ref behind until a prune.
 * Full refs, so a local branch named `origin/main` can never vouch.
 */
export async function containmentOf(
  treePath: string,
  branch: string | null,
  mr: MrHead | null,
  fetch?: Fetch,
): Promise<Containment> {
  const defaultRef = `refs/remotes/${await remoteDefaultRef(treePath)}`;
  const branchRef = branch && (await remoteRefExists(treePath, branch)) ? `refs/remotes/origin/${branch}` : null;
  const mergedSha = mergedShaOf(mr);
  let mrLocal: Promise<boolean> | undefined;
  const tipContainment = async (tip: string): Promise<Containment> => {
    if (await isAncestorAsync(treePath, tip, defaultRef)) return "in-default";
    if (branchRef && (await isAncestorAsync(treePath, tip, branchRef))) return "on-remote";
    if (!mergedSha || !(await (mrLocal ??= haveCommit(treePath, mergedSha, fetch)))) return "none";
    if (await isAncestorAsync(treePath, tip, mergedSha)) return "in-merged-mr";
    return (await patchIdenticalToMr(treePath, mergedSha, defaultRef, fetch, tip)) ? "patch-identical" : "none";
  };
  let weakest: Containment = "in-default";
  for (const tip of await droppedTips(treePath, branch)) {
    const c = await tipContainment(tip);
    if (STRENGTH.indexOf(c) < STRENGTH.indexOf(weakest)) weakest = c;
    if (weakest === "none") break;
  }
  return weakest;
}
