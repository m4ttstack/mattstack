import { Text } from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import { useSettingsRepo } from './useConsoleSettings';
import { repoLabel } from './view';

/** What an edit of a per-project row reaches: the project it has picked,
    or with none picked, how many projects set the key. */
export function RepoReach({ def }: { def: SettingDefWire }) {
  const { text } = useSchemeColors();
  const repo = useSettingsRepo();
  if (!def.repoScoped) return null;
  let label: string;
  if (repo) label = `for ${repoLabel(repo)}`;
  else {
    const n = def.repos?.length ?? 0;
    label =
      n === 0
        ? 'per project'
        : `per project · set in ${n} ${n === 1 ? 'project' : 'projects'}`;
  }
  return (
    <Text fz={12} c={text.muted} style={{ whiteSpace: 'nowrap' }}>
      {label}
    </Text>
  );
}
