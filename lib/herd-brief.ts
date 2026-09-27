export interface BriefInputs {
  template: string; // job-template.md content
  job: string;
  fills: Record<string, string>; // slot name (marker text without brackets) -> value
  method:
    | { kind: "strategy"; strategies: string; name: string } // extract the named body
    | { kind: "file"; content: string }; // domain-supplied Method block
}

export type BriefResult = { ok: true; brief: string } | { ok: false; error: string; leftover?: string[] };

const METHOD_HEADING_RE = /^## Method\r?\n/m;
const NEXT_HEADING_RE = /^## /gm;
const STRATEGY_RE = /^## ([^\n]+)\n+```\n([\s\S]*?)\n```/gm;
const INDENTED_LINE_RE = /^ {4,}/;
// No \n exclusion: word-wrapped prose (the real job-template.md) puts a
// slot's < and > on different physical lines.
const MARKER_RE = /<([^<>]+)>/g;
const DECORATIVE_SPAN_RE = /`[^`]*`|"[^"]*"/g;

const AUTHOR_OPEN = "<!-- author -->";
const AUTHOR_CLOSE = "<!-- /author -->";
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

// readFileSync(path, "utf8") keeps a leading BOM, which would hide an opener on line 1.
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export type StripResult = { ok: true; text: string } | { ok: false; error: string };

/** Removes author-note blocks (marker lines included). Markers inside a
    fenced code block are text. A document with no markers is returned as
    is. `startLine` is the 1-based line number of doc's own first line
    within the source document, so a strategy body's errors report lines
    from strategies.md rather than from the extracted body. */
export function stripAuthorNotes(doc: string, source: "template" | "method", startLine = 1): StripResult {
  const lines = doc.split("\n");
  const kept: string[] = [];
  let fence: string | null = null;
  let openAt = 0;
  let precededByBlank = false;
  let dropNextBlank = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = startLine + i;
    if (fence === null) {
      const withoutBom = i === 0 && line.startsWith(BYTE_ORDER_MARK) ? line.slice(1) : line;
      const bare = withoutBom.replace(/\s+$/, "");
      if (bare === AUTHOR_OPEN) {
        if (openAt > 0) return { ok: false, error: `author note opened at ${source} line ${lineNo} is inside the one opened at line ${openAt}; author notes do not nest` };
        openAt = lineNo;
        precededByBlank = kept.length === 0 || kept[kept.length - 1]!.trim() === "";
        continue;
      }
      if (bare === AUTHOR_CLOSE) {
        if (openAt === 0) return { ok: false, error: `${AUTHOR_CLOSE} at ${source} line ${lineNo} has no matching ${AUTHOR_OPEN}` };
        openAt = 0;
        dropNextBlank = precededByBlank;
        continue;
      }
    }
    const fenceMatch = FENCE_RE.exec(line);
    if (fence === null) {
      if (fenceMatch) fence = fenceMatch[1]!;
    } else if (fenceMatch && fenceMatch[1]![0] === fence[0] && fenceMatch[1]!.length >= fence.length && line.slice(fenceMatch[0].length).trim() === "") {
      fence = null;
    }
    if (openAt > 0) continue;
    if (dropNextBlank) {
      dropNextBlank = false;
      if (line.trim() === "") continue;
    }
    kept.push(line);
  }
  if (openAt > 0) return { ok: false, error: `author note opened at ${source} line ${openAt} is never closed (${AUTHOR_CLOSE} missing)` };
  return { ok: true, text: kept.join("\n") };
}

function normalizeMarkerName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

interface LineInfo {
  text: string;
  start: number;
  indented: boolean;
}

function indexLines(doc: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let offset = 0;
  for (const text of doc.split("\n")) {
    lines.push({ text, start: offset, indented: INDENTED_LINE_RE.test(text) });
    offset += text.length + 1; // +1 for the split "\n"
  }
  return lines;
}

function lineIndexForOffset(lines: LineInfo[], offset: number): number {
  // Linear scan is fine: templates/strategy bodies are short documents.
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.start <= offset) idx = i;
    else break;
  }
  return idx;
}

function computeDecorativeSpans(doc: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  DECORATIVE_SPAN_RE.lastIndex = 0;
  let span: RegExpExecArray | null;
  while ((span = DECORATIVE_SPAN_RE.exec(doc))) {
    spans.push([span.index, span.index + span[0].length]);
  }
  return spans;
}

/** A marker is decorative (illustrative example syntax for the eventual
    worker to fill in later, not a slot for this assembler to fill now)
    when its start line is an indented code example, or it sits fully
    inside a backtick or double-quote span (which may itself cross a line
    break, as the real template's own worked examples do). */
function isDecorative(lines: LineInfo[], startLineIdx: number, matchStart: number, matchEnd: number, spans: Array<[number, number]>): boolean {
  if (lines[startLineIdx]!.indented) return true;
  return spans.some(([s, e]) => matchStart >= s && matchEnd <= e);
}

function parseStrategies(strategies: string): { name: string; body: string; bodyLine: number }[] {
  const found: { name: string; body: string; bodyLine: number }[] = [];
  let match: RegExpExecArray | null;
  STRATEGY_RE.lastIndex = 0;
  while ((match = STRATEGY_RE.exec(strategies))) {
    const name = match[1];
    const body = match[2];
    if (name === undefined || body === undefined) continue; // regex guarantees both groups when the overall match succeeds
    const bodyStart = match.index + match[0].length - "\n```".length - body.length;
    const bodyLine = strategies.slice(0, bodyStart).split("\n").length;
    found.push({ name: name.trim(), body, bodyLine });
  }
  return found;
}

