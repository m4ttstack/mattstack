type HistoryExec = (argv: [string, ...string[]]) => Promise<{ code: number; stdout: string }>;

const MAX_PENDING_COMMITS = 1000;
const MAX_PENDING_PATHS = 10000;
export const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** Inspect each commit, including reverted changes, both rename halves and every merge parent. */
export async function unpublishedPaths(exec: HistoryExec, range: string): Promise<string[] | null> {
  try {
    const history = await exec(["git", "rev-list", `--max-count=${MAX_PENDING_COMMITS + 1}`, range]);
    const commits = history.stdout.trim().split("\n").filter(Boolean);
    if (history.code !== 0 || commits.length > MAX_PENDING_COMMITS || commits.some((sha) => !GIT_OBJECT_ID.test(sha))) return null;
    const paths = new Set<string>();
    for (const sha of commits) {
      const changed = await exec(["git", "diff-tree", "--root", "-m", "--no-commit-id", "--name-only", "-r", "-z", "--no-renames", sha]);
      if (changed.code !== 0 || (changed.stdout !== "" && !changed.stdout.endsWith("\0"))) return null;
      for (const path of changed.stdout.split("\0").filter(Boolean)) paths.add(path);
      if (paths.size > MAX_PENDING_PATHS) return null;
    }
    return [...paths];
  } catch {
    return null;
  }
}
