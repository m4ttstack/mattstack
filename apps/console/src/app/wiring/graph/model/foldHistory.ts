export type HistoryRow<C> =
  { kind: 'commit'; commit: C } | { kind: 'fold'; commits: C[] };

/** Each run of two or more consecutive version-only commits becomes one
    fold, in log order; every other commit stays its own row. */
export function foldVersionOnly<
  C extends { sha: string; versionOnly: boolean },
>(commits: C[]): HistoryRow<C>[] {
  const rows: HistoryRow<C>[] = [];
  let run: C[] = [];
  const flush = () => {
    if (run.length > 1) rows.push({ kind: 'fold', commits: run });
    else if (run.length === 1) rows.push({ kind: 'commit', commit: run[0]! });
    run = [];
  };
  for (const commit of commits) {
    if (commit.versionOnly) {
      run.push(commit);
      continue;
    }
    flush();
    rows.push({ kind: 'commit', commit });
  }
  flush();
  return rows;
}
