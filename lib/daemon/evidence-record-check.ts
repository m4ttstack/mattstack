/**
 * mr:upload's record check: with a runId, a file goes out only when the run's
 * evidence record lists it as an annotated image or a waived capture. Paths
 * compare realpath to realpath, so a record written through a symlink still
 * matches the file the upload guard resolved. A ticket image never goes out,
 * at its own path or as a byte copy anywhere else: only its composed board does.
 */
import { createHash } from "crypto";
import { readFileSync, realpathSync, statSync } from "fs";
import { basename } from "path";
import { evidenceShots, readEvidence, uploadablePaths, type EvidenceRecord } from "../../packages/rt-client/src/evidence.ts";

/** The one remedy for a file a run's record does not hold: the tool that copies and records it, never a raw field write. */
export const RECORD_REMEDY = "record it with evidence_record first";

export type RunEvidenceLookup = { found: false } | { found: true; evidence: string | null };

type Warn = (message: string, context: { err: unknown; path: string }) => void;
type Probe = { kind: "gone" } | { kind: "file"; size: number; read: () => Uint8Array } | { kind: "unreadable"; err: unknown };

/** stat before any read: a FIFO or a device at a record path must never block the daemon. */
function probe(p: string): Probe {
  try {
    const st = statSync(p);
    if (!st.isFile()) return { kind: "unreadable", err: new Error("not a regular file") };
    return { kind: "file", size: st.size, read: () => readFileSync(p) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? { kind: "gone" } : { kind: "unreadable", err };
  }
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const IS_TICKET = (filename: string) => `${filename} is the unredacted original of an imported ticket image; upload the composed board instead`;

/**
 * Refuses a file that is a run's saved ticket image, at its path or as a byte
 * copy. A shot with a recorded size and sha256 is matched against those, so
 * the ticket file is never read and need not exist. A legacy shot with none
 * reads the ticket file: unreadable fails closed, gone cannot be compared.
 */
export function ticketCopyRefusal(o: {
  record: EvidenceRecord;
  realpath: string;
  filename: string;
  bytes?: Uint8Array;
  resolve?: (p: string) => string | null;
  probe?: (p: string) => Probe;
  warn?: Warn;
}): string | null {
  const resolve = o.resolve ?? safeRealpath;
  const look = o.probe ?? probe;
  let mine: string | null = null;
  const mineOf = (b: Uint8Array) => (mine ??= sha256(b));
  for (const { shot } of evidenceShots(o.record)) {
    if (shot.source !== "ticket") continue;
    if (o.bytes && shot.sha256 !== undefined) {
      if (shot.path === o.realpath) return IS_TICKET(o.filename);
      if ((shot.size === undefined || shot.size === o.bytes.length) && mineOf(o.bytes) === shot.sha256) return IS_TICKET(o.filename);
      continue;
    }
    if (resolve(shot.path) === o.realpath) return IS_TICKET(o.filename);
    if (!o.bytes) continue;
    const found = look(shot.path);
    if (found.kind === "gone") continue;
    let theirs: Uint8Array | null = null;
    if (found.kind === "file" && found.size === o.bytes.length) {
      try {
        theirs = found.read();
      } catch (err) {
        o.warn?.("ticket copy check: unreadable ticket image, failing closed", { err, path: shot.path });
        return `${o.filename}: the run's ticket image ${basename(shot.path)} could not be read to rule out a copy; fix its permissions or recapture it`;
      }
    } else if (found.kind === "unreadable") {
      o.warn?.("ticket copy check: unreadable ticket image, failing closed", { err: found.err, path: shot.path });
      return `${o.filename}: the run's ticket image ${basename(shot.path)} could not be read to rule out a copy; fix its permissions or recapture it`;
    }
    if (theirs !== null && sha256(theirs) === mineOf(o.bytes)) return IS_TICKET(o.filename);
  }
  return null;
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
  warn?: Warn;
}): string | null {
  if (!o.run.found) return `run ${o.runId} not found`;
  const record = readEvidence(o.run.evidence);
  if (record.version !== 2) return `run ${o.runId} has no evidence record; ${RECORD_REMEDY}`;
  const resolve = o.resolve ?? safeRealpath;
  const same = (p: string) => resolve(p) === o.realpath;
  const ticket = ticketCopyRefusal({ record, realpath: o.realpath, filename: o.filename, bytes: o.bytes, resolve, warn: o.warn });
  if (ticket) return ticket;
  if (uploadablePaths(record).some(same)) return null;
  const raw = evidenceShots(record).find(({ shot }) => shot.annotated && same(shot.path));
  if (raw) {
    const theme = raw.shot.theme ? ` (${raw.shot.theme})` : "";
    return `${o.filename} is the raw capture for case "${raw.caseId}" ${raw.slot}${theme}; upload its annotated image ${basename(raw.shot.annotated!)} instead`;
  }
  return `${o.filename} is not in run ${o.runId}'s evidence record as an annotated image or a waived capture; ${RECORD_REMEDY}`;
}
