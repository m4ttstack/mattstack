export const EVIDENCE_IMAGE_KEYS = ["before", "beforeAnnotated", "after", "afterAnnotated"] as const;
export type EvidenceImageKey = (typeof EVIDENCE_IMAGE_KEYS)[number];
export const EVIDENCE_TEXT_KEYS = ["transcript"] as const;
export type EvidenceTextKey = (typeof EVIDENCE_TEXT_KEYS)[number];
export interface EvidenceV1 {
  v: 1; before: string; beforeAnnotated?: string; after?: string; afterAnnotated?: string;
  transcript?: string; case?: string; url?: string; attach?: string;
}
export type ParsedEvidence =
  | { version: 1; evidence: EvidenceV1; images: { key: EvidenceImageKey; path: string }[] }
  | { version: 0; links: string[] }
  | { version: null };

const OPTIONAL_EVIDENCE_KEYS = ["beforeAnnotated", "after", "afterAnnotated", "transcript", "case", "url", "attach"] as const;

// One scan keeps links in document order. A file path starts a token (start,
// whitespace, quote or bracket) and ends in an extension; `52/52` and `/c/:id`
// are prose, not files. A path may be followed by `:line[:col]` and one mark of
// sentence punctuation, which stay out of the match.
const LINK_RE =
  /https?:\/\/[^\s"',)\]]+|(?<=^|[\s"'([])\/[^\s"',)\]]*\.[A-Za-z0-9]{1,8}(?=(?::\d+)*[.,;:]?(?:$|[\s"',)\]]))/g;

function linksIn(text: string): string[] {
  return [...new Set(text.match(LINK_RE) ?? [])];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

export type LegacyItem = { kind: "image" | "file" | "url"; value: string };

export function legacyItems(links: string[]): LegacyItem[] {
  return links.map((value) =>
    /^https?:\/\//i.test(value)
      ? { kind: "url", value }
      : { kind: IMAGE_EXT.test(value) ? "image" : "file", value },
  );
}

function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

/** @deprecated Use readEvidence; kept until the console moves to cases. */
export function parseEvidence(value: string | null | undefined): ParsedEvidence {
  const raw = value?.trim() ?? "";
  if (raw === "" || raw === "-") return { version: null };
  let json: unknown;
  try { json = JSON.parse(raw); } catch { json = undefined; }
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    if (o.plan === "none" && Object.keys(o).length === 1) return { version: null };
    if (o.v === 1 && typeof o.before === "string" && o.before) {
      const evidence: EvidenceV1 = { v: 1, before: o.before };
      for (const k of OPTIONAL_EVIDENCE_KEYS) {
        const field = o[k];
        if (typeof field === "string") evidence[k] = field;
      }
      const images = EVIDENCE_IMAGE_KEYS
        .filter((k) => typeof o[k] === "string" && (o[k] as string).length > 0)
        .map((key) => ({ key, path: o[key] as string }));
      return { version: 1, evidence, images };
    }
    const links = [...new Set(stringsIn(o).flatMap(linksIn))];
    return links.length ? { version: 0, links } : { version: null };
  }
  const links = linksIn(raw);
  return links.length ? { version: 0, links } : { version: null };
}

export const EVIDENCE_SLOTS = ["before", "after"] as const;
export type EvidenceSlotName = (typeof EVIDENCE_SLOTS)[number];
export const EVIDENCE_THEMES = ["light", "dark"] as const;
export type EvidenceTheme = (typeof EVIDENCE_THEMES)[number];
export const V1_CASE_ID = "case";

export interface EvidenceShot { theme?: EvidenceTheme; path: string; annotated?: string; caption?: string; waiver?: string }
export interface EvidenceCase { id: string; label: string; waiver?: string; before?: EvidenceShot[]; after?: EvidenceShot[] }
export type EvidenceRecord =
  | { version: 2; source: 1 | 2; cases: EvidenceCase[]; transcript?: string; url?: string; attach?: string }
  | { version: 0; links: string[] }
  | { version: null };
export interface EvidenceAddress { case: string; slot: EvidenceSlotName; theme?: EvidenceTheme; annotated?: boolean }
export type EvidenceShotRef = { caseId: string; slot: EvidenceSlotName; shot: EvidenceShot };

const RUN_KEYS = ["transcript", "url", "attach"] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// A case waiver covers only images with neither an annotated copy nor a waiver of their own.
function readImage(o: unknown, theme: EvidenceTheme | undefined, caseWaiver: string | undefined): EvidenceShot | null {
  if (!isObject(o) || !nonEmpty(o.path)) return null;
  const shot: EvidenceShot = { path: o.path };
  if (theme) shot.theme = theme;
  if (nonEmpty(o.annotated)) shot.annotated = o.annotated;
  if (nonEmpty(o.caption)) shot.caption = o.caption;
  const waiver = nonEmpty(o.waiver) ? o.waiver : shot.annotated ? undefined : caseWaiver;
  if (waiver) shot.waiver = waiver;
  return shot;
}

function readSlot(o: unknown, caseWaiver: string | undefined): EvidenceShot[] | undefined {
  if (!isObject(o)) return undefined;
  if ("path" in o) {
    const shot = readImage(o, undefined, caseWaiver);
    return shot ? [shot] : undefined;
  }
  const shots = EVIDENCE_THEMES.map((t) => readImage(o[t], t, caseWaiver)).filter((s): s is EvidenceShot => s !== null);
  return shots.length ? shots : undefined;
}

function readCase(o: unknown): EvidenceCase | null {
  if (!isObject(o) || !nonEmpty(o.id) || !nonEmpty(o.label)) return null;
  const waiver = nonEmpty(o.waiver) ? o.waiver : undefined;
  const c: EvidenceCase = { id: o.id, label: o.label };
  if (waiver) c.waiver = waiver;
  for (const slot of EVIDENCE_SLOTS) {
    const shots = readSlot(o[slot], waiver);
    if (shots) c[slot] = shots;
  }
  return c.before || c.after ? c : null;
}

function withRunKeys(record: Extract<EvidenceRecord, { version: 2 }>, from: Record<string, unknown>): EvidenceRecord {
  for (const k of RUN_KEYS) if (nonEmpty(from[k])) record[k] = from[k] as string;
  return record;
}

function v1Shot(path: string, annotated: string | undefined): EvidenceShot {
  return annotated ? { path, annotated } : { path };
}

/** Reads any evidence value as cases (v1 becomes one case) or legacy links. */
export function readEvidence(value: string | null | undefined): EvidenceRecord {
  let json: unknown;
  try { json = JSON.parse(value?.trim() ?? ""); } catch { json = undefined; }
  if (isObject(json) && json.v === 2 && Array.isArray(json.cases)) {
    const seen = new Set<string>();
    const cases: EvidenceCase[] = [];
    for (const raw of json.cases) {
      const c = readCase(raw);
      if (c && !seen.has(c.id)) { seen.add(c.id); cases.push(c); }
    }
    if (cases.length) return withRunKeys({ version: 2, source: 2, cases }, json);
  }
  const legacy = parseEvidence(value);
  if (legacy.version !== 1) return legacy;
  const e = legacy.evidence;
  const only: EvidenceCase = { id: V1_CASE_ID, label: nonEmpty(e.case) ? e.case : "Evidence", before: [v1Shot(e.before, e.beforeAnnotated)] };
  if (nonEmpty(e.after)) only.after = [v1Shot(e.after, e.afterAnnotated)];
  return withRunKeys({ version: 2, source: 1, cases: [only] }, e as unknown as Record<string, unknown>);
}

export function evidenceShots(record: EvidenceRecord): EvidenceShotRef[] {
  if (record.version !== 2) return [];
  return record.cases.flatMap((c) =>
    EVIDENCE_SLOTS.flatMap((slot) => (c[slot] ?? []).map((shot) => ({ caseId: c.id, slot, shot }))),
  );
}

/** The paths a run's record lets go to an MR: annotated images and waived bases. */
export function uploadablePaths(record: EvidenceRecord): string[] {
  return evidenceShots(record).flatMap(({ shot }) => (shot.annotated ? [shot.annotated] : shot.waiver ? [shot.path] : []));
}

export function resolveEvidencePath(record: EvidenceRecord, address: EvidenceAddress): { ok: true; path: string } | { ok: false; error: string } {
  const none = { ok: false as const, error: "no evidence" };
  if (record.version !== 2) return none;
  const shots = record.cases.find((c) => c.id === address.case)?.[address.slot];
  if (!shots) return none;
  const themed = shots.some((s) => s.theme !== undefined);
  if (themed && !address.theme) return { ok: false, error: "theme required: this slot is themed" };
  if (!themed && address.theme) return { ok: false, error: "this slot has no themes" };
  const shot = themed ? shots.find((s) => s.theme === address.theme) : shots[0];
  const path = address.annotated ? shot?.annotated : shot?.path;
  return path ? { ok: true, path } : none;
}

const CASE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PAIR = "must be an image or a {light, dark} pair";

function isAbsolutePath(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("/");
}

function imageProblem(o: unknown, where: string, caseWaived: boolean): string | null {
  if (!isObject(o)) return `${where} ${PAIR}`;
  if (!isAbsolutePath(o.path)) return `${where} path must be an absolute path`;
  if (o.annotated !== undefined && !isAbsolutePath(o.annotated)) return `${where} annotated must be an absolute path`;
  if (o.caption !== undefined && !nonEmpty(o.caption)) return `${where} has an empty caption`;
  if (o.waiver !== undefined && !nonEmpty(o.waiver)) return `${where} has an empty waiver; give a reason`;
  if (o.annotated !== undefined && o.waiver !== undefined) return `${where} has both an annotated image and a waiver; keep one`;
  if (o.annotated !== undefined && o.caption === undefined) return `${where} has an annotated image but no caption; say what the markers point at`;
  if (o.annotated === undefined && o.waiver === undefined && !caseWaived) {
    return `${where} has no annotated image and no waiver; annotate it or add a waiver with a reason`;
  }
  return null;
}

function slotProblem(o: unknown, where: string, caseWaived: boolean): string | null {
  if (!isObject(o)) return `${where} ${PAIR}`;
  if ("path" in o) return imageProblem(o, where, caseWaived);
  const themes = EVIDENCE_THEMES.filter((t) => o[t] !== undefined);
  if (themes.length === 0) return `${where} ${PAIR}`;
  for (const t of themes) {
    if (!isObject(o[t])) return `${where} (${t}) must be an image`;
    const problem = imageProblem(o[t], `${where} (${t})`, caseWaived);
    if (problem) return problem;
  }
  return null;
}

/** Refuses a v2 value with an image neither annotated nor waived, or a malformed one; any other value passes. */
export function validateEvidence(value: string): { ok: true } | { ok: false; error: string } {
  let json: unknown;
  try { json = JSON.parse(value.trim()); } catch { return { ok: true }; }
  if (!isObject(json) || json.v !== 2) return { ok: true };
  const fail = (message: string) => ({ ok: false as const, error: `evidence@2: ${message}` });
  if (json.transcript !== undefined && !isAbsolutePath(json.transcript)) return fail("transcript must be an absolute path");
  if (!Array.isArray(json.cases) || json.cases.length === 0) return fail("cases must be a non-empty list");
  const ids = new Set<string>();
  for (const [i, c] of json.cases.entries()) {
    if (!isObject(c)) return fail(`case ${i + 1} is not an object`);
    if (typeof c.id !== "string" || !CASE_ID.test(c.id)) return fail(`case ${i + 1} needs an id of lowercase letters, digits and dashes`);
    if (ids.has(c.id)) return fail(`case "${c.id}" appears twice`);
    ids.add(c.id);
    const where = `case "${c.id}"`;
    if (!nonEmpty(c.label)) return fail(`${where} needs a label`);
    if (c.waiver !== undefined && !nonEmpty(c.waiver)) return fail(`${where} has an empty waiver; give a reason`);
    if (c.before === undefined && c.after === undefined) return fail(`${where} needs a before or an after`);
    for (const slot of EVIDENCE_SLOTS) {
      if (c[slot] === undefined) continue;
      const problem = slotProblem(c[slot], `${where} ${slot}`, c.waiver !== undefined);
      if (problem) return fail(problem);
    }
  }
  return { ok: true };
}
