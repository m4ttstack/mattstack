import type { GitRunner } from "./git-tools.ts";

/** Every name the remote's default branch may have, or null when none is
    known, which callers must refuse rather than treat as "no default".
    `refs/remotes/<remote>/HEAD` can be missing, or stale after the server's
    default moves (a fetch never updates it), so the remote is asked too and
    both answers are protected. `primary` prefers the remote's answer, the
    order rt sync resolves its rebase target in. */
export async function remoteDefault(cwd: string, git: GitRunner, remote = "origin"): Promise<{ names: string[]; primary: string } | null> {
  const prefix = `refs/remotes/${remote}/`;
  const sym = await git(["symbolic-ref", "--quiet", `${prefix}HEAD`], cwd);
  const symRef = sym.code === 0 ? sym.stdout.trim() : "";
  const local = symRef.startsWith(prefix) && symRef.length > prefix.length ? symRef.slice(prefix.length) : null;
  const ls = await git(["ls-remote", "--symref", "--end-of-options", remote, "HEAD"], cwd);
  const match = ls.code === 0 ? ls.stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m) : null;
  const asked = match ? match[1]! : null;
  const primary = asked ?? local;
  if (primary === null) return null;
  return { names: [...new Set([asked, local].filter((n): n is string => n !== null))], primary };
}
