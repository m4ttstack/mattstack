import type { OrgTeam } from './config.ts';

type Named = readonly [string, string | null | undefined];

/** Everyone the board can draw, by username and name, for Slack face matching:
    MR authors, the board's own members (hidden ones too), and every org team's
    members, whom the ask picker lists. */
export function slackFaceNames(
  mrs: readonly { author: { username: string; name: string } }[],
  memberNames: ReadonlyMap<string, string | null>,
  orgTeams: readonly OrgTeam[]
): Named[] {
  return [
    ...mrs.map(mr => [mr.author.username, mr.author.name] as const),
    ...memberNames,
    ...orgTeams.flatMap(team =>
      team.members.map(m => [m.username, m.name] as const)
    ),
  ];
}
