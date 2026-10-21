import { basename } from "path";
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

const oneLine = (s: string) => s.replace(/\s*\r?\n\s*/g, " ");
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
      e.caption ??= shot.caption && oneLine(shot.caption);
      if (shot.waiver && shot.waiver !== c.waiver) e.waiver ??= oneLine(shot.waiver);
    }
  }
  return [...byKey.values()];
}

/** A file that never uploaded is named, not located: an MR description is read beyond this machine, and a local path carries the user's home. The transcript and attach lines follow the same rule. */
function linkText(l: FileLink, alt: string): string {
  if ("local" in l) return `${basename(l.local)} (attached separately)`;
  const url = /!\[[^\]]*\]\(([^)]*)\)/.exec(l.markdown)?.[1];
  return url === undefined ? l.markdown : `![${alt}](${url})`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inside a fold, a caption or waiver carrying a raw `</details>` would close it early, so its tags print as text. */
function renderEntry(e: Entry, link: (path: string) => FileLink, fold = false): string {
  const text = fold ? escapeHtml : (s: string) => s;
  const themes = EVIDENCE_THEMES.filter((t) => e.themes.includes(t));
  const label = `${cap(e.slots.join(" and "))}${themes.length ? ` (${themes.join(" and ")})` : ""}`;
  const lines = [`- ${label}: ${linkText(link(e.key), e.slots.join(" and "))}`];
  if (e.caption) lines.push(`  Caption: ${text(e.caption)}`);
  if (e.waiver) lines.push(`  Waived: ${text(e.waiver)}`);
  return lines.join("\n");
}

