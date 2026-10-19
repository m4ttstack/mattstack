/**
 * ticketCopyRefusal: a ticket shot with a recorded size and sha256 is matched
 * against those values, so the file itself is never touched; a legacy shot
 * with none keeps the stat-and-hash path and its fail-closed rules.
 */
import { createHash } from "crypto";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readEvidence } from "../../../packages/rt-client/src/evidence.ts";
import { evidenceUploadRefusal, ticketBytes, ticketCopyRefusal } from "../evidence-record-check.ts";

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

describe("evidenceUploadRefusal on a board with a panel drawn from the run's ticket image", () => {
  test("refuses the recorded pair board whose ticket panel has nothing hidden, from the run's own record", () => {
    const dir = mkdtempSync(join(tmpdir(), "ticket-panel-"));
    try {
      writeFileSync(join(dir, "pair.png"), "board");
      writeFileSync(join(dir, "imp.c1.png"), TICKET);
      writeFileSync(join(dir, "pair.spec.json"), JSON.stringify({ panels: [{ capture: "imp.c1.capture.json", marks: [] }] }));
      const board = join(dir, "pair.png");
      const evidence = JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: { path: "/gone/t.png", source: "ticket", size: TICKET.length, sha256: hex(TICKET), annotated: board, caption: "c" } }] });
      const res = evidenceUploadRefusal({ runId: "r1", realpath: board, filename: "pair.png", run: { found: true, evidence }, bytes: new TextEncoder().encode("board"), resolve: (p) => p });
      expect(res).toBe("pair.png shows a ticket image in panel 1 with nothing hidden on it; redact its personal data in that panel, confirm the crops at the redaction gate, and copy the record and crops beside the board");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ticketBytes", () => {
  test("a legacy ticket shot with no recorded size or sha256 is measured from its file, so its panel still matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "ticket-legacy-"));
    try {
      const ticket = join(dir, "t.png");
      writeFileSync(ticket, TICKET);
      const legacy = readEvidence(JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: { path: ticket, source: "ticket", annotated: join(dir, "b.png"), caption: "c" } }] }));
      expect(ticketBytes(legacy)).toEqual([{ size: TICKET.length, sha256: hex(TICKET) }]);
      writeFileSync(join(dir, "pair.png"), "board");
      writeFileSync(join(dir, "imp.c1.png"), TICKET);
      writeFileSync(join(dir, "pair.spec.json"), JSON.stringify({ panels: [{ capture: "imp.c1.capture.json", marks: [] }] }));
      const evidence = JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: { path: ticket, source: "ticket", annotated: join(dir, "pair.png"), caption: "c" } }] });
      const res = evidenceUploadRefusal({ runId: "r1", realpath: join(dir, "pair.png"), filename: "pair.png", run: { found: true, evidence }, bytes: new TextEncoder().encode("board"), resolve: (p) => p });
      expect(res).toContain("shows a ticket image in panel 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a legacy ticket shot whose file is gone adds nothing", () => {
    const gone = readEvidence(JSON.stringify({ v: 2, cases: [{ id: "t", label: "T", before: { path: "/nowhere/t.png", source: "ticket", annotated: "/nowhere/b.png", caption: "c" } }] }));
    expect(ticketBytes(gone)).toEqual([]);
  });
});
