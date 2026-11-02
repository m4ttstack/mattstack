export const DIRECT_ONLY_MARK = "# rt: direct-only";
export const DIRECT_ONLY_MARK_WAS_FALSE = "# rt: direct-only (was false)";

const KEY_LINE = /^disable-model-invocation:[ \t]*(\S+)[ \t]*(#.*?)?[ \t]*$/;

interface Frontmatter {
  lines: string[];
  open: number;
  close: number;
  eol: string;
}

// Lines keep their terminators so every byte outside the edited line survives.
function parse(md: string): Frontmatter | null {
  const lines = md.split(/(?<=\n)/);
  if (lines.length === 0 || !/^---[ \t]*\r?\n$/.test(lines[0]!)) return null;
  const eol = lines[0]!.endsWith("\r\n") ? "\r\n" : "\n";
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*\r?\n?$/.test(lines[i]!)) return { lines, open: 0, close: i, eol };
  }
  return null;
}

function keyIndex(fm: Frontmatter): number {
  for (let i = fm.open + 1; i < fm.close; i++) {
    if (KEY_LINE.test(fm.lines[i]!.replace(/\r?\n$/, ""))) return i;
  }
  return -1;
}

function parts(line: string): { value: string; comment: string | undefined; eol: string } {
  const eol = /\r?\n$/.exec(line)?.[0] ?? "";
  const m = KEY_LINE.exec(line.slice(0, line.length - eol.length))!;
  return { value: m[1]!, comment: m[2], eol };
}

export function addDirectOnly(md: string): string | null {
  const fm = parse(md);
  if (!fm) return null;
  const idx = keyIndex(fm);
  if (idx >= 0) {
    const { value, comment, eol } = parts(fm.lines[idx]!);
    if (comment?.startsWith(DIRECT_ONLY_MARK) || value === "true") return md;
    if (value !== "false") return md;
    fm.lines[idx] = `disable-model-invocation: true ${DIRECT_ONLY_MARK_WAS_FALSE}${eol}`;
    return fm.lines.join("");
  }
  const prev = fm.lines[fm.close - 1]!;
  if (!/\n$/.test(prev)) fm.lines[fm.close - 1] = prev + fm.eol;
  fm.lines.splice(fm.close, 0, `disable-model-invocation: true ${DIRECT_ONLY_MARK}${fm.eol}`);
  return fm.lines.join("");
}

export function removeDirectOnly(md: string): string {
  const fm = parse(md);
  if (!fm) return md;
  const idx = keyIndex(fm);
  if (idx < 0) return md;
  const { value, comment, eol } = parts(fm.lines[idx]!);
  if (value !== "true" || !comment) return md;
  if (comment === DIRECT_ONLY_MARK_WAS_FALSE) {
    fm.lines[idx] = `disable-model-invocation: false${eol}`;
  } else if (comment === DIRECT_ONLY_MARK) {
    fm.lines.splice(idx, 1);
  } else {
    return md;
  }
  return fm.lines.join("");
}

export function sourceSetsDirectOnly(md: string): boolean {
  const fm = parse(md);
  if (!fm) return false;
  const idx = keyIndex(fm);
  if (idx < 0) return false;
  const { value, comment } = parts(fm.lines[idx]!);
  return value === "true" && !comment?.startsWith(DIRECT_ONLY_MARK);
}
