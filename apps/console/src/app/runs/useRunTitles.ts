import { useCallback, useMemo } from 'react';
import type { BranchEnrichment, RunSummary } from '@mattstack/rt-client';

import { enrichedRunTitle } from './derive/kind';
import { useRunsEnrich } from './useRuns';

export type TitleOf = (run: RunSummary, mrField?: string | null) => string;

/** A run's title from its ticket's title or the MR it reads, never its
    branch or id when either is known. */
export function useRunTitles(runs: RunSummary[]): TitleOf {
  const branches = useMemo(
    () =>
      runs.map(r => r.branch).filter((b): b is string => typeof b === 'string'),
    [runs]
  );
  const enrich = useRunsEnrich(branches).data as
    Record<string, BranchEnrichment> | undefined;
  return useCallback(
    (run, mrField) => {
      const e = run.branch ? enrich?.[run.branch] : undefined;
      return enrichedRunTitle(run, e, mrField);
    },
    [enrich]
  );
}
