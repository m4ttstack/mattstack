import type { Probes } from "../setup/probes.ts";
import { gitWithToken } from "./git-credential.ts";
import { GIT_OBJECT_ID } from "./publish-history.ts";
import { withoutUrls } from "./redact.ts";

export type RemoteHead = { ok: true; sha: string | null } | { ok: false; log: string };

/** The sha `target` (a remote name or url) holds for `ref`, null when it has no such branch. */
export async function remoteHead(p: Probes, dir: string, target: string, ref: string, token: string | null, remote: string | null): Promise<RemoteHead> {
  const lookup = gitWithToken(["ls-remote", "--refs", "--", target, ref], token, { GIT_TERMINAL_PROMPT: "0" }, { remote });
  const res = await p.exec(lookup.argv, { cwd: dir, env: lookup.env });
  const log = () => withoutUrls(`${res.stdout}\n${res.stderr}`.trim());
  if (res.code !== 0) return { ok: false, log: log() };
  const rows = res.stdout.trim().split("\n").filter(Boolean);
  if (rows.length > 1) return { ok: false, log: log() };
  const row = rows[0]?.split("\t");
  if (row === undefined) return { ok: true, sha: null };
  if (row.length !== 2 || !GIT_OBJECT_ID.test(row[0]!) || row[1] !== ref) return { ok: false, log: log() };
  return { ok: true, sha: row[0]! };
}

/** Whether `sha` is a commit this clone has and `ref` already contains: when it is not, the remote holds work this Mac has not pulled. */
export async function containsCommit(p: Probes, dir: string, sha: string, ref: string): Promise<boolean> {
  if (!GIT_OBJECT_ID.test(sha)) return false;
  if ((await p.exec(["git", "cat-file", "-e", `${sha}^{commit}`], { cwd: dir })).code !== 0) return false;
  return (await p.exec(["git", "merge-base", "--is-ancestor", sha, ref], { cwd: dir })).code === 0;
}

/**
 * Read after a rejected push: the remote moved only when it now holds a
 * commit `ref` does not contain. A remote still at a commit this clone has
 * turned the push away by its own rules (a hook, a protected branch).
 */
export async function remoteMovedPast(p: Probes, dir: string, head: RemoteHead, ref: string): Promise<boolean> {
  return head.ok && head.sha !== null && !(await containsCommit(p, dir, head.sha, ref));
}
