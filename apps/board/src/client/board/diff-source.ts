import { createContext, useContext, useEffect, useState } from 'react';

/** One file's changes in an MR, as the forge reports them. */
export interface FileDiff {
  /** The file's path on the MR's new side. */
  path: string;
  /** The forge's unified patch for this one file: GitLab's MR diffs `diff`
      or GitHub's PR files `patch`. Both arrive as hunks with no file
      headers; `filePatch` adds them. */
  patch: string;
  forge: 'gitlab' | 'github';
  /** The file in the MR on the forge. */
  webUrl?: string;
}

/** Where the review sheet gets a file's diff. */
export interface DiffSource {
  /** Null when the forge has no diff for the file, or none can be fetched. */
  fetchFileDiff(req: { mr: string; file: string }): Promise<FileDiff | null>;
}

/** The board's source until its server serves MR diffs: no file has a
    diff, so a finding's code section shows only the file's header. */
export const noDiffSource: DiffSource = {
  fetchFileDiff: async () => null,
};

export const DiffSourceContext = createContext<DiffSource>(noDiffSource);

/** The line a finding is anchored to, off its `file:line`. */
export function anchorLine(file: string): number | undefined {
  const m = /:(\d+)$/.exec(file);
  return m ? Number(m[1]) : undefined;
}

/** The path a finding's `file:line` names. */
export function anchorPath(file: string): string {
  return file.replace(/:\d+$/, '');
}

/** The patch with its file headers, as a diff renderer parses it. */
export function filePatch(diff: FileDiff): string {
  if (/^(---|diff --git) /m.test(diff.patch.split('@@')[0] ?? ''))
    return diff.patch;
  return `--- a/${diff.path}\n+++ b/${diff.path}\n${diff.patch}`;
}

interface Hunk {
  oldStart: number;
  newStart: number;
  lines: Array<{ text: string; old?: number; new?: number }>;
}

function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const text of patch.split('\n')) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (head) {
      oldNo = Number(head[1]);
      newNo = Number(head[2]);
      hunk = { oldStart: oldNo, newStart: newNo, lines: [] };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const sign = text[0];
    if (sign === '+') hunk.lines.push({ text, new: newNo++ });
    else if (sign === '-') hunk.lines.push({ text, old: oldNo++ });
    else if (sign === ' ') hunk.lines.push({ text, old: oldNo++, new: newNo++ });
  }
  return hunks;
}

/** The anchor's hunk cut down to `context` diff lines either side of the
    anchor (a new-side line), as a one-hunk patch with file headers. Null
    when no hunk holds the anchor. */
export function windowPatch(
  diff: FileDiff,
  line: number,
  context = 3
): string | null {
  for (const hunk of parseHunks(diff.patch)) {
    const at = hunk.lines.findIndex(l => l.new === line);
    if (at < 0) continue;
    const kept = hunk.lines.slice(Math.max(0, at - context), at + context + 1);
    const olds = kept.filter(l => l.old !== undefined);
    const news = kept.filter(l => l.new !== undefined);
    const oldStart = olds[0]?.old ?? hunk.oldStart;
    const newStart = news[0]?.new ?? hunk.newStart;
    const header = `@@ -${oldStart},${olds.length} +${newStart},${news.length} @@`;
    return [
      `--- a/${diff.path}`,
      `+++ b/${diff.path}`,
      header,
      ...kept.map(l => l.text),
      '',
    ].join('\n');
  }
  return null;
}

export function diffStats(diff: FileDiff): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const hunk of parseHunks(diff.patch))
    for (const l of hunk.lines) {
      if (l.old === undefined) additions++;
      else if (l.new === undefined) deletions++;
    }
  return { additions, deletions };
}

type DiffState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; diff: FileDiff };

/** One fetch per file per source, shared by every finding on that file. */
const fetched = new WeakMap<DiffSource, Map<string, Promise<FileDiff | null>>>();

function fetchOnce(
  source: DiffSource,
  mr: string,
  file: string
): Promise<FileDiff | null> {
  let bySource = fetched.get(source);
  if (!bySource) fetched.set(source, (bySource = new Map()));
  const key = `${mr}\n${file}`;
  let p = bySource.get(key);
  if (!p) {
    p = source.fetchFileDiff({ mr, file }).catch(() => null);
    bySource.set(key, p);
  }
  return p;
}

/** A file's diff from the sheet's source, or `none` with no MR to ask. */
export function useFileDiff(mr: string | undefined, file: string): DiffState {
  const source = useContext(DiffSourceContext);
  const [state, setState] = useState<DiffState>({ status: 'loading' });
  useEffect(() => {
    if (!mr) {
      setState({ status: 'none' });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    void fetchOnce(source, mr, file).then(diff => {
      if (live) setState(diff ? { status: 'ready', diff } : { status: 'none' });
    });
    return () => {
      live = false;
    };
  }, [source, mr, file]);
  return state;
}
