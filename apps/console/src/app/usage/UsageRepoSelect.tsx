import { useMemo } from 'react';
import { MattstackShell } from '@mattstack/app-kit/app';
import { Select } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { repoPath } from '../runs/repoLabel';
import { mrParts } from './format';
import { useUsageMrs, type UsageRange } from './useUsage';

const ALL_REPOS = '';

/** The repo picker in the app bar, listing the repos that have usage. */
export function UsageRepoSelect({
  value,
  onChange,
  range = null,
}: {
  value: string | null;
  onChange: (repo: string | null) => void;
  range?: UsageRange;
}) {
  const everyRepo = useUsageMrs(range);
  const repos = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of everyRepo.data?.mrs ?? []) {
      const { repoKey, repo } = mrParts(row.mrKey);
      seen.set(repoKey, repo);
    }
    if (value && !seen.has(value)) seen.set(value, repoPath(value));
    return [...seen].map(([key, label]) => ({ value: key, label }));
  }, [everyRepo.data, value]);
  return (
    <MattstackShell.AppBar>
      <Select
        aria-label="repo"
        w={200}
        size="xs"
        leftSection={<Icon name="gitBranch" size={14} />}
        value={value ?? ALL_REPOS}
        data={[{ value: ALL_REPOS, label: 'all repos' }, ...repos]}
        onChange={v => onChange(v ? v : null)}
      />
    </MattstackShell.AppBar>
  );
}
