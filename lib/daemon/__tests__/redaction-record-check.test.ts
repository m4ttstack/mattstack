import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { createHash } from "crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { redactionUploadRefusal } from "../redaction-record-check.ts";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "redact-check-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const BOARD = new Uint8Array([1, 2, 3]);
const CROP = new Uint8Array([4, 5]);
function write(name: string, data: Uint8Array | string) { writeFileSync(join(dir, name), data); }
function gatedSpec(stem = "r1-c-before") {
  write(`${stem}.spec.json`, JSON.stringify({ out: `${stem}.png`, panels: [{ capture: `${stem}.c1.capture.json`, marks: [{ redact: "email" }] }] }));
  write(`${stem}.c1.capture.json`, JSON.stringify({ schemaVersion: "capture-evidence/1", source: "import" }));
}
function record(over: Record<string, unknown> = {}, entry: Record<string, unknown> = {}) {
  write("r1-c-before.redactions.json", JSON.stringify({
    schemaVersion: "compose-redactions/1", board: "r1-c-before.png", boardSha256: sha(BOARD),
    redactions: [{ crop: "r1-c-before.redact-1.png", sha256: sha(CROP), panel: 0, confirmed: true, ...entry }], ...over,
  }));
}
const check = () => redactionUploadRefusal({ realpath: join(dir, "r1-c-before.png"), filename: "r1-c-before.png", bytes: BOARD });

