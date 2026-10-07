import { join } from "path";
import { logFailureDetail, UserActionableError } from "../errors.ts";
import { validateSlug } from "../secrets/store.ts";
import type { Probes } from "../setup/probes.ts";
import * as out from "../ui/out.ts";
import type { Block, Segment } from "../ui/protocol.ts";
import { commitFiles } from "./create.ts";
import { teamRemote } from "./members.ts";
import { publishTeam } from "./publish.ts";
import { assertMayWrite } from "./roles.ts";
import { storedForgeToken } from "./stored-forge-token.ts";
import { editTeamLocal, readTeamLocal, type PendingPackShare } from "./team-local.ts";
import { orgDirUnder } from "../rt-paths.ts";

/** A remembered share this Mac's role may no longer write; it is dropped, since only someone who owns its files can finish it. */
export interface SkippedShare {
  pack: string;
  message: string;
  why?: string;
}

type DroppedShares = { skipped?: { pack: string; message: string }[] };

export type PackShare = ({ pushed: true; remote: string } | { pushed: false; reason: string; next: string; thenRun?: string }) & DroppedShares;

function notShared(org: string, err: unknown, fallback: string): PackShare {
  if (err instanceof UserActionableError) logFailureDetail(err);
  const reason = err instanceof UserActionableError && !err.code.startsWith("git-") ? err.message : fallback;
  if (err instanceof UserActionableError && err.next && err.thenRun) return { pushed: false, reason, next: err.next, thenRun: err.thenRun };
  return { pushed: false, reason, next: `rt team publish --team ${org}` };
}

/** What a `--json` envelope carries about dropped shares: nothing when none were dropped. */
export function droppedShares(skipped: SkippedShare[]): DroppedShares {
  return skipped.length > 0 ? { skipped: skipped.map(({ pack, message }) => ({ pack, message })) } : {};
}

function withDropped(share: PackShare, skipped: SkippedShare[]): PackShare {
  return { ...share, ...droppedShares(skipped) };
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

function packList(packs: string[]): string {
  const names = packs.length === 1 ? packs[0]! : `${packs.slice(0, -1).join(", ")} and ${packs.at(-1)}`;
  return `${names} pack${packs.length === 1 ? "" : "s"}`;
}

/** The remembered shares this Mac may still commit, and the ones it drops because its role no longer covers them. */
function owedShares(p: Probes, org: string): { owed: PendingPackShare[]; skipped: SkippedShare[] } {
  try {
    validateSlug(org);
  } catch {
    return { owed: [], skipped: [] };
  }
  const root = orgDirUnder(p.home, org);
  const recorded = readTeamLocal(p, org).pendingPackShares ?? [];
  dropPending(p, org, recorded.filter((share) => !p.exists(join(root, share.paths[0]!))).map((share) => share.pack));
  const owed: PendingPackShare[] = [];
  const skipped: SkippedShare[] = [];
  for (const share of recorded.filter((entry) => p.exists(join(root, entry.paths[0]!)))) {
    try {
      for (const path of share.paths) assertMayWrite(p, org, path);
      owed.push(share);
    } catch (err) {
      if (!(err instanceof UserActionableError)) throw err;
      skipped.push({ pack: share.pack, message: err.message, ...(err.why ? { why: err.why } : {}) });
    }
  }
  dropPending(p, org, skipped.map((skip) => skip.pack));
  return { owed, skipped };
}

/**
 * One commit over every share's paths: the marketplace file names every pack,
 * so a commit per share would carry a later pack's entry ahead of that pack.
 * Returns the packs it committed, none when there was nothing new to commit.
 */
async function commitShares(p: Probes, org: string, shares: PendingPackShare[]): Promise<string[]> {
  if (shares.length === 0) return [];
  const packs = shares.map((share) => share.pack);
  const committed = await commitFiles(p, org, [...new Set(shares.flatMap((share) => share.paths))], `skills: new ${packList(packs)}`);
  dropPending(p, org, packs);
  return committed ? packs : [];
}

/**
 * Commits a new pack and the files that name it (org-relative `paths`), with
 * any share an earlier failure left owed, and pushes the org clone, so
 * members never pull a marketplace entry whose pack is not on origin yet. The
 * team snapshot never commits pack folders, so a commit that fails is
 * remembered for `rt team publish` to finish; a push that fails leaves the
 * commit for it to push.
 */
export async function sharePack(p: Probes, org: string, pack: string, paths: string[], readToken: (p: Probes, remote: string) => Promise<string | null> = storedForgeToken): Promise<PackShare> {
  for (const path of paths) assertMayWrite(p, org, path);
  let skipped: SkippedShare[] = [];
  let shares: PendingPackShare[] = [{ pack, paths }];
  try {
    const owing = owedShares(p, org);
    skipped = owing.skipped;
    shares = [...owing.owed.filter((share) => share.pack !== pack), { pack, paths }];
    await commitShares(p, org, shares);
  } catch (err) {
    rememberPackShare(p, org, pack, paths);
    return withDropped(notShared(org, err, `rt could not commit the ${packList(shares.map((share) => share.pack))}`), skipped);
  }
  try {
    const remote = teamRemote(p, org);
    const token = remote ? await readToken(p, remote) : null;
    const result = await publishTeam(p, org, null, { token, tokenRemote: remote });
    return withDropped({ pushed: true, remote: result.remote }, skipped);
  } catch (err) {
    return withDropped(notShared(org, err, `rt could not push the ${pack} pack`), skipped);
  }
}

export interface PendingCommits {
  committed: string[];
  skipped: SkippedShare[];
}

/** Commits every new pack a failed share left behind, in one commit scoped to their own paths. */
export async function commitPendingPackShares(p: Probes, org: string): Promise<PendingCommits> {
  const { owed, skipped } = owedShares(p, org);
  return { committed: await commitShares(p, org, owed), skipped };
}

/** The refused line for each remembered share this Mac dropped. */
export function droppedShareBlocks(skipped: SkippedShare[]): Block[] {
  return skipped.flatMap((skip) => [
    out.line("refused", `rt did not share the ${skip.pack} pack from this Mac`, skip.message),
    ...(skip.why ? [out.callout("why", skip.why)] : []),
  ]);
}

/** `then` continues the share's own next, so a caller with a step of its own prints one next rather than two. */
export function packShareBlocks(pack: string, share: PackShare, then: Array<string | Segment> = []): Block[] {
  const dropped = droppedShareBlocks(share.skipped ?? []);
  if (share.pushed) return [out.line("done", `Shared the ${pack} pack with your org`, share.remote), ...dropped];
  const shareNext = share.thenRun ? ["Run ", out.cmd(share.next), ", then share it with ", out.cmd(share.thenRun)] : ["Share it with ", out.cmd(share.next)];
  return [
    out.line("pending", `The ${pack} pack is not shared with your org yet`, share.reason),
    out.callout("next", [...shareNext, ...then]),
    ...dropped,
  ];
}
