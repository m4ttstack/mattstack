/**
 * ticketCopyRefusal: a ticket shot with a recorded size and sha256 is matched
 * against those values, so the file itself is never touched; a legacy shot
 * with none keeps the stat-and-hash path and its fail-closed rules.
 */
import { createHash } from "crypto";
import { describe, expect, test } from "bun:test";
import { readEvidence } from "../../../packages/rt-client/src/evidence.ts";
import { evidenceUploadRefusal, ticketCopyRefusal } from "../evidence-record-check.ts";

const TICKET = new TextEncoder().encode("ticket-bytes");
const hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const REFUSED = "copy.png is the unredacted original of an imported ticket image; upload the composed board instead";

function record(shot: object) {
  return readEvidence(JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: { path: "/work/r1/evidence/t/t.png", source: "ticket", annotated: "/work/r1/evidence/t/b.png", caption: "c", ...shot } }] }));
}
const untouchable = {
  resolve: (): string | null => null,
  probe: (p: string): never => { throw new Error(`probed ${p}`); },
};

describe("ticketCopyRefusal with a recorded size and sha256", () => {
  const hashed = record({ size: TICKET.length, sha256: hex(TICKET) });

  test("refuses the ticket file edited in place at its own path when the recorded path reaches it through a symlink", () => {
    const res = ticketCopyRefusal({ record: hashed, realpath: "/real/work/r1/evidence/t/t.png", filename: "copy.png", bytes: new TextEncoder().encode("edited"), resolve: () => "/real/work/r1/evidence/t/t.png", probe: untouchable.probe });
    expect(res).toBe(REFUSED);
  });

  test("refuses a byte copy without probing the ticket file", () => {
    expect(ticketCopyRefusal({ record: hashed, realpath: "/tmp/copy.png", filename: "copy.png", bytes: TICKET, ...untouchable })).toBe(REFUSED);
  });

  test("passes other bytes, of the same size or not, without touching the ticket file", () => {
    for (const bytes of [new TextEncoder().encode("other-bytes!"), new TextEncoder().encode("short")]) {
      expect(ticketCopyRefusal({ record: hashed, realpath: "/tmp/copy.png", filename: "copy.png", bytes, ...untouchable })).toBeNull();
    }
  });

  test("hashes the upload only when its size matches the recorded size", () => {
    const wrongSize = record({ size: TICKET.length + 1, sha256: hex(TICKET) });
    expect(ticketCopyRefusal({ record: wrongSize, realpath: "/tmp/copy.png", filename: "copy.png", bytes: TICKET, ...untouchable })).toBeNull();
  });

  test("still refuses the ticket file at its own recorded path, whatever its bytes now are", () => {
    const res = ticketCopyRefusal({ record: hashed, realpath: "/work/r1/evidence/t/t.png", filename: "copy.png", bytes: new TextEncoder().encode("edited"), ...untouchable });
    expect(res).toBe(REFUSED);
  });

  test("a run's record refuses the copy through evidenceUploadRefusal with the file gone", () => {
    const run = { found: true as const, evidence: JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: { path: "/gone/t.png", source: "ticket", size: TICKET.length, sha256: hex(TICKET), annotated: "/gone/b.png", caption: "c" } }] }) };
    expect(evidenceUploadRefusal({ runId: "r1", realpath: "/tmp/copy.png", filename: "copy.png", run, bytes: TICKET, resolve: () => null })).toBe(REFUSED);
  });
});

describe("ticketCopyRefusal on a legacy shot with no recorded hash", () => {
  const legacy = record({});

  test("probes the ticket file and refuses a copy of its bytes", () => {
    const probe = () => ({ kind: "file" as const, size: TICKET.length, read: () => TICKET });
    expect(ticketCopyRefusal({ record: legacy, realpath: "/tmp/copy.png", filename: "copy.png", bytes: TICKET, resolve: () => null, probe })).toBe(REFUSED);
  });

  test("a ticket file that is gone cannot be compared: the documented limit", () => {
    expect(ticketCopyRefusal({ record: legacy, realpath: "/tmp/copy.png", filename: "copy.png", bytes: TICKET, resolve: () => null, probe: () => ({ kind: "gone" as const }) })).toBeNull();
  });

  test("an unreadable ticket file fails closed", () => {
    const res = ticketCopyRefusal({ record: legacy, realpath: "/tmp/copy.png", filename: "copy.png", bytes: TICKET, resolve: () => null, probe: () => ({ kind: "unreadable" as const, err: new Error("EACCES") }) });
    expect(res).toContain("could not be read to rule out a copy");
  });
});
