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
// are prose, not files.
const LINK_RE = /https?:\/\/[^\s"',)\]]+|(?<=^|[\s"'([])\/[^\s"',)\]]*\.[A-Za-z0-9]{1,8}(?=$|[\s"',)\]])/g;

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
