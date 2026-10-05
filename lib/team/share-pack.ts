import { logFailureDetail, UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";
import * as out from "../ui/out.ts";
import type { Block } from "../ui/protocol.ts";
import { commitFiles } from "./create.ts";
import { teamRemote } from "./members.ts";
import { publishTeam } from "./publish.ts";
import { assertMayWrite } from "./roles.ts";
import { storedForgeToken } from "./stored-forge-token.ts";

export type PackShare = { pushed: true; remote: string } | { pushed: false; reason: string; next: string };

const SHARE_PACK_NEXT = "rt team publish";

function notShared(err: unknown, fallback: string): PackShare {
  if (err instanceof UserActionableError) logFailureDetail(err);
  const reason = err instanceof UserActionableError && !err.code.startsWith("git-") ? err.message : fallback;
  return { pushed: false, reason, next: SHARE_PACK_NEXT };
}

/**
 * Commits a new pack and the files that name it (org-relative `paths`) in one
 * commit and pushes the org clone, so members never pull a marketplace entry
 * whose pack is not on origin yet. The team snapshot leaves pack folders to
 * this publish. A failure leaves everything on disk for the snapshot to
 * pick up later and returns why.
 */
export async function sharePack(p: Probes, org: string, pack: string, paths: string[], readToken: (p: Probes, remote: string) => Promise<string | null> = storedForgeToken): Promise<PackShare> {
  for (const path of paths) assertMayWrite(p, org, path);
  try {
    await commitFiles(p, org, paths, `skills: new ${pack} pack`);
  } catch (err) {
    return notShared(err, `rt could not commit the ${pack} pack`);
  }
  try {
    const remote = teamRemote(p, org);
    const token = remote ? await readToken(p, remote) : null;
    const result = await publishTeam(p, org, null, { token, tokenRemote: remote });
    return { pushed: true, remote: result.remote };
  } catch (err) {
    return notShared(err, `rt could not push the ${pack} pack`);
  }
}

export function packShareBlocks(pack: string, share: PackShare): Block[] {
  if (share.pushed) return [out.line("done", `Shared the ${pack} pack with your org`, share.remote)];
  return [
    out.line("pending", `The ${pack} pack is not shared with your org yet`, share.reason),
    out.callout("next", ["Share it with ", out.cmd(share.next)]),
  ];
}
