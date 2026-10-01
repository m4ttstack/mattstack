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
