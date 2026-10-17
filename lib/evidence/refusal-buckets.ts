export type Bucket = "record" | "raw-capture" | "import" | "redaction" | "roots" | "missing" | "size" | "bytes" | "other";

export const BUCKETS: readonly Bucket[] = ["record", "raw-capture", "import", "redaction", "roots", "missing", "size", "bytes", "other"];

// Row order is the precedence: "run ... not found" must win over "file not found", redaction over bytes.
const TABLE: readonly (readonly [Bucket, readonly RegExp[]])[] = [
  ["record", [/not in run .* evidence record/, /has no evidence record/, /^run \S+ not found/]],
  ["raw-capture", [/is the raw capture for case/]],
  ["import", [/is the unredacted original of an imported ticket image/]],
  ["redaction", [/has no redaction record beside it/, /redaction record is malformed/, /changed since its redactions were recorded/, /redaction crop/, /has a redaction not yet confirmed/]],
  ["roots", [/outside the allowed upload roots/]],
  ["missing", [/file not found/, /path must be absolute/]],
  ["size", [/the upload cap is/]],
  ["bytes", [/extension must be one of/, /file bytes do not match/, /not a regular file/, /other hard links/, /cannot open file/, /cannot stat open file/, /changed identity/, /read short/, /grew during read/]],
];

export function bucketFor(error: string): Bucket {
  for (const [bucket, patterns] of TABLE) if (patterns.some((p) => p.test(error))) return bucket;
  return "other";
}
