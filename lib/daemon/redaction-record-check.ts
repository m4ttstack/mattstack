/**
 * mr:upload's redaction gate: a composed board that hides part of a ticket
 * image goes out only once the operator confirmed every redaction crop of its
 * latest render. The record and crops are Fast Browser's compose output
 * (schema compose-redactions/1), copied beside the board with its bundle.
 * It guards against a skipped redaction gate, not against a board copied
 * elsewhere or a hand-edited record.
 */
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { basename, dirname, join } from "path";

const SCHEMA = "compose-redactions/1";
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

type Warn = (message: string, context: { err: unknown; path: string }) => void;

function safeReader(warn?: Warn) {
  return (path: string): Uint8Array | null => {
    try {
      return readFileSync(path);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return null;
      warn?.("redaction check: unreadable file, failing closed", { err, path });
      return new Uint8Array(0);
    }
  };
}

function json(bytes: Uint8Array): unknown {
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { return undefined; }
}

const isLive = (bytes: Uint8Array) => (json(bytes) as { source?: unknown } | null | undefined)?.source === "live";

function specIsGated(dir: string, stem: string, read: (p: string) => Uint8Array | null): boolean {
  const specBytes = read(join(dir, `${stem}.spec.json`));
  if (!specBytes) return false;
  const spec = json(specBytes) as { panels?: unknown } | null | undefined;
  if (!spec || typeof spec !== "object" || !Array.isArray(spec.panels)) return true;
  return spec.panels.some((panel) => {
    const p = panel as { capture?: unknown; marks?: unknown };
    const redacts = Array.isArray(p.marks) && p.marks.some((m) => m && typeof m === "object" && "redact" in m);
    if (!redacts) return false;
    if (typeof p.capture !== "string") return true;
    const sidecarBytes = read(join(dir, basename(p.capture)));
    return !sidecarBytes || !isLive(sidecarBytes);
  });
}

export function redactionUploadRefusal(o: {
  realpath: string;
  filename: string;
  bytes: Uint8Array;
  read?: (p: string) => Uint8Array | null;
  warn?: Warn;
}): string | null {
  const read = o.read ?? safeReader(o.warn);
  const dir = dirname(o.realpath);
  const board = basename(o.realpath);
  if (!board.toLowerCase().endsWith(".png")) return null;
  const stem = board.slice(0, -4);
  const sidecarBytes = read(join(dir, `${stem}.capture.json`));
  if (sidecarBytes && !isLive(sidecarBytes)) {
    return `${o.filename} is the unredacted original of an imported ticket image; upload the composed board instead`;
  }
  const rawRecord = read(join(dir, `${stem}.redactions.json`));
  if (!rawRecord) {
    return specIsGated(dir, stem, read)
      ? `${o.filename} hides part of a ticket image but has no redaction record beside it; render the board again, confirm its crops at the redaction gate, and copy the record and crops beside the board`
      : null;
  }
  const malformed = `${o.filename}'s redaction record is malformed; render the board again`;
  const record = json(rawRecord) as { schemaVersion?: unknown; board?: unknown; boardSha256?: unknown; redactions?: unknown } | undefined;
  if (!record || record.schemaVersion !== SCHEMA || record.board !== board || typeof record.boardSha256 !== "string"
    || !Array.isArray(record.redactions)) return malformed;
  const entries = record.redactions as { crop?: unknown; sha256?: unknown; confirmed?: unknown }[];
  if (entries.some((e, i) => e?.crop !== `${stem}.redact-${i + 1}.png` || typeof e.sha256 !== "string")) return malformed;
  if (record.boardSha256 !== sha256(o.bytes)) {
    return `${o.filename} changed since its redactions were recorded; render the board again, confirm its crops at the redaction gate, and copy the record and crops beside the board`;
  }
  for (const e of entries) {
    const crop = read(join(dir, e.crop as string));
    if (!crop || sha256(crop) !== e.sha256) {
      return `${o.filename}'s redaction crop ${e.crop} is missing or changed; render the board again, confirm its crops at the redaction gate, and copy the record and crops beside the board`;
    }
  }
  if (entries.some((e) => e.confirmed !== true)) {
    return `${o.filename} has a redaction not yet confirmed; show each crop at the redaction gate, run fast-browser compose --confirm after a yes, and copy the confirmed record beside the board`;
  }
  return null;
}

