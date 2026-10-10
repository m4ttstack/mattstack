import { forwardRef, useEffect, useState, type ReactNode } from 'react';

import {
  Avatar,
  Badge,
  Button,
  Group,
  SearchableMenu,
  Text,
} from '@mattstack/app-kit/core';
import { Icon, Icons } from '@mattstack/app-kit/icons';
import { MattstackShell } from '../MattstackShell';
import classes from './Scope.module.css';

/** Who rt says you are, as an app's `/api/settings/viewer` answers it. */
export interface Viewer {
  username: string | null;
  name: string | null;
  role: 'admin' | 'owner' | 'member' | 'unknown' | 'none';
  team: string | null;
  teams: string[];
  /** Each reachable team's owners, by roster name. */
  owners?: Record<string, string[]>;
}

export interface ViewerInfo {
  org: string | null;
  activeTeam: string | null;
  viewer: Viewer | null;
}

/**
 * Who you are and your org and team, read once from the app's
 * `/api/settings/viewer` (settings-kit's route). `undefined` until it
 * answers, `null` when it cannot.
 */
export function useViewer(
  url = '/api/settings/viewer'
): ViewerInfo | null | undefined {
  const [info, setInfo] = useState<ViewerInfo | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then(res => (res.ok ? (res.json() as Promise<ViewerInfo>) : null))
      .then(body => alive && setInfo(body))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return info;
}

const ROLE_LABEL: Record<Exclude<Viewer['role'], 'none'>, string> = {
  admin: 'org admin',
  owner: 'team owner',
  member: 'member',
  unknown: 'not connected',
};

export function RoleBadge({ role }: { role: Viewer['role'] }) {
  if (role === 'none') return null;
  // A neutral badge: the gold and purple pills beside it already mean the
  // org and the team.
  return (
    <Badge size="sm" radius="xl" tt="uppercase" variant="default">
      {ROLE_LABEL[role]}
    </Badge>
  );
}

/** You: your name, then your role. With no forge user rt cannot tell who
    you are, so there is no name, only the badge. */
export function Who({ viewer }: { viewer: Viewer }) {
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

/** The org in its scope's gold, drawn as the scope menus' twin. Inert (a
    span) until there is more than one org to switch to. */
export function OrgPill({ org }: { org: string }) {
  return (
    <Button
      component="span"
      size="compact-sm"
      radius="xl"
      variant="hue-outline"
      color="gold"
      leftSection={<Icon name="building" size={14} />}
      style={{ flex: 'none', cursor: 'default' }}
      data-testid="org-scope"
    >
      {org}
    </Button>
  );
}

/** A team in its scope's purple, inert: where the app does not switch
    teams, it only says which one you are on. */
export function TeamPill({ team }: { team: string }) {
  return (
    <Button
      component="span"
      size="compact-sm"
      radius="xl"
      variant="hue-outline"
      color="purple"
      leftSection={<Icon name="team" size={14} />}
      style={{ flex: 'none', cursor: 'default' }}
      data-testid="team-scope"
    >
      {team}
    </Button>
  );
}

/** The rule between two scopes: org / team. */
export function ScopeSlash() {
  return (
    <Text fz={16} c="var(--tk-text-4)" aria-hidden>
      /
    </Text>
  );
}

/** A scope menu's trigger: a purple pill naming what is picked. A
    SearchableMenu hands it the ref and the open state. */
export const ScopeTrigger = forwardRef<
  HTMLButtonElement,
  { icon: ReactNode; label: string; 'aria-label': string }
>(function ScopeTrigger({ icon, label, ...rest }, ref) {
  return (
    <Button
      ref={ref}
      size="compact-sm"
      radius="xl"
      variant="hue-outline"
      color="purple"
      className={classes.trigger}
      leftSection={icon}
      rightSection={<Icons.chevronsUpDown size={14} />}
      {...rest}
    >
      {label}
    </Button>
  );
});

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export type TeamItem = {
  name: string;
  own: boolean;
  owners: string[];
  selected: boolean;
};

/** Who to ask about a team: its owners, by face and name. A span, since
    the menu sets the line inside a paragraph. */
export function OwnersLine({ item }: { item: TeamItem }) {
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

/** The team picker: a purple scope pill opening a searchable menu of
    teams with their owners. Picking your own team answers null. */
export function TeamMenu({
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
        <ScopeTrigger
          icon={<Icon name="team" size={14} />}
          label={team ?? 'Pick a team'}
          aria-label={team ? `team: ${team}, switch team` : 'pick a team'}
        />
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

/** Who you are and your role, at the right end of the top bar. Draws
    nothing until rt answers. */
export function ViewerChip({ info }: { info: ViewerInfo | null | undefined }) {
  if (!info?.viewer) return null;
  return (
    <MattstackShell.AppBar side="end">
      <Who viewer={info.viewer} />
    </MattstackShell.AppBar>
  );
}

/** Your org and team in the top bar, read-only: for an app that does not
    switch teams. */
export function ScopeBar({ info }: { info: ViewerInfo | null | undefined }) {
  if (!info?.org) return null;
  const team = info.activeTeam ?? info.viewer?.team ?? null;
  return (
    <MattstackShell.AppBar>
      <Group gap={10} wrap="nowrap" miw={0}>
        <OrgPill org={info.org} />
        {team ? (
          <>
            <ScopeSlash />
            <TeamPill team={team} />
          </>
        ) : null}
      </Group>
    </MattstackShell.AppBar>
  );
}