function resolveMethodBody(method: BriefInputs["method"]): { ok: true; body: string; bodyLine: number } | { ok: false; error: string } {
  if (method.kind === "file") {
    return { ok: true, body: method.content, bodyLine: 1 };
  }
  const strategies = parseStrategies(method.strategies);
  const found = strategies.find((s) => s.name === method.name);
  if (!found) {
    const available = strategies.map((s) => s.name).join(", ");
    return { ok: false, error: `unknown strategy '${method.name}'; available: ${available}` };
  }
  return { ok: true, body: found.body, bodyLine: found.bodyLine };
}

/** Splits the template into the piece before the Method placeholder and the
    piece after (the placeholder itself is discarded; the resolved method
    body is substituted and spliced back in separately by the caller). Kept
    apart -- rather than concatenated -- so a stray unbalanced backtick or
    quote in the (untrusted, domain-supplied) method body can never desync
    decorative-span pairing in the template's own (audited, fixed) prose,
    or vice versa. See the "stray unbalanced backtick" test. */
function splitAroundMethod(template: string): { ok: true; before: string; after: string; hasNext: boolean } | { ok: false; error: string } {
  const headingMatch = METHOD_HEADING_RE.exec(template);
  if (!headingMatch) {
    return { ok: false, error: "template has no '## Method' section" };
  }
  const afterHeadingIdx = headingMatch.index + headingMatch[0].length;
  NEXT_HEADING_RE.lastIndex = afterHeadingIdx;
  const nextMatch = NEXT_HEADING_RE.exec(template);
  const nextHeadingStart = nextMatch ? nextMatch.index : template.length;

  return {
    ok: true,
    before: template.slice(0, afterHeadingIdx),
    after: template.slice(nextHeadingStart),
    hasNext: nextMatch !== null,
  };
}

/** Single pass over the assembled document: real (non-decorative) markers
    are replaced from `fills` when present, else recorded as leftover;
    decorative markers (illustrative example syntax) are left untouched. */
function substituteMarkers(doc: string, fills: Record<string, string>): { text: string; leftover: string[] } {
  const lines = indexLines(doc);
  const spans = computeDecorativeSpans(doc);
  const leftover: string[] = [];
  const seenLeftover = new Set<string>();
  let out = "";
  let cursor = 0;
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(doc))) {
    const raw = m[1];
    if (raw === undefined) continue; // regex guarantees this group when the overall match succeeds
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;
    const startLineIdx = lineIndexForOffset(lines, matchStart);

    out += doc.slice(cursor, matchStart);
    if (isDecorative(lines, startLineIdx, matchStart, matchEnd, spans)) {
      out += m[0];
    } else {
      const name = normalizeMarkerName(raw);
      const value = fills[name];
      if (value !== undefined) {
        out += value;
      } else {
        out += m[0];
        if (!seenLeftover.has(name)) {
          seenLeftover.add(name);
          leftover.push(name);
        }
      }
    }
    cursor = matchEnd;
  }
  out += doc.slice(cursor);
  return { text: out, leftover };
}

export function assembleBrief(inputs: BriefInputs): BriefResult {
  const template = stripAuthorNotes(inputs.template, "template");
  if (!template.ok) {
    return { ok: false, error: template.error };
  }

  const resolved = resolveMethodBody(inputs.method);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }
  const methodBody = stripAuthorNotes(resolved.body, "method", resolved.bodyLine);
  if (!methodBody.ok) {
    return { ok: false, error: methodBody.error };
  }

  const split = splitAroundMethod(template.text);
  if (!split.ok) {
    return { ok: false, error: split.error };
  }

  const merged: Record<string, string> = { name: inputs.job };
  for (const [key, value] of Object.entries(inputs.fills)) {
    merged[normalizeMarkerName(key)] = value;
  }

  // Each region gets its own decorative-span pass: a stray backtick/quote in
  // one can never desync marker detection in another.
  const beforeResult = substituteMarkers(split.before, merged);
  const methodResult = substituteMarkers(methodBody.text, merged);
  const afterResult = substituteMarkers(split.after, merged);

  const leftover: string[] = [];
  const seenLeftover = new Set<string>();
  for (const name of [...beforeResult.leftover, ...methodResult.leftover, ...afterResult.leftover]) {
    if (!seenLeftover.has(name)) {
      seenLeftover.add(name);
      leftover.push(name);
    }
  }
  if (leftover.length > 0) {
    return { ok: false, error: `unfilled markers: ${leftover.join(", ")}`, leftover };
  }

  const trimmedBody = methodResult.text.replace(/\s+$/, "");
  const separator = split.hasNext ? "\n\n" : "\n";
  return { ok: true, brief: beforeResult.text + trimmedBody + separator + afterResult.text };
}
