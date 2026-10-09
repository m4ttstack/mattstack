import {
  Avatar,
  Badge,
  Button,
  Group,
  SearchableMenu,
  Text,
} from '@mattstack/app-kit/core';
import { Icon, Icons } from '@mattstack/app-kit/icons';

import classes from './SettingsContextBar.module.css';
import type { Viewer } from './useConsoleSettings';

type Role = Viewer['role'];

const ROLE_LABEL: Record<Exclude<Role, 'none'>, string> = {
  admin: 'org admin',
  owner: 'team owner',
  member: 'member',
  unknown: 'not connected',
};

export function RoleBadge({ role }: { role: Role }) {
  if (role === 'none') return null;
  // A neutral badge: the gold and purple pills beside it already mean the
  // org and the team.
  return (
    <Badge size="sm" radius="xl" tt="uppercase" variant="default">
      {ROLE_LABEL[role]}
    </Badge>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** You on the right: your name, then your role. With no forge user rt
    cannot tell who you are, so there is no name, only the badge. */
function Who({ viewer }: { viewer: Viewer }) {
  const label = viewer.name ?? viewer.username;
  return (
    <Group
      gap={8}
      wrap="nowrap"
      data-testid="settings-viewer"
      style={{ flex: 'none' }}
    >
      {label && (
        <Group gap={6} wrap="nowrap">
          <Icons.user size={14} />
          <Text fz={13} fw={500} style={{ whiteSpace: 'nowrap' }}>
            {label}
          </Text>
        </Group>
      )}
      <RoleBadge role={viewer.role} />
    </Group>
  );
}

type TeamItem = {
  name: string;
  own: boolean;
  owners: string[];
  selected: boolean;
};

/** Who to ask about a team's settings: its owners, by face and name. A
    span, since the menu sets the line inside a paragraph. */
function OwnersLine({ item }: { item: TeamItem }) {
  return (
    <Group component="span" gap={6} wrap="nowrap" mt={2}>
      {item.owners.length === 0 ? (
        <Text span fz={12} fs="italic" c="dimmed">
          no owner yet
        </Text>
      ) : (
        <>
          <Group component="span" gap={2} wrap="nowrap">
            {item.owners.slice(0, 3).map(name => (
              <Avatar
                key={name}
                size={18}
                radius="xl"
                color="cyan"
                variant={item.selected ? 'white' : 'light'}
                fz={9}
              >
                {initials(name)}
              </Avatar>
            ))}
          </Group>
          <Text span fz={12}>
            {item.owners.join(', ')}
          </Text>
          <Text span fz={12} c="dimmed">
            {item.owners.length === 1 ? 'owner' : 'owners'}
          </Text>
        </>
      )}
    </Group>
  );
}

function TeamMenu({
  teams,
  owners,
  ownTeam,
  team,
  onPick,
}: {
  teams: string[];
  owners: Record<string, string[]>;
  ownTeam: string | null;
  team: string | null;
  onPick: (team: string | null) => void;
}) {
  const items: TeamItem[] = teams.map(t => ({
    name: t,
    own: t === ownTeam,
    owners: owners[t] ?? [],
    selected: t === team,
  }));
  return (
    <SearchableMenu<TeamItem>
      menuTrigger={
        <Button
          size="compact-sm"
          radius="xl"
          variant="light"
          color="purple"
          className={classes.trigger}
          aria-label={team ? `team: ${team}, switch team` : 'pick a team'}
          leftSection={<Icon name="team" size={14} />}
          rightSection={<Icons.chevronsUpDown size={14} />}
        >
          {team ?? 'Pick a team'}
        </Button>
      }
      items={items}
      title="Teams"
      titleIcon={<Icon name="team" size={14} />}
      itemTitle={item => item.name}
      itemSubtitle={item => <OwnersLine item={item} />}
      itemTitleSuffix={item =>
        item.own ? (
          <Badge
            size="xs"
            radius="xl"
            color="cyan"
            variant={item.selected ? 'white' : 'light'}
          >
            your team
          </Badge>
        ) : null
      }
      isSelectedItem={item => item.name === team}
      showItemBadge={item => item.name === team}
      itemBadgeText="Selected"
      itemBadgeColor={() => 'purple'}
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
  if (!viewer || viewer.role === 'none' || !org)
    return viewer ? <Who viewer={viewer} /> : null;
  // An admin on no team of their own still reaches every team through the
  // menu, so it shows whenever there is a team to open.
  const canSwitch =
    viewer.teams.length > 1 || (!team && viewer.teams.length > 0);
  return (
    <Group justify="space-between" wrap="nowrap" w="100%" gap={16}>
      <Group gap={10} wrap="nowrap" miw={0}>
        {/* The org in its scope's gold, the same as its org badges. */}
        <Badge
          size="md"
          h={22}
          color="gold"
          variant="light"
          tt="none"
          fw={500}
          leftSection={<Icon name="building" size={13} />}
          style={{ flex: 'none' }}
        >
          {org}
        </Badge>
        {(team || canSwitch) && (
          <>
            <Text fz={16} c="var(--tk-text-4)" aria-hidden>
              /
            </Text>
            {canSwitch ? (
              <TeamMenu
                teams={viewer.teams}
                owners={viewer.owners ?? {}}
                ownTeam={ownTeam}
                team={team}
                onPick={onPickTeam}
              />
            ) : (
              <Group gap={7} h={32} wrap="nowrap">
                <Icon name="team" size={14} />
                <Text fz={14} fw={500}>
                  {team}
                </Text>
              </Group>
            )}
          </>
        )}
        {other && ownTeam && (
          <Button
            size="compact-sm"
            radius="xl"
            variant="default"
            leftSection={<Icons.arrowLeft size={13} />}
            aria-label={`back to your team, ${ownTeam}`}
            onClick={() => onPickTeam(null)}
            style={{ flex: 'none' }}
          >
            {`Back to ${ownTeam}`}
          </Button>
        )}
      </Group>
      <Who viewer={viewer} />
    </Group>
  );
}