/** A carried-over attach line prints as text, never as a heading or a fence that would move the section's end on the next splice. */
function inert(line: string): string {
  return line.replace(/^( {0,3})(#{1,6}(?=[ \t]|$)|`{3,}|~{3,})/, "$1\\$2");
}

/** GitLab's own upload links are host-relative; every other absolute path in an attach line is this machine's. */
const GITLAB_RELATIVE = /^\/(?:uploads|-)\//;

function withoutLocalPaths(line: string): string {
  return line.replace(/(^|[\s([])(\/[^\s()[\]]+)/g, (whole, pre: string, path: string) =>
    GITLAB_RELATIVE.test(path) ? whole : `${pre}${basename(path)} (attached separately)`);
}

/** A home path continues into a longer user's name only through a name character, or a `.`/`_` with one after it; anything else ends it. */
const NAME_CONTINUES = "[A-Za-z0-9-]|[._][A-Za-z0-9-]";

/** The last guard before a section leaves the machine: the home directory (or its realpath) appearing anywhere, captions and waivers included, which the per-field renders cannot see. */
export function namesHome(text: string, homes: string[]): boolean {
  return homes
    .filter((h) => h.length > 1)
    .some((h) => new RegExp(`${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!${NAME_CONTINUES})`).test(text));
}

/** GitLab and GitHub both render markdown inside `<details>` only past a blank line after `</summary>`, and neither renders markdown inside `<summary>`. A waiver shows in the summary so a skim still sees it. */
function folded(label: string, body: string, count: number, waived: boolean): string {
  const noun = count === 1 ? "screenshot" : "screenshots";
  return `<details>\n<summary><b>${escapeHtml(label)}</b> (${count} ${noun}${waived ? ", waived" : ""})</summary>\n\n${body}\n\n</details>`;
}

function linksOf(line: string): string[] {
  return (line.match(/[^\s()[\]]+/g) ?? []).filter((t) => t.startsWith("/") || /^https?:\/\//.test(t));
}

export function renderSection(
  record: EvidenceRecord,
  link: (path: string) => FileLink,
  o: { coveredUrls?: Set<string>; appendix?: string; fold?: boolean },
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
      const fold = o.fold === true && entries.length > 0;
      const waiver = c.waiver ? [`Waived: ${fold ? escapeHtml(oneLine(c.waiver)) : oneLine(c.waiver)}`] : [];
      const list = entries.map((e) => renderEntry(e, link, fold)).join("\n");
      if (fold) {
        blocks.push(folded(oneLine(c.label), [...waiver, list].join("\n\n"), entries.length, c.waiver !== undefined || entries.some((e) => e.waiver)));
        continue;
      }
      const head = [`**${oneLine(c.label)}**`, ...waiver];
      blocks.push(entries.length ? [...head, list].join("\n\n") : head.join("\n\n"));
    }
    if (record.transcript) blocks.push(`Transcript: ${basename(oneLine(record.transcript))} (kept locally)`);
    if (record.url) blocks.push(`Ticket: ${oneLine(record.url)}`);
    for (const line of (record.attach ?? "").split("\n")) {
      const links = linksOf(line);
      if (!line.trim() || (links.length > 0 && links.every((l) => covered.has(l)))) continue;
      blocks.push(inert(withoutLocalPaths(line)));
    }
  } else if (record.version === 0) {
    for (const item of legacyItems(record.links)) {
      blocks.push(item.kind === "url" ? `- ${item.value}` : `- ${linkText(link(item.value), "")}`);
    }
    if (blocks.length) blocks.splice(0, blocks.length, blocks.join("\n"));
  }
  if (o.appendix) blocks.push(o.appendix);
  return blocks.join("\n\n");
}

interface Scanned { line: string; fenced: boolean; level: number }

function scan(lines: string[]): Scanned[] {
  return scanOpen(lines).rows;
}

function scanOpen(lines: string[]): { rows: Scanned[]; open: boolean } {
  let fence: { ch: string; len: number } | null = null;
  const rows = lines.map((line): Scanned => {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len && !line.slice(m[0].length).trim()) fence = null;
      return { line, fenced: true, level: 0 };
    }
    if (m) {
      fence = { ch: m[1]![0]!, len: m[1]!.length };
      return { line, fenced: true, level: 0 };
    }
    const h = /^ {0,3}(#{1,6})(?:[ \t\r]|$)/.exec(line);
    return { line, fenced: false, level: h ? h[1]!.length : 0 };
  });
  return { rows, open: fence !== null };
}

const levelOf = (heading: string) => /^ {0,3}(#{1,6})/.exec(heading)?.[1]?.length ?? 0;

/** Why appendix would end the section early (or swallow what follows it) on the next splice under heading; null when it splices safely. */
export function appendixProblem(appendix: string, heading: string): string | null {
  const level = levelOf(heading);
  const { rows, open } = scanOpen(appendix.split(/\r?\n/));
  const early = rows.find((r) => !r.fenced && r.level > 0 && r.level <= level);
  if (early) return `"appendix" has the heading "${early.line.trim()}", at or above the section's level, so it would end the section; use a deeper heading`;
  if (open) return `"appendix" opens a code fence it never closes, so the next splice would swallow the rest of the description; close the fence`;
  return null;
}

/** Ends of each helper unit (a comment block, then one italic line) under the heading, in order; blank lines between units are skipped. */
function helperUnits(lines: string[], from: number, to: number): number[] {
  const ends: number[] = [];
  let i = from;
  let italic = false;
  while (i < to) {
    const l = lines[i]!;
    if (!l.trim()) { i++; continue; }
    if (l.trimStart().startsWith("<!--")) {
      let j = i;
      while (j < to && !lines[j]!.includes("-->")) j++;
      if (j >= to) break;
      i = j + 1;
      ends.push(i);
    } else if (!italic && /^\s*(_[^_].*_|\*[^*].*\*)\s*$/.test(l)) {
      italic = true;
      i += 1;
      ends.push(i);
    } else break;
  }
  return ends;
}

const textOf = (lines: string[]) => lines.map((l) => l.trimEnd()).filter((l) => l !== "").join("\n");

/** A helper unit that is the start of the body being spliced is the previous splice's body, not the template's, so it is replaced rather than kept. */
function helperEnd(lines: string[], from: number, to: number, body: string): number {
  const ends = helperUnits(lines, from, to);
  const end = ends.length ? ends[ends.length - 1]! : from;
  const bodyText = textOf(body.split(/\r?\n/));
  for (const start of [from, ...ends.slice(0, -1)]) {
    const kept = textOf(lines.slice(start, end));
    if (kept && (bodyText === kept || bodyText.startsWith(`${kept}\n`))) return start;
  }
  return end;
}

export function spliceSection(description: string, heading: string, body: string, before?: string): string {
  const crlf = description.includes("\r\n");
  const cr = crlf ? "\r" : "";
  const endsNl = description.endsWith("\n");
  const lines = (endsNl ? description.slice(0, -1) : description).split("\n");
  const scanned = scan(lines);
  const find = (h: string, from = 0) => scanned.findIndex((s, i) => i >= from && !s.fenced && s.line.trimEnd() === h.trimEnd());
  const bodyLines = body ? ["", ...body.split(/\r?\n/)].map((l) => l + cr) : [];
  const blank = cr;
  const head = heading + cr;
  const tail = endsNl ? "\n" : "";
  const finish = (out: string[]) => {
    const text = out.join("\n");
    return endsNl || !crlf ? text + tail : text.replace(/\r$/, "");
  };

  const start = find(heading);
  if (start === -1) {
    const at = before === undefined ? -1 : find(before);
    if (at === -1) {
      const kept = description.replace(/(\r?\n)+$/, "");
      const nl = crlf ? "\r\n" : "\n";
      return `${kept ? `${kept}${nl}${nl}` : ""}${heading}${body ? `${nl}${nl}${body.replace(/\r?\n/g, nl)}` : ""}${nl}`;
    }
    const pre = lines.slice(0, at);
    if (pre.length && pre[pre.length - 1]!.trim()) pre.push(blank);
    return finish([...pre, head, ...bodyLines, blank, ...lines.slice(at)]);
  }

  const level = levelOf(heading);
  const stop = before === undefined ? -1 : find(before, start + 1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const s = scanned[i]!;
    if (i === stop || (!s.fenced && s.level > 0 && s.level <= level)) { end = i; break; }
  }
  const keepTo = helperEnd(lines, start + 1, end, body);
  const out = [...lines.slice(0, keepTo), ...bodyLines];
  if (end < lines.length) return finish([...out, blank, ...lines.slice(end)]);
  return finish(out);
}
