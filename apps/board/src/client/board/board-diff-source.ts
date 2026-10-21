import type { DiffSource } from './diff-source.ts';

/** The live board's diff source. The renderer loads as code-split chunks
    the first time a code section or a Preview code fence draws. */
export const boardDiffSource: DiffSource = {
  fetchFileDiff: async () => null,
  loadView: () => import('./DiffView.tsx'),
};