describe("redactionUploadRefusal", () => {
  test("a plain annotated image with nothing beside it uploads", () => {
    expect(check()).toBeNull();
  });
  test("a live-only board with a redaction and no record uploads", () => {
    write("r1-c-before.spec.json", JSON.stringify({ panels: [{ capture: "r1-c-before.c1.capture.json", marks: [{ redact: "email" }] }] }));
    write("r1-c-before.c1.capture.json", JSON.stringify({ source: "live" }));
    expect(check()).toBeNull();
  });
  test("spec says gated, no record: refused", () => {
    gatedSpec();
    expect(check()).toBe("r1-c-before.png hides part of a ticket image but has no redaction record beside it; render the board again, confirm its crops at the redaction gate, and copy the record and crops beside the board");
  });
  test("an unreadable sidecar on a panel with a redaction counts as gated", () => {
    write("r1-c-before.spec.json", JSON.stringify({ panels: [{ capture: "gone.capture.json", marks: [{ redact: "email" }] }] }));
    expect(check()).toContain("has no redaction record");
  });
  test("a confirmed record whose crops match uploads", () => {
    gatedSpec(); write("r1-c-before.redact-1.png", CROP); record();
    expect(check()).toBeNull();
  });
  test("an unconfirmed entry is refused", () => {
    gatedSpec(); write("r1-c-before.redact-1.png", CROP); record({}, { confirmed: false });
    expect(check()).toBe("r1-c-before.png has a redaction not yet confirmed; show each crop at the redaction gate, run fast-browser compose --confirm after a yes, and copy the confirmed record beside the board");
  });
  test("a record beside a board that no longer matches refuses", () => {
    gatedSpec(); write("r1-c-before.redact-1.png", CROP); record({ boardSha256: "0".repeat(64) });
    expect(check()).toBe("r1-c-before.png changed since its redactions were recorded; render the board again, confirm its crops at the redaction gate, and copy the record and crops beside the board");
  });
  test("a missing or changed crop is refused", () => {
    gatedSpec(); record();
    expect(check()).toBe("r1-c-before.png's redaction crop r1-c-before.redact-1.png is missing or changed; render the board again, confirm its crops at the redaction gate, and copy the record and crops beside the board");
    write("r1-c-before.redact-1.png", new Uint8Array([9]));
    expect(check()).toContain("is missing or changed");
  });
  test("a malformed record, or one naming another board, is refused", () => {
    gatedSpec(); write("r1-c-before.redact-1.png", CROP);
    write("r1-c-before.redactions.json", "{");
    expect(check()).toBe("r1-c-before.png's redaction record is malformed; render the board again");
    record({ board: "other.png" });
    expect(check()).toBe("r1-c-before.png's redaction record is malformed; render the board again");
  });
  test("an empty record means no redaction landed on the board: it uploads only with a matching board hash", () => {
    gatedSpec();
    record({ redactions: [] });
    expect(check()).toBeNull();
    record({ redactions: [], boardSha256: sha(new Uint8Array([7])) });
    expect(check()).toContain("changed since its redactions were recorded");
  });
  test("a record with no spec beside it is still checked", () => {
    write("r1-c-before.redact-1.png", CROP); record({}, { confirmed: false });
    expect(check()).toContain("not yet confirmed");
  });
  test("a crop name outside the stem is refused as malformed", () => {
    gatedSpec(); record({}, { crop: "../elsewhere.png" });
    expect(check()).toContain("is malformed");
  });
  const raw = () => redactionUploadRefusal({ realpath: join(dir, "x.c1.png"), filename: "x.c1.png", bytes: BOARD });
  const RAW_MSG = "x.c1.png is the unredacted original of an imported ticket image; upload the composed board instead";
  test("a raw capture whose sidecar says import is refused", () => {
    write("x.c1.capture.json", JSON.stringify({ source: "import" }));
    expect(raw()).toBe(RAW_MSG);
  });
  test("a raw capture whose sidecar says live uploads", () => {
    write("x.c1.capture.json", JSON.stringify({ source: "live" }));
    expect(raw()).toBeNull();
  });
  test("a raw capture with a malformed sidecar is refused", () => {
    write("x.c1.capture.json", "{");
    expect(raw()).toBe(RAW_MSG);
  });
  test("a spec that exists but cannot be parsed, or has no panels array, counts as gated", () => {
    write("r1-c-before.spec.json", "{");
    expect(check()).toContain("has no redaction record");
    write("r1-c-before.spec.json", JSON.stringify({ panels: "x" }));
    expect(check()).toContain("has no redaction record");
  });
  test("a spec whose content is JSON null counts as gated; a missing spec does not", () => {
    write("r1-c-before.spec.json", "null");
    expect(check()).toContain("has no redaction record");
    rmSync(join(dir, "r1-c-before.spec.json"));
    expect(check()).toBeNull();
  });
  test("only source live passes on a raw capture sidecar", () => {
    write("x.c1.capture.json", "{}");
    expect(raw()).toBe(RAW_MSG);
    write("x.c1.capture.json", JSON.stringify({ source: "other" }));
    expect(raw()).toBe(RAW_MSG);
    write("x.c1.capture.json", JSON.stringify({ source: "live" }));
    expect(raw()).toBeNull();
  });
  test("a panel capture sidecar without source live counts as gated", () => {
    write("r1-c-before.spec.json", JSON.stringify({ panels: [{ capture: "p.capture.json", marks: [{ redact: "email" }] }] }));
    write("p.capture.json", "{}");
    expect(check()).toContain("has no redaction record");
    write("p.capture.json", JSON.stringify({ source: "live" }));
    expect(check()).toBeNull();
  });
  test("an unexpected read error warns once and the upload is still refused", () => {
    mkdirSync(join(dir, "x.c1.capture.json"));
    const warn = mock();
    expect(redactionUploadRefusal({ realpath: join(dir, "x.c1.png"), filename: "x.c1.png", bytes: BOARD, warn })).toBe(RAW_MSG);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ path: join(dir, "x.c1.capture.json") });
  });
  test("a sidecar the reader cannot read fails closed as an imported original", () => {
    const read = (p: string) => (p.endsWith("x.c1.capture.json") ? new Uint8Array(0) : null);
    expect(redactionUploadRefusal({ realpath: join(dir, "x.c1.png"), filename: "x.c1.png", bytes: BOARD, read })).toBe(RAW_MSG);
  });
  test("a spec the reader cannot read counts as gated", () => {
    const read = (p: string) => (p.endsWith("r1-c-before.spec.json") ? new Uint8Array(0) : null);
    expect(redactionUploadRefusal({ realpath: join(dir, "r1-c-before.png"), filename: "r1-c-before.png", bytes: BOARD, read })).toContain("has no redaction record");
  });
  test.skipIf(process.getuid?.() === 0)("the default reader treats an unreadable sidecar as present", () => {
    write("x.c1.capture.json", JSON.stringify({ source: "live" }));
    chmodSync(join(dir, "x.c1.capture.json"), 0o000);
    expect(raw()).toBe(RAW_MSG);
  });
});
