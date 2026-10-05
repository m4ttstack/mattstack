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
import { readTeamLocal, updateTeamLocal, type PendingPackShare } from "./team-local.ts";

export type PackShare = { pushed: true; remote: string } | { pushed: false; reason: string; next: string };

function notShared(org: string, err: unknown, fallback: string): PackShare {
  if (err instanceof UserActionableError) logFailureDetail(err);
  const reason = err instanceof UserActionableError && !err.code.startsWith("git-") ? err.message : fallback;
  return { pushed: false, reason, next: `rt team publish --team ${org}` };
}

function setPending(p: Probes, org: string, shares: PendingPackShare[]): void {
  updateTeamLocal(p, org, { pendingPackShares: shares.length > 0 ? shares : undefined });
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
    await commitFiles(p, org, paths, `skills: new ${pack} pack`);
  } catch (err) {
    setPending(p, org, [...(readTeamLocal(p, org).pendingPackShares ?? []).filter((share) => share.pack !== pack), { pack, paths }]);
    return notShared(org, err, `rt could not commit the ${pack} pack`);
  }
  const before = readTeamLocal(p, org).pendingPackShares ?? [];
  if (before.some((share) => share.pack === pack)) setPending(p, org, before.filter((share) => share.pack !== pack));
  try {
    const remote = teamRemote(p, org);
    const token = remote ? await readToken(p, remote) : null;
    const result = await publishTeam(p, org, null, { token, tokenRemote: remote });
    return { pushed: true, remote: result.remote };
  } catch (err) {
    return notShared(org, err, `rt could not push the ${pack} pack`);
  }
}

/** Commits each new pack a failed share left behind, scoped to its own paths, and returns the packs committed. */
export async function commitPendingPackShares(p: Probes, org: string): Promise<string[]> {
  try {
    validateSlug(org);
  } catch {
    return [];
  }
  const root = join(p.home, ".mattstack", "teams", org);
  const recorded = readTeamLocal(p, org).pendingPackShares ?? [];
  const pending = recorded.filter((share) => p.exists(join(root, share.paths[0]!)));
  if (pending.length !== recorded.length) setPending(p, org, pending);
  for (const share of pending) for (const path of share.paths) assertMayWrite(p, org, path);
  const committed: string[] = [];
  for (const share of pending) {
    await commitFiles(p, org, share.paths, `skills: new ${share.pack} pack`);
    committed.push(share.pack);
    setPending(p, org, pending.filter((other) => !committed.includes(other.pack)));
  }
  return committed;
}

export function packShareBlocks(pack: string, share: PackShare): Block[] {
  if (share.pushed) return [out.line("done", `Shared the ${pack} pack with your org`, share.remote)];
  return [
    out.line("pending", `The ${pack} pack is not shared with your org yet`, share.reason),
    out.callout("next", ["Share it with ", out.cmd(share.next)]),
  ];
}
