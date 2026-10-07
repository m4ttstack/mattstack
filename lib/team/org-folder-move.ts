/**
 * The pieces that move an org clone to the folder its marker names, shared by
 * the daemon's `org:move` verb and the no-daemon path of the org.folder step.
 * Record copies go first because the folder is the only thing that remembers
 * the old name; old records go last so an interrupted move leaves every
 * reader keyed on the old folder with its record.
 */

import { basename, dirname } from "path";
import type { Probes } from "../setup/probes.ts";
import { clearInviteMovedFrom, inviteRecordsPath, readInviteMovedFrom } from "./invite-records.ts";
import { readTeamLocal, teamLocalPath, withRecordLock, writeTeamLocal } from "./team-local.ts";

export type RecordPiece = "copied" | "present" | "none";
export interface RecordCopies {
  teams: RecordPiece;
  invites: RecordPiece;
}
export type LocateFn = (newPath: string) => Promise<{ ok: true; moved: boolean } | { ok: false; error: string }>;
export type MoveStage = "records" | "folder" | "index" | "cleanup";
export interface OrgMoveResult {
  ok: boolean;
  from: string;
  to: string;
  records: RecordCopies;
  folderMoved: boolean;
  index: "moved" | "already" | "failed";
  removed: string[];
  stage?: MoveStage;
  error?: string;
}
export type MoveProbes = Pick<Probes, "home" | "exists" | "readFile" | "writeFile" | "mkdirp" | "mkdirExclusive" | "removeDir" | "removeFile" | "chmod" | "rename" | "readDir">;

const RECORD_MODE = 0o600;

function copyFile(p: MoveProbes, from: string, to: string, transform: (raw: string) => string = (raw) => raw): RecordPiece {
  if (p.exists(to)) return "present";
  const raw = p.readFile(from);
  if (raw === null) return "none";
  p.mkdirp(dirname(to));
  const temp = `${to}.${process.pid}.tmp`;
  p.writeFile(temp, transform(raw), RECORD_MODE);
  p.chmod(temp, RECORD_MODE);
  p.rename(temp, to);
  return "copied";
}

/** The copied record carries `movedFrom`, the only tie between the new name and the records left under the old one. */
function stampMovedFrom(folder: string): (raw: string) => string {
  return (raw) => {
    let parsed: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    return `${JSON.stringify({ ...parsed, movedFrom: folder }, null, 2)}\n`;
  };
}

/** `rt/teams/<folder>.json` and `rt/invites/<folder>.json` to `<org>.json`, under the team record lock so a concurrent share or publish cannot land between the read and the copy. With no team record to carry the tie, the invites copy carries it. */
export function copyOrgRecords(p: MoveProbes, folder: string, org: string): RecordCopies {
  if (folder === org) {
    return {
      teams: p.exists(teamLocalPath(p.home, org)) ? "present" : "none",
      invites: p.exists(inviteRecordsPath(p.home, org)) ? "present" : "none",
    };
  }
  return withRecordLock(p, folder, () => {
    const teams = copyFile(p, teamLocalPath(p.home, folder), teamLocalPath(p.home, org), stampMovedFrom(folder));
    const invites = copyFile(p, inviteRecordsPath(p.home, folder), inviteRecordsPath(p.home, org), teams === "none" ? stampMovedFrom(folder) : undefined);
    return { teams, invites };
  });
}

/** Removes the records a copied `<org>.json` says it came from, once no folder of that name is left, and clears the tie. A record with no `movedFrom` is never touched. */
export function cleanupMovedRecords(p: MoveProbes, org: string, folderExists: (name: string) => boolean): string[] {
  const teamsTie = readTeamLocal(p, org).movedFrom;
  const old = teamsTie ?? readInviteMovedFrom(p, org);
  if (old === undefined || old === org || folderExists(old)) return [];
  const removed: string[] = [];
  for (const path of [teamLocalPath(p.home, old), inviteRecordsPath(p.home, old)]) {
    if (!p.exists(path)) continue;
    p.removeFile(path);
    removed.push(path);
  }
  withRecordLock(p, org, () => {
    // writeTeamLocal creates the file, so a move that copied only invites must not reach it.
    if (teamsTie !== undefined) {
      const { movedFrom: _movedFrom, ...rest } = readTeamLocal(p, org);
      writeTeamLocal(p, org, rest);
    }
    clearInviteMovedFrom(p, org);
  });
  return removed;
}

/** A relocation that found nothing to move (rt never registered the clone, or the row already carries the path) is done; everything else is a failure. */
export function classifyLocate(error: string): "done" | "failed" {
  return error.startsWith("nothing-lost:") ? "done" : "failed";
}

function folderExistsBeside(p: MoveProbes, roots: string[]): (name: string) => boolean {
  return (name) => roots.some((root) => p.exists(`${root}/${name}`));
}

export async function runOrgMove(p: MoveProbes, req: { from: string; to: string; locate: LocateFn }): Promise<OrgMoveResult> {
  const folder = basename(req.from);
  const org = basename(req.to);
  const base: OrgMoveResult = { ok: false, from: req.from, to: req.to, records: { teams: "none", invites: "none" }, folderMoved: false, index: "failed", removed: [] };
  const fail = (stage: MoveStage, error: string): OrgMoveResult => ({ ...base, ok: false, stage, error });

  if (req.from !== req.to && p.exists(req.to) && p.exists(req.from)) return fail("folder", `${req.to} already exists`);

  try {
    base.records = copyOrgRecords(p, folder, org);
  } catch (err) {
    return fail("records", err instanceof Error ? err.message : String(err));
  }

  if (req.from !== req.to && !p.exists(req.to)) {
    try {
      p.mkdirp(dirname(req.to));
      p.rename(req.from, req.to);
      base.folderMoved = true;
    } catch (err) {
      return fail("folder", err instanceof Error ? err.message : String(err));
    }
  }

  let located: Awaited<ReturnType<LocateFn>>;
  try {
    located = await req.locate(req.to);
  } catch (err) {
    return fail("index", err instanceof Error ? err.message : String(err));
  }
  if (located.ok) base.index = located.moved ? "moved" : "already";
  else if (classifyLocate(located.error) === "done") base.index = "already";
  else return fail("index", located.error);

  try {
    base.removed = cleanupMovedRecords(p, org, folderExistsBeside(p, [dirname(req.from), dirname(req.to)]));
  } catch (err) {
    return fail("cleanup", err instanceof Error ? err.message : String(err));
  }
  return { ...base, ok: true };
}
