import type { StageEntry } from "./types.ts";

export type FieldUse = { key: string; line: number; template: boolean };
export type CompiledDoc = { path: string; text: string };

const KEY = String.raw`([A-Za-z][\w.-]*)(<)?`;
const READ_RES = [
  new RegExp(String.raw`run_field_get\s*\{[^}\n]*?\bkey:\s*["'\`]?` + KEY, "g"),
  new RegExp(String.raw`\brt runs field get\s+` + KEY, "g"),
];
const WRITE_RES = [
  new RegExp(String.raw`run_field_set\s*\{[^}\n]*?\bkey:\s*["'\`]?` + KEY, "g"),
  new RegExp(String.raw`\brt runs field set\s+` + KEY, "g"),
];

const PART_RE = /^<!-- part: (.*) -->$/;

export const RT_WRITTEN_KEYS: readonly string[] = [
  "work-type", "ticket", "repo", "mode", "claude-session", "herdr-pane",
  "agent", "pipeline-stages", "hold", "gate", "waiting-gate",
];
export const RT_WRITTEN_PREFIXES: readonly string[] = ["extra.context-dropped.", "extra.gate-source."];

function scan(lines: string[], res: RegExp[]): FieldUse[] {
  const out: FieldUse[] = [];
  lines.forEach((text, i) => {
    for (const re of res) {
      for (const m of text.matchAll(re)) {
        const template = m[2] === "<";
        out.push({ key: template ? m[1]! : m[1]!.replace(/[.-]+$/, ""), line: i + 1, template });
      }
    }
  });
  return out.sort((a, b) => a.line - b.line);
}

export function scanFieldUses(text: string): { reads: FieldUse[]; writes: FieldUse[] } {
  const lines = text.split("\n");
  return { reads: scan(lines, READ_RES), writes: scan(lines, WRITE_RES) };
}

export function sourceOf(text: string, line: number): { label: string; path: string; line: number } | null {
  const lines = text.split("\n");
  for (let i = line - 2; i >= 0; i--) {
    const part = lines[i]!.trim().match(PART_RE);
    if (!part) continue;
    const body = part[1]!;
    const path = body.match(/\bpath=(\S+)/)?.[1];
    const start = body.match(/\blines=(\d+)-/)?.[1];
    if (!path || !start) return null;
    const label = body.match(/\bbinding=(\S+)/)?.[1] ?? body.match(/\bsource=(\S+)/)?.[1] ?? body.match(/\binclude:\S+/)?.[0];
    if (!label) return null;
    return { label, path, line: Number(start) + (line - (i + 1) - 1) };
  }
  return null;
}

export function fieldContractErrors(docs: CompiledDoc[], stageEntries: Record<string, StageEntry[]>): string[] {
  const written = new Set<string>(RT_WRITTEN_KEYS);
  const prefixes = new Set<string>(RT_WRITTEN_PREFIXES);
  for (const entries of Object.values(stageEntries)) {
    for (const e of entries) for (const p of e.produces) written.add(p);
  }
  const scanned = docs.map((doc) => ({ doc, uses: scanFieldUses(doc.text) }));
  for (const { uses } of scanned) {
    for (const w of uses.writes) (w.template ? prefixes : written).add(w.key);
  }
  const errors: { path: string; line: number; message: string }[] = [];
  for (const { doc, uses } of scanned) {
    const seen = new Set<string>();
    for (const r of uses.reads) {
      if (r.template || seen.has(r.key)) continue;
      if (written.has(r.key) || [...prefixes].some((p) => r.key.startsWith(p))) continue;
      seen.add(r.key);
      const src = sourceOf(doc.text, r.line);
      const from = src ? ` (from ${src.label} ${src.path}:${src.line})` : "";
      errors.push({
        path: doc.path,
        line: r.line,
        message: `field contract: ${doc.path}:${r.line}${from} reads "${r.key}", which nothing in this pack writes`,
      });
    }
  }
  errors.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
  return errors.map((e) => e.message);
}
