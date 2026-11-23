import { Badge, Group, Loader, Text, Tooltip } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { useSettingsSyncContext } from './SettingsSyncProvider';
import { STUCK_COPY } from './syncCopy';
import {
  useSettingsOrg,
  useSettingsTeam,
  useSettingsViewTeam,
} from './useConsoleSettings';
import type { FollowUp } from './useSettingsSync';

/** What happened to a shared save after it landed: pushing, pushed, or why not. */
export function SyncNote({ followUp }: { followUp: FollowUp | null }) {
  const org = useSettingsOrg();
  if (followUp === null || followUp === 'saved') return null;
  if (followUp === 'pushing')
    return (
      <Group gap={6} wrap="nowrap" data-testid="sync-note">
        <Loader size={10} />
        <Text fz={12} c="dimmed">
          Saved · pushing to {org}…
        </Text>
      </Group>
    );
  if (followUp === 'pushed')
    return (
      <Group gap={6} wrap="nowrap" data-testid="sync-note">
        <Icon name="cloudCheck" size={12} color="var(--tk-text-ok-vivid)" />
        <Text fz={12} c="var(--tk-text-ok-small)">
          Pushed to {org} · teammates get it within a few minutes
        </Text>
      </Group>
    );
  return (
    <Group gap={6} wrap="nowrap" data-testid="sync-note">
      <Icon name="warning" size={12} color="var(--tk-text-warn-vivid)" />
      <Text fz={12} c="var(--tk-text-warn-small)">
        {'Saved on this Mac, not pushed: '}
        {STUCK_COPY[followUp.stuck].why}
      </Text>
    </Group>
  );
}

/** A row whose org or team value has not reached the org yet. */
export function NotPushedMark({ settingKey }: { settingKey: string }) {
  const sync = useSettingsSyncContext();
  const org = useSettingsOrg();
  const viewTeam = useSettingsViewTeam();
  const ownTeam = useSettingsTeam();
  const team = viewTeam ?? ownTeam;
  const waiting = sync?.orgs
    .find(o => o.org === org)
    ?.pending.some(
      e =>
        'key' in e &&
        e.key === settingKey &&
        (e.store === 'org' || e.store === `team:${team}`)
    );
  if (!waiting) return null;
  return (
    <Tooltip label={`Saved on this Mac. It reaches ${org} with the next push.`}>
      <Badge
        size="sm"
        radius="xl"
        variant="tint"
        color="warn"
        leftSection={<Icon name="arrowUpFromLine" size={10} />}
        data-testid="not-pushed"
      >
        not pushed
      </Badge>
    </Tooltip>
  );
}
