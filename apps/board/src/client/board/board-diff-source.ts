import type { DiffSource, FileDiff } from './diff-source.ts';

/** The live board's diff source: the board server's local-only
    `/review/file-diff`, and the renderer as code-split chunks loaded the
    first time a code section or a Preview code fence draws. A board read
    over the tunnel gets a 403 and shows file headers only. */
export const boardDiffSource: DiffSource = {
  async fetchFileDiff({ mr, file }) {
    const res = await fetch(
      `/review/file-diff?mr=${encodeURIComponent(mr)}&file=${encodeURIComponent(file)}`
    );
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      throw new Error(
        typeof body?.error === 'string'
          ? body.error
          : 'The diff could not be loaded.'
      );
    }
    return (await res.json()) as FileDiff;
  },
  loadView: () => import('./DiffView.tsx'),
};
