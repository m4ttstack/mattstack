/**
 * Per-team facts that are true of THIS MACHINE, not of the team — kept beside
 * the mint records at ~/.mattstack/rt/teams/<slug>.json (0600) and never
 * synced anywhere.
 *
 * `rtMayManageMembership` is the reason this file exists, and the reason it is
 * local. It is a permission the operator grants, so it must not be readable
 * from the team repo: that repo is other-party content for everyone except its
 * owner, and a synced flag would let a team's author turn on a privileged
 * capability on a member's machine — the precise bug the permission exists to
 * prevent (MAT-387).
 */

import { dirname, join } from "path";
import { UserActionableError } from "../errors.ts";
import type { Probes } from "../setup/probes.ts";

export interface TeamLocalRecord {
  /**
   * rt created this team's remote itself (`gh repo create`), rather than being
   * pointed at one that already existed.
   *
   * Confers no rights. It only decides whether the membership permission is
   * OFFERED, so rt never asks "shall I manage membership on
   * <someone-else's-repo>?" — a question that should not be answerable yes.
   */
  createdByRt: boolean;
  /**
   * This machine's clone arrived by redeeming an invite. Provenance, like
   * `createdByRt`, confers nothing on its own: it only decides that this
   * machine's snapshot engine is pull-only, because members do not push the
   * team repo. Absent means false, so a clone that predates this field keeps
   * pushing rather than silently going inert.
   */
  joinedByRt: boolean;
  /**
   * The operator has asked rt to add and remove people on this team's remote
   * when teammates are added or removed.
   *
   * Absent means false: a permission that was never granted is not held. Every
   * team that predates this file is therefore off, with no migration.
   */
  rtMayManageMembership: boolean;
  /**
   * The age recipient this machine sent the owner when it redeemed its
   * invite. Read without the keychain, it tells whether the team's secrets
   * are encrypted to this machine yet, before Install has written the
   * personal recipients file.
   */
  agePublicKey?: string;
  /**
   * This member's username on the org's forge, recorded at join, at create
   * and by setup. The resolver reads it to pick the active team and the write
   * guard reads it for the member's role, so it has to be on disk: neither
   * may spawn a forge CLI.
   */
  forgeUsername?: string;
  /** This Mac's creator roles still need a forge login or a commit. */
  creatorPending?: { team: string; agePublicKey?: string };
  /** New packs (with their org-relative paths) whose share commit has not landed; `rt team publish` commits them. */
  pendingPackShares?: PendingPackShare[];
}

export interface PendingPackShare {
  pack: string;
  paths: string[];
}

function pendingPackShares(raw: unknown): PendingPackShare[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is PendingPackShare =>
    typeof entry?.pack === "string" && Array.isArray(entry.paths) && entry.paths.length > 0 && entry.paths.every((path: unknown) => typeof path === "string"));
}

const RECORD_MODE = 0o600;
const RECORD_DIR_MODE = 0o700;

export function teamLocalPath(home: string, slug: string): string {
  return join(home, ".mattstack", "rt", "teams", `${slug}.json`);
}

const EMPTY: TeamLocalRecord = { createdByRt: false, joinedByRt: false, rtMayManageMembership: false };