/**
 * A board whose panel was drawn from a ticket image (the image itself, or its
 * import capture, both in the run's evidence-tickets) goes out only when its
 * redaction record holds a crop for that panel: a pair board reuses the
 * before's import capture, and its own marks decide what it hides. A panel's
 * pixels are found as compose finds them, the sidecar its spec names and then
 * the image that sidecar names, matched by bytes (with the <x>.png beside the
 * sidecar too), so no name or sidecar field can clear them. A sidecar or image
 * outside the board's folder cannot be checked here and fails closed. The
 * record's panel field is trusted as compose wrote it, inside this module's
 * scope (a skipped gate, not a hand-edited record). Run after
 * redactionUploadRefusal, which proves the record belongs to this board and
 * is confirmed.
 */
export function ticketPanelRefusal(o: {
  realpath: string;
  filename: string;
  tickets: Array<{ size: number; sha256: string }>;
  read?: (p: string) => Uint8Array | null;
  warn?: Warn;
}): string | null {
  if (o.tickets.length === 0) return null;
  const read = o.read ?? safeReader(o.warn);
  const dir = dirname(o.realpath);
  const board = basename(o.realpath);
  if (!board.toLowerCase().endsWith(".png")) return null;
  const stem = board.slice(0, -4);
  const specBytes = read(join(dir, `${stem}.spec.json`));
  if (!specBytes) return null;
  const panels = (json(specBytes) as { panels?: unknown } | null | undefined)?.panels;
  if (!Array.isArray(panels)) return null;
  const sizes = new Set(o.tickets.map((t) => t.size));
  const isTicket = (bytes: Uint8Array) => {
    if (!sizes.has(bytes.length)) return false;
    const mine = sha256(bytes);
    return o.tickets.some((t) => t.size === bytes.length && t.sha256 === mine);
  };
  const outside = (i: number, name: string) => `${o.filename}: panel ${i + 1}'s capture ${name} is not beside the board, so it cannot be checked against the run's ticket images; copy the board's whole bundle`;
  const unreadable = (i: number, name: string) => `${o.filename}: panel ${i + 1}'s capture ${name} could not be read to rule out a ticket image; fix its permissions or render the board again`;
  let covered: Set<unknown> | null = null;
  const coveredPanels = () => {
    if (covered) return covered;
    const record = json(read(join(dir, `${stem}.redactions.json`)) ?? new Uint8Array(0)) as { redactions?: unknown } | null | undefined;
    const entries = Array.isArray(record?.redactions) ? (record.redactions as Array<{ panel?: unknown } | null>) : [];
    covered = new Set(entries.map((e) => e?.panel));
    return covered;
  };
  for (const [i, panel] of panels.entries()) {
    const capture = (panel as { capture?: unknown } | null)?.capture;
    if (typeof capture !== "string" || capture.length === 0) continue;
    if (basename(capture) !== capture || !capture.endsWith(".capture.json")) return outside(i, capture);
    const sidecarBytes = read(join(dir, capture));
    if (sidecarBytes !== null && sidecarBytes.length === 0) return unreadable(i, capture);
    const sidecar = json(sidecarBytes ?? new Uint8Array(0)) as { image?: unknown } | null | undefined;
    const fallback = `${capture.slice(0, -".capture.json".length)}.png`;
    const image = typeof sidecar?.image === "string" ? sidecar.image : fallback;
    if (basename(image) !== image) return outside(i, image);
    let ticket = false;
    for (const name of image === fallback ? [image] : [image, fallback]) {
      const bytes = read(join(dir, name));
      if (bytes === null) {
        if (name === image) return outside(i, name);
        continue;
      }
      if (bytes.length === 0) return unreadable(i, name);
      if (isTicket(bytes)) ticket = true;
    }
    if (ticket && !coveredPanels().has(i)) {
      return `${o.filename} shows a ticket image in panel ${i + 1} with nothing hidden on it; redact its personal data in that panel, confirm the crops at the redaction gate, and copy the record and crops beside the board`;
    }
  }
  return null;
}
