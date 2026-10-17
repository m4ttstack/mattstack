/**
 * mr:upload's record check: with a runId, a file goes out only when the run's
 * evidence record lists it as an annotated image or a waived capture. Paths
 * compare realpath to realpath, so a record written through a symlink still
 * matches the file the upload guard resolved. A ticket image never goes out,
 * at its own path or as a byte copy anywhere else: only its composed board does.
 */
import { createHash } from "crypto";
import { readFileSync, realpathSync } from "fs";
import { basename } from "path";
import { evidenceShots, readEvidence, uploadablePaths } from "../../packages/rt-client/src/evidence.ts";

export type RunEvidenceLookup = { found: false } | { found: true; evidence: string | null };

function safeRead(p: string): Uint8Array | null {
  try {
    return readFileSync(p);
  } catch {
    return null;
  }
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

export function evidenceUploadRefusal(o: {
  runId: string;
  realpath: string;
  filename: string;
  run: RunEvidenceLookup;
  resolve?: (p: string) => string | null;
  bytes?: Uint8Array;
  read?: (p: string) => Uint8Array | null;
}): string | null {
  if (!o.run.found) return `run ${o.runId} not found`;
  const record = readEvidence(o.run.evidence);
  if (record.version !== 2) return `run ${o.runId} has no evidence record; write evidence before uploading with runId`;
  const resolve = o.resolve ?? safeRealpath;
  const same = (p: string) => resolve(p) === o.realpath;
  const tickets = evidenceShots(record).filter(({ shot }) => shot.source === "ticket");
  const read = o.read ?? safeRead;
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const mine = o.bytes ? sha(o.bytes) : null;
  const copiesTicket = (path: string) => {
    if (mine === null) return false;
    const theirs = read(path);
    return theirs !== null && sha(theirs) === mine;
  };
  if (tickets.some(({ shot }) => same(shot.path) || copiesTicket(shot.path))) {
    return `${o.filename} is the unredacted original of an imported ticket image; upload the composed board instead`;
  }
  if (uploadablePaths(record).some(same)) return null;
  const raw = evidenceShots(record).find(({ shot }) => shot.annotated && same(shot.path));
  if (raw) {
    const theme = raw.shot.theme ? ` (${raw.shot.theme})` : "";
    return `${o.filename} is the raw capture for case "${raw.caseId}" ${raw.slot}${theme}; upload its annotated image ${basename(raw.shot.annotated!)} instead`;
  }
  return `${o.filename} is not in run ${o.runId}'s evidence record as an annotated image or a waived capture; record it with run_field_set first`;
}