/** Unreadable, absent, or malformed all yield the same all-false record: a machine that cannot prove it holds a permission does not hold it. */
export function readTeamLocal(p: Pick<Probes, "readFile" | "home">, slug: string): TeamLocalRecord {
  const raw = p.readFile(teamLocalPath(p.home, slug));
  if (raw === null) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as Partial<TeamLocalRecord>;
    return {
      createdByRt: parsed.createdByRt === true,
      joinedByRt: parsed.joinedByRt === true,
      rtMayManageMembership: parsed.rtMayManageMembership === true,
      ...(typeof parsed.agePublicKey === "string" && parsed.agePublicKey.startsWith("age1") ? { agePublicKey: parsed.agePublicKey } : {}),
      ...(parsed.creatorPending && typeof parsed.creatorPending.team === "string" ? {
        creatorPending: { team: parsed.creatorPending.team, ...(typeof parsed.creatorPending.agePublicKey === "string" ? { agePublicKey: parsed.creatorPending.agePublicKey } : {}) },
      } : {}),
      ...(typeof parsed.forgeUsername === "string" && parsed.forgeUsername.trim() !== "" ? { forgeUsername: parsed.forgeUsername.trim() } : {}),
      ...(pendingPackShares(parsed.pendingPackShares).length > 0 ? { pendingPackShares: pendingPackShares(parsed.pendingPackShares) } : {}),
    };
  } catch {
    return { ...EMPTY };
  }
}

type RecordWriter = Pick<Probes, "home" | "mkdirp" | "writeFile" | "chmod" | "rename">;

/** Written beside the record and renamed over it: the daemon reads this file every snapshot round, and a torn read would drop a pending share's hold. */
export function writeTeamLocal(p: RecordWriter, slug: string, record: TeamLocalRecord): void {
  const path = teamLocalPath(p.home, slug);
  const temp = `${path}.${process.pid}.tmp`;
  p.mkdirp(dirname(path));
  p.chmod(dirname(path), RECORD_DIR_MODE);
  p.writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, RECORD_MODE);
  p.chmod(temp, RECORD_MODE);
  p.rename(temp, path);
}

const LOCK_TRIES = 50;
const LOCK_WAIT_MS = 20;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Several rt processes update one record (a share, setup, a publish); without the lock a read-modify-write can drop another's field. A lock still there after a second is a dead writer's, so it is taken over. */
function withRecordLock<T>(p: RecordWriter & Pick<Probes, "mkdirExclusive" | "removeDir">, slug: string, fn: () => T): T {
  const lock = `${teamLocalPath(p.home, slug)}.lock`;
  p.mkdirp(dirname(lock));
  let held = false;
  for (let i = 0; i < LOCK_TRIES && !held; i++) {
    held = p.mkdirExclusive(lock);
    if (!held) sleepSync(LOCK_WAIT_MS);
  }
  if (!held) {
    p.removeDir(lock);
    held = p.mkdirExclusive(lock);
  }
  try {
    return fn();
  } finally {
    if (held) p.removeDir(lock);
  }
}

/** A roster write lands in the org this Mac reads settings from, so a verb named for any other org would read one store and write another. */
export function assertCurrentOrg(slug: string, current: string | null, verb: string): void {
  if (current === slug) return;
  if (current === null) {
    throw new UserActionableError("org-not-on-this-mac", `This Mac has no clone of the ${slug} org, so its roster can't change here.`, {}, { next: "rt team join" });
  }
  throw new UserActionableError("org-not-current", `This Mac reads settings from the ${current} org, not ${slug}, so the ${slug} roster can't change here.`, {}, { next: `rt ${verb} --team ${current}` });
}

/** Merges one field without clobbering the rest — callers set `createdByRt` and the operator sets the permission, at different times. */
export function updateTeamLocal(
  p: RecordWriter & Pick<Probes, "readFile" | "mkdirExclusive" | "removeDir">,
  slug: string,
  patch: Partial<TeamLocalRecord>,
): TeamLocalRecord {
  return editTeamLocal(p, slug, () => patch);
}

/** Like updateTeamLocal, with the patch computed from the record as it stands under the lock. */
export function editTeamLocal(
  p: RecordWriter & Pick<Probes, "readFile" | "mkdirExclusive" | "removeDir">,
  slug: string,
  edit: (current: TeamLocalRecord) => Partial<TeamLocalRecord>,
): TeamLocalRecord {
  return withRecordLock(p, slug, () => {
    const current = readTeamLocal(p, slug);
    const next = { ...current, ...edit(current) };
    writeTeamLocal(p, slug, next);
    return next;
  });
}
