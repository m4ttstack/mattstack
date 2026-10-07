/**
 * Owner-side mint records — the only place `rt members sync` can recover an
 * outstanding invite's creatorSecret to poll the relay for a reply. Never
 * leaves the machine: ~/.mattstack/rt/invites/<slug>.json (0600).
 */

import { dirname, join } from "path";
import type { Probes } from "../setup/probes.ts";
import { UserActionableError } from "../errors.ts";

export interface InviteRecord {
  id: string;
  creatorSecret: string;
  keyB64: string;
  expiresAt: string;
}

export type InviteRecords = Record<string, InviteRecord>;

/** A copied file's tie to the folder name its org moved from: a string beside the handles, never a handle's record, so the reader skips it. */
const MOVED_FROM = "movedFrom";

const RECORDS_MODE = 0o600;
const RECORDS_DIR_MODE = 0o700;

export function inviteRecordsPath(home: string, slug: string): string {
  return join(home, ".mattstack", "rt", "invites", `${slug}.json`);
}

/**
 * A null-prototype result: `records[handle] = rec` runs later with
 * arbitrary user-supplied handles, and on a normal object a handle of
 * "__proto__" hits Object.prototype's setter instead of creating an own
 * property, silently discarding the record.
 */
function emptyRecords(): InviteRecords {
  return Object.create(null) as InviteRecords;
}

export function readInviteRecords(p: Pick<Probes, "readFile" | "home">, slug: string): InviteRecords {
  const raw = p.readFile(inviteRecordsPath(p.home, slug));
  if (raw === null) return emptyRecords();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyRecords();
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UserActionableError("unreadable-records", "invite records file is not a valid records map");
  }

  const records = emptyRecords();
  for (const [handle, rec] of Object.entries(parsed as Record<string, unknown>)) {
    if (handle === MOVED_FROM && typeof rec === "string") continue;
    records[handle] = rec as InviteRecord;
  }
  return records;
}

export function readInviteMovedFrom(p: Pick<Probes, "readFile" | "home">, slug: string): string | undefined {
  const raw = p.readFile(inviteRecordsPath(p.home, slug));
  if (raw === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const value = (parsed as Record<string, unknown>)[MOVED_FROM];
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

function isExpired(rec: InviteRecord, now: Date): boolean {
  return !(Date.parse(rec.expiresAt) >= now.getTime());
}

function writeRecords(
  p: Pick<Probes, "writeFile" | "mkdirp" | "chmod" | "home" | "now">,
  slug: string,
  records: InviteRecords,
  movedFrom: string | undefined,
): void {
  const pruned = emptyRecords();
  for (const [handle, rec] of Object.entries(records)) {
    if (!isExpired(rec, p.now())) pruned[handle] = rec;
  }
  writeRaw(p, slug, movedFrom === undefined ? pruned : { ...pruned, [MOVED_FROM]: movedFrom });
}

function writeRaw(p: Pick<Probes, "writeFile" | "mkdirp" | "chmod" | "home">, slug: string, body: Record<string, unknown>): void {
  const path = inviteRecordsPath(p.home, slug);
  p.mkdirp(dirname(path), RECORDS_DIR_MODE);
  p.writeFile(path, JSON.stringify(body), RECORDS_MODE);
  // writeFile's mode only takes effect on a freshly-created inode; chmod
  // re-asserts 0600 on a file that already existed looser (restored from a
  // backup, rsynced from another machine, hand-created).
  p.chmod(path, RECORDS_MODE);
}

export function upsertInviteRecord(
  p: Pick<Probes, "readFile" | "writeFile" | "mkdirp" | "chmod" | "home" | "now">,
  slug: string,
  handle: string,
  rec: InviteRecord,
): void {
  const records = readInviteRecords(p, slug);
  records[handle] = rec;
  writeRecords(p, slug, records, readInviteMovedFrom(p, slug));
}

export function removeInviteRecord(
  p: Pick<Probes, "readFile" | "writeFile" | "mkdirp" | "chmod" | "home" | "now">,
  slug: string,
  handle: string,
): void {
  const records = readInviteRecords(p, slug);
  if (!(handle in records)) return;
  delete records[handle];
  writeRecords(p, slug, records, readInviteMovedFrom(p, slug));
}

/** Drops the moved-from tie and keeps every record as it is, expired ones included: clearing the tie is not a write that should prune. */
export function clearInviteMovedFrom(p: Pick<Probes, "readFile" | "writeFile" | "mkdirp" | "chmod" | "home">, slug: string): void {
  if (readInviteMovedFrom(p, slug) === undefined) return;
  writeRaw(p, slug, readInviteRecords(p, slug));
}
