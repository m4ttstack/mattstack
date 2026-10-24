import { FENCE_RE } from "./tree.ts";

const HEADING_RE = /^(#{1,6})(\s.*)$/;

function eachLine(text: string, visit: (line: string, heading: RegExpExecArray | null) => string): string {
  let fence: string | null = null;
  return text.split("\n").map((line) => {
    const fm = FENCE_RE.exec(line);
    if (fence !== null) {
      if (fm && fm[1]![0] === fence[0] && fm[1]!.length >= fence.length && fm[2] === "") fence = null;
      return visit(line, null);
    }
    if (fm) {
      fence = fm[1]!;
      return visit(line, null);
    }
    return visit(line, HEADING_RE.exec(line));
  }).join("\n");
}

function shallowestHeading(texts: string[]): number | null {
  let min: number | null = null;
  for (const text of texts) {
    eachLine(text, (line, h) => {
      if (h && (min === null || h[1]!.length < min)) min = h[1]!.length;
      return line;
    });
  }
  return min;
}

/** Moves every heading outside a fence by `delta` levels, kept within 1..6; the line count never changes, so seam offsets hold. */
export function shiftHeadings(text: string, delta: number): string {
  if (delta === 0) return text;
  return eachLine(text, (line, h) => (h ? "#".repeat(Math.max(1, Math.min(h[1]!.length + delta, 6))) + h[2]! : line));
}

export function relevelDelta(texts: string[], level: number): number {
  const min = shallowestHeading(texts);
  return min === null ? 0 : Math.min(level, 6) - min;
}
