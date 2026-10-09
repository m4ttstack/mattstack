import { useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Combobox,
  Group,
  Text,
  UnstyledButton,
  useCombobox,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icon, Icons } from '@mattstack/app-kit/icons';

import classes from './SettingsContextBar.module.css';
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

const ROLE_NOTE: Partial<Record<Role, string>> = {
  admin: 'As an org admin you can edit every team.',
  owner: 'You can edit the teams you own.',
};

export function RoleBadge({ role }: { role: Role }) {
  if (role === 'none') return null;
  const { label, color, variant } = ROLE_BADGE[role];
  return (
    <Badge size="sm" radius="xl" color={color} variant={variant}>
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
    <Group gap={10} wrap="nowrap" data-testid="settings-viewer">
      {label && (
        <Text fz={13} fw={500}>
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

function TeamMenu({
  teams,
  ownTeam,
  team,
  role,
  other,
  onPick,
}: {
  teams: string[];
  ownTeam: string | null;
  team: string;
  role: Role;
  other: boolean;
  onPick: (team: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch('');
    },
    onDropdownOpen: () => combobox.focusSearchInput(),
  });
  const shown = teams.filter(t =>
    t.toLowerCase().includes(search.trim().toLowerCase())
  );
  const note = ROLE_NOTE[role];
  return (
    <Combobox
      store={combobox}
      width={280}
      position="bottom-start"
      offset={6}
      onOptionSubmit={value => {
        onPick(value === ownTeam ? null : value);
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target withAriaAttributes={false}>
        <UnstyledButton
          className={classes.segment}
          data-other={other || undefined}
          aria-label={`team: ${team}, switch team`}
          onClick={() => combobox.toggleDropdown()}
        >
          <Icons.users size={15} />
          <span>{team}</span>
          <Icons.chevronsUpDown size={14} className={classes.chevrons} />
        </UnstyledButton>
      </Combobox.Target>
      <Combobox.Dropdown p={0}>
        <Combobox.Search
          value={search}
          onChange={e => setSearch(e.currentTarget.value)}
          placeholder="Find team…"
          leftSection={<Icons.search size={14} />}
          aria-label="find team"
        />
        <Combobox.Options p={4}>
          {shown.length === 0 ? (
            <Combobox.Empty>No team matches</Combobox.Empty>
          ) : (
            shown.map(t => (
              <Combobox.Option value={t} key={t} active={t === team}>
                <Group gap={8} wrap="nowrap">
                  <Text fz={14}>{t}</Text>
                  {t === ownTeam && (
                    <Badge size="xs" radius="xl" color="gray" variant="outline">
                      your team
                    </Badge>
                  )}
                  {t === team && (
                    <Icons.check size={15} style={{ marginLeft: 'auto' }} />
                  )}
                </Group>
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
        {note && (
          <Combobox.Footer>
            <Group gap={6} wrap="nowrap">
              <Icons.shield size={13} />
              <Text fz={12} c="dimmed">
                {note}
              </Text>
            </Group>
          </Combobox.Footer>
        )}
      </Combobox.Dropdown>
    </Combobox>
  );
}

/** Where you are (org, team) and who you are. Viewing another team turns
    the team segment purple and adds a note with the way back. */
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
                role={viewer.role}
                other={other}
                onPick={onPickTeam}
              />
            ) : (
              <Group gap={7} wrap="nowrap" className={classes.fixedTeam}>
                <Icons.users size={15} />
                <Text fz={14} fw={500}>
                  {team}
                </Text>
              </Group>
            )}
          </>
        )}
        {other && team && ownTeam && (
          <Group gap={10} wrap="nowrap" miw={0} data-testid="viewing-note">
            <Group gap={5} wrap="nowrap" miw={0}>
              <Icons.eye
                size={14}
                color="var(--tk-text-purple-small)"
                style={{ flex: 'none' }}
              />
              <Text fz={12} c={text.muted} truncate="end">
                {`Edits go to ${team} · your user and machine layers are hidden`}
              </Text>
            </Group>
            <Button
              size="compact-sm"
              variant="default"
              leftSection={<Icons.arrowLeft size={13} />}
              onClick={() => onPickTeam(null)}
            >
              {`Back to ${ownTeam}`}
            </Button>
          </Group>
        )}
      </Group>
      <Who viewer={viewer} />
    </Group>
  );
}
