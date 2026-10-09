export const EVIDENCE_IMAGE_KEYS = ["before", "beforeAnnotated", "after", "afterAnnotated"] as const;
export type EvidenceImageKey = (typeof EVIDENCE_IMAGE_KEYS)[number];
export interface EvidenceV1 {
  v: 1; before: string; beforeAnnotated?: string; after?: string; afterAnnotated?: string;
  transcript?: string; case?: string; url?: string; attach?: string;
}
export type ParsedEvidence =
  | { version: 1; evidence: EvidenceV1; images: { key: EvidenceImageKey; path: string }[] }
  | { version: 0; links: string[] }
  | { version: null };

const LINK = /(https?:\/\/[^\s"',)]+|\/[^\s"',)]+)/g;

function linksIn(text: string): string[] {
  return [...new Set(text.match(LINK) ?? [])];
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
      const evidence = o as unknown as EvidenceV1;
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
