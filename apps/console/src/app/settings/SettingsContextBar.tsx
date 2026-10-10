import {
  MattstackShell,
  OrgPill,
  ScopeSlash,
  TeamMenu,
} from '@mattstack/app-kit/app';
import { Button, Group, Text } from '@mattstack/app-kit/core';
import { Icon, Icons } from '@mattstack/app-kit/icons';

import type { Viewer } from './useConsoleSettings';

/** Where you are (org and team), in the top bar beside the breadcrumb.
    Viewing another team offers the way back to your own. Who you are sits
    at the bar's other end, on every page (ViewerChip). */
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
  if (!viewer || viewer.role === 'none' || !org) return null;
  // An admin on no team of their own still reaches every team through the
  // menu, so it shows whenever there is a team to open.
  const canSwitch =
    viewer.teams.length > 1 || (!team && viewer.teams.length > 0);
  return (
    <MattstackShell.AppBar>
      <Group gap={10} wrap="nowrap" miw={0}>
        <OrgPill org={org} />
        {(team || canSwitch) && (
          <>
            <ScopeSlash />
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
            aria-label={`Back to ${ownTeam}, your team`}
            onClick={() => onPickTeam(null)}
            style={{ flex: 'none' }}
          >
            {`Back to ${ownTeam}`}
          </Button>
        )}
      </Group>
    </MattstackShell.AppBar>
  );
}
