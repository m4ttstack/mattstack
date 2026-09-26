import { GitShell } from './git-shell.ts';

export interface DiscoveredBranch {
  branch: string;
  parent: string;
}

export interface DiscoveredStack {
  root: string;
  branches: DiscoveredBranch[];
}

const COMMON_ROOTS = ['main', 'master', 'develop', 'dev'];

/**
 * Discover local branch stacks by analyzing merge-base relationships.
 *
 * 1. Lists all local branches
 * 2. Identifies likely root branches (main/master/develop or branches that are ancestors of many others)
 * 3. For each non-root branch, finds the most likely parent using merge-base proximity
 * 4. Groups into tree structures
 */
export async function discoverLocalStacks(
  cwd: string,
  defaultRoot?: string,
): Promise<DiscoveredStack[]> {
  const allBranches = await GitShell.listLocalBranches(cwd);
  if (allBranches.length === 0) return [];

  const roots = allBranches.filter((b) => COMMON_ROOTS.includes(b));
  if (roots.length === 0 && defaultRoot && allBranches.includes(defaultRoot)) {
    roots.push(defaultRoot);
  }
  if (roots.length === 0) return [];

  const nonRoots = allBranches.filter((b) => !roots.includes(b));
  if (nonRoots.length === 0) return [];

  const stacks: DiscoveredStack[] = [];

  for (const root of roots) {
    const branches: DiscoveredBranch[] = [];
    const remaining = [...nonRoots];
    const inStack = new Set<string>([root]);

    for (const branch of remaining) {
      const isDesc = await GitShell.isAncestor(cwd, root, branch).catch(() => false);
      if (!isDesc) continue;

      const parent = await findClosestParent(cwd, branch, [...inStack]);
      branches.push({ branch, parent: parent ?? root });
      inStack.add(branch);
    }

    if (branches.length > 0) {
      stacks.push({ root, branches });
    }
  }

  return stacks;
}

async function findClosestParent(
  cwd: string,
  branch: string,
  candidates: string[],
): Promise<string | null> {
  let best: string | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const isAnc = await GitShell.isAncestor(cwd, candidate, branch).catch(() => false);
    if (!isAnc) continue;

    try {
      const base = await GitShell.getMergeBase(cwd, candidate, branch);
      const head = await GitShell.getBranchHead(cwd, candidate);
      if (base === head) {
        const branchHead = await GitShell.getBranchHead(cwd, branch);
        const { stdout } = await countCommits(cwd, head, branchHead);
        const distance = parseInt(stdout, 10) || Infinity;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      } else {
        if (best === null) best = candidate;
      }
    } catch {
      if (best === null) best = candidate;
    }
  }

  return best;
}

async function countCommits(cwd: string, from: string, to: string): Promise<{ stdout: string }> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    execFile('git', ['rev-list', '--count', `${from}..${to}`], { cwd }, (err, stdout) => {
      if (err) reject(err);
      else resolve({ stdout: stdout.trim() });
    });
  });
}
