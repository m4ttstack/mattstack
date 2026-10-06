import { useEffect, useState } from 'react';
import { Group, SegmentedControl, Stack, Text } from '@mattstack/app-kit/core';
import type { SettingDefWire } from '@mattstack/settings-kit/react';

import type { useRowSave } from './useRowSave';

type Row = ReturnType<typeof useRowSave>;
type Role = 'team' | 'self';
interface RolesInfo {
  members: { username: string; name: string | null }[];
  access: 'owner' | 'member' | 'no-team';
}

export const ROLES_KEY = 'boxscore.roles';

const NOTE: Record<Exclude<RolesInfo['access'], 'owner'>, string> = {
  member: 'Only the team owner can change roles.',
  'no-team': 'Roles live in team settings, and this Mac has no team.',
};

export function BoxscoreRolesBody({
  def,
  row,
}: {
  def: SettingDefWire;
  row: Row;
}) {
  const [info, setInfo] = useState<RolesInfo | null>(null);
  useEffect(() => {
    let live = true;
    void fetch('/api/settings/boxscore-roles')
      .then(r => (r.ok ? (r.json() as Promise<RolesInfo>) : null))
      .catch(() => null)
      .then(v => live && setInfo(v));
    return () => {
      live = false;
    };
  }, []);

  const stored = (def.effective.value ?? {}) as Record<string, Role>;
  const editable = info?.access === 'owner' && row.status !== 'saving';
  const variants = (u: string) =>
    Object.keys(stored).filter(k => k.toLowerCase() === u.toLowerCase());
  const roleOf = (u: string): Role => {
    const keys = variants(u);
    return keys.length > 0 && keys.every(k => stored[k] === 'team')
      ? 'team'
      : 'self';
  };
  const saveRole = (u: string, v: Role) => {
    const drop = new Set(variants(u));
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
      {info?.access === 'owner' && (
        <Text fz={12} c="dimmed">
          Your own Mac always sees the whole team.
        </Text>
      )}
      {info && info.access !== 'owner' && (
        <Text fz={12} c="dimmed">
          {NOTE[info.access]}
        </Text>
      )}
      {info?.members.map(m => (
        <Group key={m.username} justify="space-between" wrap="nowrap">
          <Text fz={13}>{m.name ?? m.username}</Text>
          <SegmentedControl
            size="xs"
            aria-label={`Role for ${m.username}`}
            disabled={!editable}
            value={roleOf(m.username)}
            data={[
              { value: 'team', label: 'Team' },
              { value: 'self', label: 'Self' },
            ]}
            onChange={v => saveRole(m.username, v as Role)}
          />
        </Group>
      ))}
    </Stack>
  );
}
