import {
  EVIDENCE_SLOTS,
  EVIDENCE_THEMES,
  type EvidenceCase,
  type EvidenceRecord,
  type EvidenceSlotName,
  type EvidenceTheme,
  legacyItems,
} from "../../packages/rt-client/src/evidence.ts";

export type FileLink = { markdown: string } | { local: string };

interface Entry {
  key: string;
  slots: EvidenceSlotName[];
  themes: EvidenceTheme[];
  caption?: string;
  waiver?: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function entriesOf(c: EvidenceCase): Entry[] {
  const byKey = new Map<string, Entry>();
  for (const slot of EVIDENCE_SLOTS) {
    for (const shot of c[slot] ?? []) {
      const key = shot.annotated ?? (shot.waiver ? shot.path : undefined);
      if (!key) continue;
      let e = byKey.get(key);
      if (!e) byKey.set(key, (e = { key, slots: [], themes: [] }));
      if (!e.slots.includes(slot)) e.slots.push(slot);
      if (shot.theme && !e.themes.includes(shot.theme)) e.themes.push(shot.theme);
      e.caption ??= shot.caption;
      if (shot.waiver && shot.waiver !== c.waiver) e.waiver ??= shot.waiver;
    }
  }
  return [...byKey.values()];
}

function linkText(l: FileLink, alt: string): string {
  if ("local" in l) return l.local;
  const url = /!\[[^\]]*\]\(([^)]*)\)/.exec(l.markdown)?.[1];
  return url === undefined ? l.markdown : `![${alt}](${url})`;
}

function renderEntry(e: Entry, link: (path: string) => FileLink): string {
  const themes = EVIDENCE_THEMES.filter((t) => e.themes.includes(t));
  const label = `${cap(e.slots.join(" and "))}${themes.length ? ` (${themes.join(" and ")})` : ""}`;
  const lines = [`- ${label}: ${linkText(link(e.key), e.slots.join(" and "))}`];
  if (e.caption) lines.push(`  Caption: ${e.caption}`);
  if (e.waiver) lines.push(`  Waived: ${e.waiver}`);
  return lines.join("\n");
}

function linksOf(line: string): string[] {
  return (line.match(/[^\s()[\]]+/g) ?? []).filter((t) => t.startsWith("/") || /^https?:\/\//.test(t));
}

export function renderSection(
  record: EvidenceRecord,
  link: (path: string) => FileLink,
  o: { coveredUrls?: Set<string>; appendix?: string },
): string {
  const blocks: string[] = [];
  const covered = new Set<string>(o.coveredUrls);
  if (record.version === 2) {
    for (const c of record.cases) {
      const entries = entriesOf(c);
      for (const slot of EVIDENCE_SLOTS) {
        for (const shot of c[slot] ?? []) {
          covered.add(shot.path);
          if (shot.annotated) covered.add(shot.annotated);
        }
      }
      const head = [`**${c.label}**`];
      if (c.waiver) head.push(`Waived: ${c.waiver}`);
      blocks.push(entries.length ? [...head, entries.map((e) => renderEntry(e, link)).join("\n")].join("\n\n") : head.join("\n\n"));
    }
    if (record.transcript) blocks.push(`Transcript: ${record.transcript}`);
    if (record.url) blocks.push(`Ticket: ${record.url}`);
    for (const line of (record.attach ?? "").split("\n")) {
      const links = linksOf(line);
      if (!line.trim() || (links.length > 0 && links.every((l) => covered.has(l)))) continue;
      blocks.push(line);
    }
  } else if (record.version === 0) {
    for (const item of legacyItems(record.links)) {
      blocks.push(item.kind === "url" ? `- ${item.value}` : `- ${linkText(link(item.value), "")}`);
    }
  }
  if (o.appendix) blocks.push(o.appendix);
  return blocks.join("\n\n");
}

interface Scanned { line: string; fenced: boolean; level: number }

function scan(lines: string[]): Scanned[] {
  let fence: { ch: string; len: number } | null = null;
  return lines.map((line) => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len && !line.slice(m[0].length).trim()) fence = null;
      return { line, fenced: true, level: 0 };
    }
    if (m) {
      fence = { ch: m[1]![0]!, len: m[1]!.length };
      return { line, fenced: true, level: 0 };
    }
    const h = /^ {0,3}(#{1,6})(?:[ \t]|$)/.exec(line);
    return { line, fenced: false, level: h ? h[1]!.length : 0 };
  });
}

const levelOf = (heading: string) => /^ {0,3}(#{1,6})/.exec(heading)?.[1]?.length ?? 0;

function helperEnd(lines: string[], from: number, to: number): number {
  let end = from;
  let i = from;
  let italic = false;
  while (i < to) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    if (l.trimStart().startsWith("<!--")) {
      let j = i;
      while (j < to && !lines[j]!.includes("-->")) j++;
      i = end = Math.min(j + 1, to);
    } else if (!italic && /^\s*(_[^_].*_|\*[^*].*\*)\s*$/.test(l)) {
      italic = true;
      i = end = i + 1;
    } else break;
  }
  return end;
}

export function spliceSection(description: string, heading: string, body: string, before?: string): string {
  const endsNl = description.endsWith("\n");
  const lines = (endsNl ? description.slice(0, -1) : description).split("\n");
  const scanned = scan(lines);
  const find = (h: string) => scanned.findIndex((s) => !s.fenced && s.line.trimEnd() === h.trimEnd());
  const bodyLines = body ? ["", ...body.split("\n")] : [];
  const start = find(heading);
  const tail = endsNl ? "\n" : "";

  if (start === -1) {
    const at = before === undefined ? -1 : find(before);
    if (at === -1) {
      const kept = description.replace(/\n+$/, "");
      return `${kept ? `${kept}\n\n` : ""}${heading}${body ? `\n\n${body}` : ""}\n`;
    }
    const head = lines.slice(0, at);
    if (head.length && head[head.length - 1]!.trim()) head.push("");
    return [...head, heading, ...bodyLines, "", ...lines.slice(at)].join("\n") + tail;
  }

  const level = levelOf(heading);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const s = scanned[i]!;
    if (!s.fenced && s.level > 0 && s.level <= level) { end = i; break; }
  }
  const keepTo = helperEnd(lines, start + 1, end);
  const out = [...lines.slice(0, keepTo), ...bodyLines];
  if (end < lines.length) return [...out, "", ...lines.slice(end)].join("\n") + tail;
  return out.join("\n") + tail;
}
