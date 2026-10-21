import {
  createContext,
  lazy,
  useContext,
  useEffect,
  useState,
  type LazyExoticComponent,
} from 'react';

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
  /** The forge holds the diff back (too large, or binary): there is no
      patch to draw, only the file to open on the forge. */
  tooLarge?: boolean;
  binary?: boolean;
}

/** Where the review sheet gets a file's diff, and the renderer that
    draws it. */
export interface DiffSource {
  /** Null when the forge has no diff for the file; rejects, with a short
      message for the person, when the diff could not be fetched. */
  fetchFileDiff(req: { mr: string; file: string }): Promise<FileDiff | null>;
  /** Loads the renderer: `() => import('./DiffView.tsx')`, a code-split
      chunk. A source without it shows file headers only. */
  loadView?: () => Promise<typeof import('./DiffView.tsx')>;
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

/** A hunk's blank context line as a bare empty line, the way a copy that
    strips trailing spaces leaves it, back to the single space it was. */
function restoreBlankContext(patch: string): string {
  const lines = patch.split('\n');
  let inHunk = false;
  return lines
    .map((text, i) => {
      if (text.startsWith('@@')) inHunk = true;
      else if (/^(---|\+\+\+|diff --git) /.test(text)) inHunk = false;
      return inHunk && text === '' && i < lines.length - 1 ? ' ' : text;
    })
    .join('\n');
}

/** The patch with its file headers, as a diff renderer parses it. */
export function filePatch(diff: FileDiff): string {
  const patch = restoreBlankContext(diff.patch);
  if (/^(---|diff --git) /m.test(patch.split('@@')[0] ?? '')) return patch;
  return `--- a/${diff.path}\n+++ b/${diff.path}\n${patch}`;
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
  for (const text of restoreBlankContext(patch).split('\n')) {
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
    else if (sign === ' ')
      hunk.lines.push({ text, old: oldNo++, new: newNo++ });
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
    const from = Math.max(0, at - context);
    const kept = hunk.lines.slice(from, at + context + 1);
    const before = hunk.lines.slice(0, from);
    const olds = kept.filter(l => l.old !== undefined);
    const news = kept.filter(l => l.new !== undefined);
    // A side with no lines in the window names the line it follows.
    const oldStart =
      olds[0]?.old ??
      before.findLast(l => l.old !== undefined)?.old ??
      hunk.oldStart - 1;
    const newStart =
      news[0]?.new ??
      before.findLast(l => l.new !== undefined)?.new ??
      hunk.newStart - 1;
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
  | { status: 'ready'; diff: FileDiff }
  | { status: 'error'; message: string };

type Fetched = { diff: FileDiff | null } | { error: string };

/** One fetch per file per source, shared by every finding on that file. */
const fetched = new WeakMap<DiffSource, Map<string, Promise<Fetched>>>();

function fetchOnce(
  source: DiffSource,
  mr: string,
  file: string
): Promise<Fetched> {
  let bySource = fetched.get(source);
  if (!bySource) fetched.set(source, (bySource = new Map()));
  const key = `${mr}\n${file}`;
  let p = bySource.get(key);
  if (!p) {
    p = source.fetchFileDiff({ mr, file }).then(
      diff => ({ diff }),
      (err: unknown) => {
        // A failed fetch is asked again the next time a card mounts.
        bySource.delete(key);
        return {
          error:
            err instanceof Error && err.message
              ? err.message
              : 'The diff could not be loaded.',
        };
      }
    );
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
    void fetchOnce(source, mr, file).then(got => {
      if (!live) return;
      if ('error' in got) setState({ status: 'error', message: got.error });
      else
        setState(
          got.diff ? { status: 'ready', diff: got.diff } : { status: 'none' }
        );
    });
    return () => {
      live = false;
    };
  }, [source, mr, file]);
  return state;
}

type DiffViewComponent = Awaited<
  ReturnType<NonNullable<DiffSource['loadView']>>
>['default'];

const views = new WeakMap<
  NonNullable<DiffSource['loadView']>,
  LazyExoticComponent<DiffViewComponent>
>();

/** The sheet's diff renderer, loaded on first render, or null when its
    source brings none. */
export function useDiffView(): LazyExoticComponent<DiffViewComponent> | null {
  const { loadView } = useContext(DiffSourceContext);
  if (!loadView) return null;
  let view = views.get(loadView);
  if (!view) views.set(loadView, (view = lazy(loadView)));
  return view;
}

type CodeBlockComponent = Awaited<
  ReturnType<NonNullable<DiffSource['loadView']>>
>['CodeBlock'];

const codeBlocks = new WeakMap<
  NonNullable<DiffSource['loadView']>,
  LazyExoticComponent<CodeBlockComponent>
>();

/** The highlighted code block from the same renderer module, for a
    comment's fenced code, or null when the source brings no renderer. */
export function useCodeBlock(): LazyExoticComponent<CodeBlockComponent> | null {
  const { loadView } = useContext(DiffSourceContext);
  if (!loadView) return null;
  let block = codeBlocks.get(loadView);
  if (!block)
    codeBlocks.set(
      loadView,
      (block = lazy(() => loadView().then(m => ({ default: m.CodeBlock }))))
    );
  return block;
}
