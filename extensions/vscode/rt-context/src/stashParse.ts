/**
 * GitHub Desktop's stash marker. Using the exact same format keeps stashes
 * interoperable between this extension, rt and GitHub Desktop.
 * @see https://github.com/desktop/desktop/blob/development/app/src/lib/git/stash.ts
 */
export const DESKTOP_STASH_MARKER = '!!GitHub_Desktop';
const DESKTOP_STASH_RE = /!!GitHub_Desktop<(.+)>$/;

/** `git stash list` format this parser reads: ref, sha and subject, NUL-separated. */
export const STASH_LIST_FORMAT = '--format=%gd%x00%H%x00%gs';

export interface DesktopStashEntry {
  sha: string;
  branchName: string;
}

export function desktopStashMessage(branchName: string): string {
  return `${DESKTOP_STASH_MARKER}<${branchName}>`;
}

interface StashRow {
  ref: string;
  sha: string;
  subject: string;
}

function rows(stdout: string): StashRow[] {
  return stdout
    .split('\n')
    .map((line) => line.split('\0'))
    .filter((parts) => parts.length === 3 && parts[0]!.startsWith('stash@{'))
    .map(([ref, sha, subject]) => ({ ref: ref!, sha: sha!, subject: subject! }));
}

/** The newest Desktop-tagged stash for `branch`, by sha: every worktree shares one stash stack, so an index goes stale. */
export function findDesktopStashIn(stdout: string, branch: string): DesktopStashEntry | null {
  for (const row of rows(stdout)) {
    if (DESKTOP_STASH_RE.exec(row.subject)?.[1] === branch) return { sha: row.sha, branchName: branch };
  }
  return null;
}

/** The `stash@{n}` that holds `sha` right now, or null once it is gone. */
export function stashRefFor(stdout: string, sha: string): string | null {
  return rows(stdout).find((row) => row.sha === sha)?.ref ?? null;
}
