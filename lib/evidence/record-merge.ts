import { parseEvidence } from "../../packages/rt-client/src/evidence.ts";
import type { TicketEntry } from "./tickets-field.ts";

export type Slot = "before" | "after";
export type Theme = "light" | "dark";
export interface RawImage { path: string; annotated?: string; caption?: string; waiver?: string; [k: string]: unknown }
export type RawSlot = RawImage | { light?: RawImage; dark?: RawImage };
export interface RawCase { id: string; label: string; waiver?: string; before?: RawSlot; after?: RawSlot; [k: string]: unknown }
export interface RawRecord { cases: RawCase[]; transcript?: string; url?: string; attach?: string; extra: Record<string, unknown> }
/** recapture, when set, is the caller's decision that path replaces the image; unset falls back to comparing paths. */
export interface ImageInput { case: string; label?: string; slot: Slot; theme?: Theme; path?: string; source?: "ticket"; annotated?: string; caption?: string; waiver?: string; recapture?: boolean }
export interface MergeInput {
  images?: ImageInput[];
  cases?: Array<{ id: string; label?: string; waiver?: string }>;
  remove?: Array<{ case: string; slot?: Slot; theme?: Theme }>;
  transcript?: string;
  url?: string;
}
export type Uncovered = { case: string; slot: Slot; theme?: Theme; path: string; why: "no-cover" | "no-caption" };
export type Encoding = "evidence@2" | "plan:text" | "plan:ticket" | "plan:none";

const SLOTS: Slot[] = ["before", "after"];
const THEMES: Theme[] = ["light", "dark"];
const RUN_KEYS = ["transcript", "url", "attach"] as const;
const RECORD_KEYS = new Set<string>(["v", "cases", ...RUN_KEYS]);

