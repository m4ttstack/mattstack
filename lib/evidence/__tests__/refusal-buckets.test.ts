import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { checkUploadPath } from "../../daemon/upload-guard.ts";
import { evidenceUploadRefusal } from "../../daemon/evidence-record-check.ts";
import { BUCKETS, bucketFor } from "../refusal-buckets.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});
function temp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "refusal-buckets-")));
  dirs.push(d);
  return d;
}
function guard(path: string, roots: string[]): string {
  const r = checkUploadPath(path, roots, { workRoot: "/nonexistent-work", runsRoot: "/nonexistent-runs", evidenceRoot: "/nonexistent-evidence" });
  if (r.ok) throw new Error("expected refusal");
  return r.error;
}

test("BUCKETS lists every bucket", () => {
  expect([...BUCKETS]).toEqual(["record", "raw-capture", "import", "redaction", "roots", "missing", "size", "bytes", "other"]);
});

test("main upload guard messages", () => {
  const root = temp();
  const outside = temp();
  const out = join(outside, "a.png");
  writeFileSync(out, "x");
  expect(bucketFor(guard(out, [root]))).toBe("roots");
  expect(bucketFor(guard(join(root, "gone.png"), [root]))).toBe("missing");
  const txt = join(root, "a.txt");
  writeFileSync(txt, "x");
  expect(bucketFor(guard(txt, [root]))).toBe("bytes");
  const fake = join(root, "b.png");
  writeFileSync(fake, "plain text");
  expect(bucketFor(guard(fake, [root]))).toBe("bytes");
  expect(bucketFor(guard("relative/a.png", [root]))).toBe("missing");
});

test("record check messages", () => {
  const base = { runId: "r1", realpath: "/x/a.png", filename: "a.png" };
  const msg = (run: Parameters<typeof evidenceUploadRefusal>[0]["run"]) => evidenceUploadRefusal({ ...base, run })!;
  expect(bucketFor(msg({ found: false }))).toBe("record");
  expect(bucketFor(msg({ found: true, evidence: null }))).toBe("record");
  const record = JSON.stringify({ v: 2, cases: [{ id: "c1", label: "Case", after: [{ path: "/x/other.png", annotated: "/x/other-ann.png" }] }] });
  expect(bucketFor(msg({ found: true, evidence: record }))).toBe("record");
});

test("raw capture message", () => {
  const dir = temp();
  const raw = join(dir, "raw.png");
  writeFileSync(raw, "x");
  const record = { v: 2, cases: [{ id: "c1", label: "Case", after: [{ path: raw, annotated: join(dir, "ann.png") }] }] };
  const msg = evidenceUploadRefusal({ runId: "r1", realpath: raw, filename: "raw.png", run: { found: true, evidence: JSON.stringify(record) } });
  expect(bucketFor(msg ?? "")).toBe("raw-capture");
});

test("pending redaction and import literals", () => {
  for (const m of [
    "a.png hides part of a ticket image but has no redaction record beside it; render",
    "a.png's redaction record is malformed; render the board again",
    "a.png changed since its redactions were recorded",
    "a.png's redaction crop a.redact-1.png is missing or changed; render the board again",
    "a.png has a redaction not yet confirmed",
  ]) expect(bucketFor(m)).toBe("redaction");
  expect(bucketFor("a.png is the unredacted original of an imported ticket image; upload the composed board instead")).toBe("import");
});

test("size and other", () => {
  expect(bucketFor("file is 60.0 MB; the upload cap is 50 MB")).toBe("size");
  expect(bucketFor("GitLab upload returned 500 Internal Server Error")).toBe("other");
  expect(bucketFor("repo-unknown")).toBe("other");
});

test("earlier rows win", () => {
  expect(bucketFor("run r1 not found")).toBe("record");
  expect(bucketFor("a.png has no redaction record beside it; file bytes do not match")).toBe("redaction");
});
