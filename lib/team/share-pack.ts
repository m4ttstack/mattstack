import { join } from "path";
import { logFailureDetail, UserActionableError } from "../errors.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";
import * as out from "../ui/out.ts";
import type { Block } from "../ui/protocol.ts";
import { commitFiles } from "./create.ts";
import { teamRemote } from "./members.ts";
import { publishTeam } from "./publish.ts";
import { assertMayWrite } from "./roles.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { editTeamLocal, readTeamLocal, type PendingPackShare } from "./team-local.ts";

export type PackShare = { pushed: true; remote: string } | { pushed: false; reason: string; next: string; thenRun?: string };

function notShared(org: string, err: unknown, fallback: string): PackShare {
  if (err instanceof UserActionableError) logFailureDetail(err);
  const reason = err instanceof UserActionableError && !err.code.startsWith("git-") ? err.message : fallback;
  if (err instanceof UserActionableError && err.next && err.thenRun) return { pushed: false, reason, next: err.next, thenRun: err.thenRun };
  return { pushed: false, reason, next: `rt team publish --team ${org}` };
}

function dropPending(p: Probes, org: string, packs: string[]): void {
  if (packs.length === 0) return;
  editTeamLocal(p, org, (current) => {
    const left = (current.pendingPackShares ?? []).filter((share) => !packs.includes(share.pack));
    return { pendingPackShares: left.length > 0 ? left : undefined };
  });
}

/** Remembers that `pack` still has to be committed with `paths`, so `rt team publish` can finish its share. */
export function rememberPackShare(p: Probes, org: string, pack: string, paths: string[]): void {
  editTeamLocal(p, org, (current) => ({ pendingPackShares: [...(current.pendingPackShares ?? []).filter((share) => share.pack !== pack), { pack, paths }] }));
}

/**
 * Commits a new pack and the files that name it (org-relative `paths`) in one
 * commit and pushes the org clone, so members never pull a marketplace entry
 * whose pack is not on origin yet. The team snapshot never commits pack
 * folders, so a commit that fails is remembered for `rt team publish` to
 * finish; a push that fails leaves the commit for it to push.
 */
export async function sharePack(p: Probes, org: string, pack: string, paths: string[], readToken: (p: Probes, remote: string) => Promise<string | null> = storedForgeToken): Promise<PackShare> {
  for (const path of paths) assertMayWrite(p, org, path);
  try {
    await commitPendingPackShares(p, org);
    await commitFiles(p, org, paths, `skills: new ${pack} pack`);
  } catch (err) {
    rememberPackShare(p, org, pack, paths);
    return notShared(org, err, `rt could not commit the ${pack} pack`);
  }
  dropPending(p, org, [pack]);
  try {
    const remote = teamRemote(p, org);
    const token = remote ? await readToken(p, remote) : null;
    const result = await publishTeam(p, org, null, { token, tokenRemote: remote });
    return { pushed: true, remote: result.remote };
  } catch (err) {
    return notShared(org, err, `rt could not push the ${pack} pack`);
  }
}

export interface PendingCommits {
  committed: string[];
  /** Shares this Mac's role may no longer write; they are dropped, since only someone who owns their files can finish them. */
  skipped: { pack: string; message: string; why?: string }[];
}

/**
 * Commits each new pack a failed share left behind, scoped to its own paths.
 * Runs before any other share's commit too: the marketplace file names every
 * pack, so a later share would otherwise push an earlier pack's entry ahead
 * of that pack.
 */
export async function commitPendingPackShares(p: Probes, org: string): Promise<PendingCommits> {
  const result: PendingCommits = { committed: [], skipped: [] };
  try {
    validateSlug(org);
  } catch {
    return result;
  }
  const root = join(p.home, ".mattstack", "teams", org);
  const recorded = readTeamLocal(p, org).pendingPackShares ?? [];
  dropPending(p, org, recorded.filter((share) => !p.exists(join(root, share.paths[0]!))).map((share) => share.pack));
  const pending: PendingPackShare[] = [];
  for (const share of recorded.filter((entry) => p.exists(join(root, entry.paths[0]!)))) {
    try {
      for (const path of share.paths) assertMayWrite(p, org, path);
      pending.push(share);
    } catch (err) {
      if (!(err instanceof UserActionableError)) throw err;
      result.skipped.push({ pack: share.pack, message: err.message, ...(err.why ? { why: err.why } : {}) });
    }
  }
  dropPending(p, org, result.skipped.map((skip) => skip.pack));
  for (const share of pending) {
    await commitFiles(p, org, share.paths, `skills: new ${share.pack} pack`);
    result.committed.push(share.pack);
    dropPending(p, org, [share.pack]);
  }
  return result;
}

export function packShareBlocks(pack: string, share: PackShare): Block[] {
  if (share.pushed) return [out.line("done", `Shared the ${pack} pack with your org`, share.remote)];
  return [
    out.line("pending", `The ${pack} pack is not shared with your org yet`, share.reason),
    out.callout("next", share.thenRun ? ["Run ", out.cmd(share.next), ", then share it with ", out.cmd(share.thenRun)] : ["Share it with ", out.cmd(share.next)]),
  ];
}