type Fail = { ok: false; error: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isSingle(slot: RawSlot): slot is RawImage {
  return "path" in slot;
}

function runKeys(from: Record<string, unknown>, into: RawRecord): void {
  for (const k of RUN_KEYS) if (typeof from[k] === "string" && (from[k] as string).trim()) into[k] = from[k] as string;
}

export function parseCurrent(value: string | null): RawRecord {
  const record: RawRecord = { cases: [], extra: {} };
  const raw = value?.trim() ?? "";
  if (raw === "" || raw === "-") return record;
  let json: unknown;
  try { json = JSON.parse(raw); } catch { json = undefined; }
  if (isObject(json)) {
    if (json.plan === "none" && Object.keys(json).length === 1) return record;
    if (json.v === 2 && Array.isArray(json.cases)) {
      record.cases = json.cases.filter(isObject) as RawCase[];
      runKeys(json, record);
      for (const [k, v] of Object.entries(json)) if (!RECORD_KEYS.has(k)) record.extra[k] = v;
      return record;
    }
    const legacy = parseEvidence(raw);
    if (legacy.version === 1) {
      const e = legacy.evidence;
      const image = (path: string, annotated: string | undefined): RawImage => (annotated ? { path, annotated } : { path });
      const only: RawCase = { id: "case", label: e.case?.trim() ? e.case : "Evidence", before: image(e.before, e.beforeAnnotated) };
      if (e.after) only.after = image(e.after, e.afterAnnotated);
      record.cases = [only];
      runKeys(e as unknown as Record<string, unknown>, record);
      return record;
    }
    if (typeof json.url === "string" || typeof json.transcript === "string") {
      runKeys(json, record);
      return record;
    }
  }
  record.attach = raw;
  return record;
}

export function imageAddresses(record: RawRecord): Array<{ case: string; slot: Slot; theme?: Theme; image: RawImage }> {
  const out: Array<{ case: string; slot: Slot; theme?: Theme; image: RawImage }> = [];
  for (const c of record.cases) {
    for (const slot of SLOTS) {
      const s = c[slot];
      if (!s) continue;
      if (isSingle(s)) { out.push({ case: c.id, slot, image: s }); continue; }
      for (const theme of THEMES) if (s[theme]) out.push({ case: c.id, slot, theme, image: s[theme]! });
    }
  }
  return out;
}

export function uncoveredImages(record: RawRecord): Uncovered[] {
  const caseWaived = new Set(record.cases.filter((c) => c.waiver).map((c) => c.id));
  const out: Uncovered[] = [];
  for (const { case: id, slot, theme, image } of imageAddresses(record)) {
    const base = { case: id, slot, ...(theme ? { theme } : {}), path: image.path };
    if (image.annotated) { if (!image.caption) out.push({ ...base, why: "no-caption" }); continue; }
    if (image.waiver || caseWaived.has(id)) continue;
    out.push({ ...base, why: "no-cover" });
  }
  return out;
}

const where = (id: string, slot: Slot, theme?: Theme) => `case "${id}" ${slot}${theme ? ` (${theme})` : ""}`;

function imageAt(c: RawCase | undefined, slot: Slot, theme?: Theme): RawImage | undefined {
  const s = c?.[slot];
  if (!s) return undefined;
  if (isSingle(s)) return theme ? undefined : s;
  return theme ? s[theme] : undefined;
}

function pruneEmpty(record: RawRecord): void {
  record.cases = record.cases.filter((c) => c.before || c.after);
}

function applyRemove(record: RawRecord, remove: NonNullable<MergeInput["remove"]>): Fail | null {
  for (const r of remove) {
    const c = record.cases.find((x) => x.id === r.case);
    if (!c) return { ok: false, error: `remove: case "${r.case}" not found` };
    if (!r.slot) { record.cases = record.cases.filter((x) => x !== c); continue; }
    const s = c[r.slot];
    if (!s) return { ok: false, error: `remove: ${where(r.case, r.slot)} not found` };
    if (!r.theme) { delete c[r.slot]; }
    else {
      if (isSingle(s) || !s[r.theme]) return { ok: false, error: `remove: ${where(r.case, r.slot, r.theme)} not found` };
      delete s[r.theme];
      if (!s.light && !s.dark) delete c[r.slot];
    }
  }
  pruneEmpty(record);
  return null;
}

function moveCaseWaiver(c: RawCase): void {
  if (!c.waiver) return;
  for (const slot of SLOTS) {
    const s = c[slot];
    if (!s) continue;
    for (const img of isSingle(s) ? [s] : THEMES.flatMap((t) => (s[t] ? [s[t]!] : []))) {
      if (!img.annotated && !img.waiver) img.waiver = c.waiver;
    }
  }
  delete c.waiver;
}

function newImage(e: ImageInput): RawImage {
  const img: RawImage = { path: e.path! };
  if (e.source !== undefined) img.source = e.source;
  if (e.annotated !== undefined) img.annotated = e.annotated;
  if (e.caption !== undefined) img.caption = e.caption;
  if (e.waiver !== undefined) img.waiver = e.waiver;
  return img;
}

// A cover never clears source: only a recapture at a new path (newImage) drops the ticket mark.
function patchCover(img: RawImage, e: ImageInput): void {
  if (e.source !== undefined) img.source = e.source;
  if (e.annotated !== undefined) {
    img.annotated = e.annotated;
    if (e.caption !== undefined) img.caption = e.caption; else delete img.caption;
    delete img.waiver;
  } else if (e.caption !== undefined) {
    img.caption = e.caption;
  }
  if (e.waiver !== undefined) {
    img.waiver = e.waiver;
    delete img.annotated;
    delete img.caption;
  }
}

export function mergeRecord(current: RawRecord, input: MergeInput): { ok: true; record: RawRecord } | Fail {
  const record = structuredClone(current);
  const images = input.images ?? [];

  for (const e of images) {
    if (e.annotated !== undefined && e.waiver !== undefined) {
      return { ok: false, error: `${where(e.case, e.slot, e.theme)}: give annotated or waiver, not both` };
    }
  }

  const removed = applyRemove(record, input.remove ?? []);
  if (removed) return removed;

  const findCase = (id: string) => record.cases.find((c) => c.id === id);
  const labels = new Map<string, string>();
  for (const e of images) if (e.label && !labels.has(e.case)) labels.set(e.case, e.label);

  for (const entry of input.cases ?? []) {
    let c = findCase(entry.id);
    if (!c) {
      if (!entry.label) return { ok: false, error: `case "${entry.id}" is new and needs a label` };
      c = { id: entry.id, label: entry.label };
      record.cases.push(c);
    } else if (entry.label) c.label = entry.label;
    if (entry.waiver) c.waiver = entry.waiver;
  }

  const recaptures = new Map<string, ImageInput[]>();
  const covers: ImageInput[] = [];
  for (const e of images) {
    const existing = imageAt(findCase(e.case), e.slot, e.theme);
    if (e.path !== undefined && (e.recapture ?? e.path !== existing?.path)) {
      const key = `${e.case}\0${e.slot}`;
      recaptures.set(key, [...(recaptures.get(key) ?? []), e]);
    } else covers.push(e);
  }

  const rewaived = new Set((input.cases ?? []).filter((c) => c.waiver).map((c) => c.id));
  const preWaived = new Set(current.cases.filter((c) => c.waiver && !rewaived.has(c.id)).map((c) => c.id));
  const moved = new Set<string>();
  for (const [key, entries] of recaptures) {
    const [id, slotName] = key.split("\0") as [string, Slot];
    let c = findCase(id);
    if (!c) {
      const label = labels.get(id);
      if (!label) return { ok: false, error: `case "${id}" is new and needs a label` };
      c = { id, label };
      record.cases.push(c);
    }
    if (preWaived.has(id) && !moved.has(id)) { moveCaseWaiver(c); moved.add(id); }
    const themed = entries.filter((e) => e.theme);
    if (themed.length && themed.length !== entries.length) {
      return { ok: false, error: `${where(id, slotName)}: give every image a theme or none` };
    }
    if (themed.length) {
      const pair: { light?: RawImage; dark?: RawImage } = {};
      for (const e of themed) pair[e.theme!] = newImage(e);
      c[slotName] = pair;
    } else {
      if (entries.length > 1) return { ok: false, error: `${where(id, slotName)}: several images need a theme each` };
      c[slotName] = newImage(entries[0]!);
    }
  }

  for (const e of covers) {
    const c = findCase(e.case);
    const slot = c?.[e.slot];
    if (slot && !isSingle(slot) && !e.theme) return { ok: false, error: `${where(e.case, e.slot)}: theme required, this slot is themed` };
    if (slot && isSingle(slot) && e.theme) return { ok: false, error: `${where(e.case, e.slot)}: this slot has no themes` };
    const img = imageAt(c, e.slot, e.theme);
    if (!img) {
      const replaced = recaptures.has(`${e.case}\0${e.slot}`) ? "; slot is replaced by this call's recapture" : "";
      return { ok: false, error: `${where(e.case, e.slot, e.theme)}: no image there to update${replaced}` };
    }
    patchCover(img, e);
  }

  if (input.transcript !== undefined) record.transcript = input.transcript;
  if (input.url !== undefined) record.url = input.url;
  return { ok: true, record };
}

/**
 * Records size and sha256 on each ticket image the call addressed that has
 * none: a recapture (newImage drops them) or a legacy shot. measure reads the
 * run-folder copy, never the caller's word; a shot that has them keeps them.
 */
export function stampTicketBytes(
  record: RawRecord,
  touched: Array<{ case: string; slot: Slot; theme?: Theme }>,
  measure: (path: string) => { size: number; sha256: string },
): { ok: true } | Fail {
  for (const t of touched) {
    const img = imageAt(record.cases.find((c) => c.id === t.case), t.slot, t.theme);
    if (!img || img.source !== "ticket" || typeof img.sha256 === "string") continue;
    try {
      const { size, sha256 } = measure(img.path);
      img.size = size;
      img.sha256 = sha256;
    } catch (err) {
      return { ok: false, error: `${where(t.case, t.slot, t.theme)}: the ticket image could not be read to record its size and sha256 (${(err as Error).message}); recapture it` };
    }
  }
  return { ok: true };
}

/**
 * A ticket image's board composed from an import carries the ticket's pixels
 * under other bytes, in the import capture beside it: each such capture is
 * remembered as the ticket image too. The link is the record's own cover, so
 * an import that no ticket image's board holds is never marked; every
 * non-live capture in that board's bundle is, a sibling import of some other
 * image included, which only refuses more. measure returns null for a file
 * that can never upload.
 */
export function importedTicketEntries(
  record: RawRecord,
  captures: (board: string) => string[],
  measure: (path: string) => { size: number; sha256: string } | null,
): { ok: true; entries: TicketEntry[] } | Fail {
  const entries: TicketEntry[] = [];
  for (const { case: id, slot, theme, image } of imageAddresses(record)) {
    if (image.source !== "ticket" || typeof image.annotated !== "string") continue;
    for (const path of captures(image.annotated)) {
      try {
        const bytes = measure(path);
        if (bytes) entries.push({ path, ...bytes });
      } catch (err) {
        return { ok: false, error: `${where(id, slot, theme)}: the import capture ${path} of the ticket image could not be read to record its size and sha256 (${(err as Error).message}); recapture it` };
      }
    }
  }
  return { ok: true, entries };
}

const SHA256 = /^[0-9a-f]{64}$/;

export function ticketEntries(record: RawRecord): TicketEntry[] {
  return imageAddresses(record).flatMap(({ image: i }) =>
    i.source === "ticket" && Number.isSafeInteger(i.size) && typeof i.sha256 === "string" && SHA256.test(i.sha256)
      ? [{ path: i.path, size: i.size as number, sha256: i.sha256 }]
      : []);
}

/**
 * The ticket mark never rests on the caller repeating source: an image at a
 * known ticket image's path takes that image's recorded bytes, and one whose
 * bytes match a known ticket image is that image wherever it sits. Only an
 * image whose size matches a known ticket image is hashed.
 */
export function markKnownTickets(
  record: RawRecord,
  known: TicketEntry[],
  files: { real: (p: string) => string; size: (p: string) => number | null; sha256: (p: string) => string | null },
): void {
  if (known.length === 0) return;
  const byPath = new Map(known.map((t) => [files.real(t.path), t]));
  const sizes = new Set(known.map((t) => t.size));
  for (const { image } of imageAddresses(record)) {
    if (image.source === "ticket") continue;
    let match = byPath.get(files.real(image.path));
    if (!match) {
      const size = files.size(image.path);
      const sha = size !== null && sizes.has(size) ? files.sha256(image.path) : null;
      match = sha === null ? undefined : known.find((t) => t.size === size && t.sha256 === sha);
    }
    if (!match) continue;
    image.source = "ticket";
    image.size = match.size;
    image.sha256 = match.sha256;
  }
}

export function serializeRecord(
  record: RawRecord,
  plan?: "none",
): { ok: true; encoding: Encoding; value: string } | Fail {
  if (plan === "none") return { ok: true, encoding: "plan:none", value: JSON.stringify({ plan: "none" }) };
  if (record.cases.length) {
    const body: Record<string, unknown> = { v: 2, ...record.extra, cases: record.cases };
    for (const k of RUN_KEYS) if (record[k] !== undefined) body[k] = record[k];
    return { ok: true, encoding: "evidence@2", value: JSON.stringify(body) };
  }
  if (record.transcript) {
    const body: Record<string, string> = { plan: "text", transcript: record.transcript };
    if (record.url) body.url = record.url;
    return { ok: true, encoding: "plan:text", value: JSON.stringify(body) };
  }
  if (record.url) return { ok: true, encoding: "plan:ticket", value: JSON.stringify({ plan: "ticket", url: record.url }) };
  return { ok: false, error: "nothing to record: give images, a transcript or a url" };
}
