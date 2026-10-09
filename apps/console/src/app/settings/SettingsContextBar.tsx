import {
  Avatar,
  Badge,
  Button,
  Group,
  SearchableMenu,
  Text,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icon, Icons } from '@mattstack/app-kit/icons';

import type { Viewer } from './useConsoleSettings';

type Role = Viewer['role'];

const ROLE_BADGE: Record<
  Exclude<Role, 'none'>,
  { label: string; color: string; variant: 'light' | 'outline' }
> = {
  admin: { label: 'org admin', color: 'gold', variant: 'light' },
  owner: { label: 'team owner', color: 'purple', variant: 'light' },
  member: { label: 'member', color: 'gray', variant: 'outline' },
  unknown: { label: 'not connected', color: 'gray', variant: 'light' },
};

export function RoleBadge({ role }: { role: Role }) {
  if (role === 'none') return null;
  const { label, color, variant } = ROLE_BADGE[role];
  return (
    <Badge size="sm" radius="xl" tt="uppercase" color={color} variant={variant}>
      {label}
    </Badge>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** You on the right: name, role badge, avatar. With no forge user rt cannot
    tell who you are, so there is no name, only the badge. */
function Who({ viewer }: { viewer: Viewer }) {
  const label = viewer.name ?? viewer.username;
  return (
    <Group
      gap={10}
      wrap="nowrap"
      data-testid="settings-viewer"
      style={{ flex: 'none' }}
    >
      {label && (
        <Text fz={13} fw={500} style={{ whiteSpace: 'nowrap' }}>
          {label}
        </Text>
      )}
      <RoleBadge role={viewer.role} />
      <Avatar size={30} radius="xl" color="cyan" variant="light">
        {label ? initials(label) : <Icons.user size={15} />}
      </Avatar>
    </Group>
  );
}

type TeamItem = { name: string; own: boolean };

function TeamMenu({
  teams,
  ownTeam,
  team,
  other,
  onPick,
}: {
  teams: string[];
  ownTeam: string | null;
  team: string;
  other: boolean;
  onPick: (team: string | null) => void;
}) {
  const items: TeamItem[] = teams.map(t => ({ name: t, own: t === ownTeam }));
  return (
    <SearchableMenu<TeamItem>
      menuTrigger={
        <Button
          size="sm"
          variant={other ? 'light' : 'default'}
          color={other ? 'purple' : undefined}
          aria-label={`team: ${team}, switch team`}
          leftSection={<Icons.users size={15} />}
          rightSection={<Icons.chevronsUpDown size={14} />}
        >
          {team}
        </Button>
      }
      items={items}
      title="Teams"
      titleIcon={<Icons.users size={14} />}
      itemTitle={item => item.name}
      itemSubtitle={item => (item.own ? 'your team' : 'shared team settings')}
      isSelectedItem={item => item.name === team}
      showItemBadge={item => item.name === team}
      itemBadgeText="Selected"
      onItemClick={item => onPick(item.own ? null : item.name)}
      filterPlaceholder={() => 'Find team…'}
      emptyMessage="No team matches"
      position="bottom-start"
    />
  );
}

/** Where you are (org, team) and who you are. Viewing another team turns
    the team segment purple and offers the way back to your own. */
export function SettingsContextBar({
  org,
  team,
  ownTeam,
  viewer,
  other,
  onPickTeam,
}: {
  org: string | null;
  team: string | null;
  ownTeam: string | null;
  viewer: Viewer | null;
  other: boolean;
  onPickTeam: (team: string | null) => void;
}) {
  const { text } = useSchemeColors();
  if (!viewer || viewer.role === 'none' || !org)
    return viewer ? <Who viewer={viewer} /> : null;
  const canSwitch = viewer.teams.length > 1;
  return (
    <Group justify="space-between" wrap="nowrap" w="100%" gap={16}>
      <Group gap={10} wrap="nowrap" miw={0}>
        <Group gap={8} wrap="nowrap" c={text.muted}>
          <Icon name="building" size={15} />
          <Text fz={14} c={text.muted}>
            {org}
          </Text>
        </Group>
        {team && (
          <>
            <Text fz={16} c="var(--tk-text-4)" aria-hidden>
              /
            </Text>
            {canSwitch ? (
              <TeamMenu
                teams={viewer.teams}
                ownTeam={ownTeam}
                team={team}
                other={other}
                onPick={onPickTeam}
              />
            ) : (
              <Group gap={7} h={32} wrap="nowrap">
                <Icons.users size={15} />
                <Text fz={14} fw={500}>
                  {team}
                </Text>
              </Group>
            )}
          </>
        )}
        {other && ownTeam && (
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            leftSection={<Icons.arrowLeft size={13} />}
            onClick={() => onPickTeam(null)}
            style={{ flex: 'none' }}
          >
            {`Back to your team (${ownTeam})`}
          </Button>
        )}
      </Group>
      <Who viewer={viewer} />
    </Group>
  );
}
