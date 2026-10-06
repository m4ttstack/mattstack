import { useEffect, useState } from 'react';
import { Group, SegmentedControl, Stack, Text } from '@mattstack/app-kit/core';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import type { useRowSave } from './useRowSave';

type Row = ReturnType<typeof useRowSave>;
type Role = 'team' | 'self';
type Roles = Record<string, Role>;
interface RolesInfo {
  members: { username: string; name: string | null }[];
  access: 'owner' | 'member' | 'no-team';
  self: string | null;
}

export const ROLES_KEY = 'boxscore.roles';

const NOTE: Record<Exclude<RolesInfo['access'], 'owner'>, string> = {
  member: 'Only the team owner can change roles.',
  'no-team': 'Roles live in team settings, and this Mac has no team.',
};

let pending: Promise<RolesInfo | null> | null = null;

/** The row's summary and body mount together; one read serves both. */
function readRolesInfo(): Promise<RolesInfo | null> {
  pending ??= fetch('/api/settings/boxscore-roles')
    .then(r => (r.ok ? (r.json() as Promise<RolesInfo>) : null))
    .catch(() => null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** The roster and this Mac's access; null while loading or when the read fails. */
function useRolesInfo(): RolesInfo | null {
  const [info, setInfo] = useState<RolesInfo | null>(null);
  useEffect(() => {
    let live = true;
    void readRolesInfo().then(v => live && setInfo(v));
    return () => {
      live = false;
    };
  }, []);
  return info;
}

function storedRoles(def: SettingDefWire): Roles {
  return (def.effective.value ?? {}) as Roles;
}

function variants(stored: Roles, u: string): string[] {
  return Object.keys(stored).filter(k => k.toLowerCase() === u.toLowerCase());
}

/** Team only when every case variant of the username says team. */
function roleOf(stored: Roles, u: string): Role {
  const keys = variants(stored, u);
  return keys.length > 0 && keys.every(k => stored[k] === 'team')
    ? 'team'
    : 'self';
}

const ROLE_DATA = [
  { value: 'team', label: 'Team' },
  { value: 'self', label: 'Self' },
];

/** "N of M on Team view" over the roster, or `fallback` until it loads. */
export function useRolesSummary(def: SettingDefWire, fallback: string): string {
  const info = useRolesInfo();
  if (!info) return fallback;
  const stored = storedRoles(def);
  const team = info.members.filter(
    m => roleOf(stored, m.username) === 'team'
  ).length;
  return `${team} of ${info.members.length} on Team view`;
}

export function BoxscoreRolesBody({
  def,
  row,
}: {
  def: SettingDefWire;
  row: Row;
}) {
  const info = useRolesInfo();
  const stored = storedRoles(def);
  const editable = info?.access === 'owner' && row.status !== 'saving';
  const isOwnerRow = (u: string) => info?.access === 'owner' && info.self === u;
  const saveRole = (u: string, v: Role) => {
    const drop = new Set(variants(stored, u));
    const kept = Object.fromEntries(
      Object.entries(stored).filter(([k]) => !drop.has(k))
    );
    void row.save({ ...kept, [u]: v });
  };

  return (
    <Stack gap={8} py={8}>
      <Text fz={12} c="dimmed">
        Team view sees everyone&apos;s stats. Self view sees only their own
        page. This is a courtesy: each member&apos;s boxscore runs on their own
        Mac.
      </Text>
      {info && info.access !== 'owner' && (
        <Text fz={12} c="dimmed">
          {NOTE[info.access]}
        </Text>
      )}
      {info?.members.map(m => {
        const owner = isOwnerRow(m.username);
        return (
          <Group key={m.username} gap={12} wrap="nowrap">
            <Text fz={13} w={240} truncate="end">
              {m.name ?? m.username}
            </Text>
            <SegmentedControl
              size="xs"
              aria-label={`Role for ${m.username}`}
              disabled={!editable || owner}
              value={owner ? 'team' : roleOf(stored, m.username)}
              data={ROLE_DATA}
              onChange={v => saveRole(m.username, v as Role)}
            />
            {owner && (
              <Text fz={11} c="dimmed">
                owner
              </Text>
            )}
          </Group>
        );
      })}
    </Stack>
  );
}
