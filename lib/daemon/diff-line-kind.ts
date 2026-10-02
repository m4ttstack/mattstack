export type NewLineKind =
  | { kind: "added" }
  | { kind: "context"; oldLine: number }
  | { kind: "outside"; nearest: number[] };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NEAREST_COUNT = 3;

/**
 * Classifies a new-side line number against one file's unified diff. GitLab
 * anchors an added line on its new line alone, a context line on both its old
 * and new line, and refuses a line the diff does not show.
 */
export function classifyNewLine(diff: string, target: number): NewLineKind {
  const shown: number[] = [];
  let result: NewLineKind | undefined;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;

  for (const text of diff.split("\n")) {
    if (oldLeft <= 0 && newLeft <= 0) {
      const m = HUNK_HEADER.exec(text);
      if (!m) continue;
      oldLine = Number(m[1]);
      oldLeft = m[2] === undefined ? 1 : Number(m[2]);
      newLine = Number(m[3]);
      newLeft = m[4] === undefined ? 1 : Number(m[4]);
      continue;
    }
    const mark = text[0];
    if (mark === "\\") continue;
    if (mark === "+") {
      shown.push(newLine);
      if (newLine === target) result = { kind: "added" };
      newLine++;
      newLeft--;
    } else if (mark === "-") {
      oldLine++;
      oldLeft--;
    } else {
      shown.push(newLine);
      if (newLine === target) result = { kind: "context", oldLine };
      oldLine++;
      newLine++;
      oldLeft--;
      newLeft--;
    }
  }

  if (result) return result;
  const nearest = [...shown]
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)
    .slice(0, NEAREST_COUNT);
  return { kind: "outside", nearest };
}

export interface DiffFileRow {
  newPath: string;
  oldPath?: string;
  diff: string;
  collapsed?: boolean;
  tooLarge?: boolean;
}

export type AnchorCheck =
  | { kind: "anchorable"; oldPath?: string; oldLine?: number }
  | { kind: "outside"; nearest: number[] }
  | { kind: "no-file" };

/**
 * Checks a new-side `(path, line)` against one page of an MR's diffs. A file
 * GitLab did not render (collapsed, too large, empty) or one past a full page
 * cannot be checked, so it counts as anchorable and GitLab decides.
 */
export function checkAnchor(page: { diffs: DiffFileRow[]; truncated: boolean }, path: string, line: number): AnchorCheck {
  const file = page.diffs.find((d) => d.newPath === path);
  if (!file) return page.truncated ? { kind: "anchorable" } : { kind: "no-file" };
  const oldPath = file.oldPath || undefined;
  if (file.collapsed === true || file.tooLarge === true || file.diff === "") return { kind: "anchorable", oldPath };
  const kind = classifyNewLine(file.diff, line);
  if (kind.kind === "outside") return kind;
  return kind.kind === "context" ? { kind: "anchorable", oldPath, oldLine: kind.oldLine } : { kind: "anchorable", oldPath };
}
