import { FENCE_RE } from "./tree.ts";

const HEADING_RE = /^(#{1,6})(\s.*)$/;
const SETEXT_RE = /^ {0,3}(=+|-+)\s*$/;
/** A list item, quote or table row above a dash line is not setext text, so the line stays a rule or a table edge. */
const NOT_SETEXT_TEXT_RE = /^\s*([-*+>|]|\d+[.)]\s)/;

/** True for each line inside a code fence, its opening and closing lines included. */
export function fencedLines(text: string): boolean[] {
  let fence: string | null = null;
  return text.split("\n").map((line) => {
    const fm = FENCE_RE.exec(line);
    if (fence !== null) {
      if (fm && fm[1]![0] === fence[0] && fm[1]!.length >= fence.length && fm[2] === "") fence = null;
      return true;
    }
    if (fm) fence = fm[1]!;
    return fm !== null;
  });
}

type Heading = { line: number; level: number; title: string; underline: boolean };

function headingsIn(text: string): Heading[] {
  const lines = text.split("\n");
  const fenced = fencedLines(text);
  const out: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced[i]) continue;
    const atx = HEADING_RE.exec(lines[i]!);
    if (atx) {
      out.push({ line: i, level: atx[1]!.length, title: atx[2]!.trim(), underline: false });
      continue;
    }
    const under = i + 1 < lines.length && !fenced[i + 1] ? SETEXT_RE.exec(lines[i + 1]!) : null;
    if (under && lines[i]!.trim() !== "" && !NOT_SETEXT_TEXT_RE.test(lines[i]!)) {
      out.push({ line: i, level: under[1]![0] === "=" ? 1 : 2, title: lines[i]!.trim(), underline: true });
      i++;
    }
  }
  return out;
}

/**
 * Moves every heading outside a fence by `delta` levels, kept within 1..6. A setext heading becomes an
 * ATX one and its underline a blank line, so the line count never changes and seam offsets hold.
 */
export function shiftHeadings(text: string, delta: number): string {
  if (delta === 0) return text;
  const lines = text.split("\n");
  for (const h of headingsIn(text)) {
    lines[h.line] = `${"#".repeat(Math.max(1, Math.min(h.level + delta, 6)))} ${h.title}`;
    if (h.underline) lines[h.line + 1] = "";
  }
  return lines.join("\n");
}

export function relevelDelta(texts: string[], level: number): number {
  const levels = texts.flatMap((t) => headingsIn(t).map((h) => h.level));
  return levels.length === 0 ? 0 : Math.min(level, 6) - Math.min(...levels);
}
