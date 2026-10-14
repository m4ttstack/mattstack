import type { BoardMRWithReview, OrgTeam } from '../types.ts';
import { askOutstanding, firstReviewTargets } from './format.ts';

export interface AskPerson {
  username: string;
  name: string;
}

/** One team's block in the picker. `mine` is the seat's own team; `owner`
    a team that owns a Code Owner section, with its approval (`checking`
    while the MR changed since the read); `other` any other team. `slack`
    stands in for people on an owning team with nobody to ask: the Code
    Owner post, or `posted` once its channel has it. */
export interface AskSection {
  team: string | null;
  role: 'mine' | 'owner' | 'other';
  approval?: 'needs' | 'approved' | 'checking';
  people: AskPerson[];
  slack?: { posted?: string };
}

export interface AskPickerModel {
  sections: AskSection[];
}

export interface AskPickerEnv {
  roster: readonly string[];
  /** Usernames whose boards take asks; undefined = the relay has not said. */
  peers?: readonly string[];
  teams: readonly OrgTeam[];
  ownTeam: string | null;
  names?: ReadonlyMap<string, string>;
  /** The repo posts review requests to Code Owner channels. */
  canPostOwners?: boolean;
}

/**
 * Who an author can ask for a first review, in the Code Owner post's order:
 * their own team, each owning team still to approve, then every other team.
 * Null while an ask on this MR is still outstanding, or with nobody to ask.
 */
export function askPickerModel(
  mrx: BoardMRWithReview,
  env: AskPickerEnv
): AskPickerModel | null {
  if (askOutstanding(mrx)) return null;
  const engaged = new Set((mrx.peerReviews ?? []).map(p => p.reviewer));
  engaged.add(mrx.author.username);
  const enrolled = env.peers ? new Set(env.peers) : null;
  const askable = (username: string) =>
    !engaged.has(username) && (!enrolled || enrolled.has(username));
  const teamNames = new Map(
    env.teams.flatMap(t =>
      t.members.flatMap(m => (m.name ? [[m.username, m.name] as const] : []))
    )
  );
  const person = (username: string): AskPerson => ({
    username,
    name: env.names?.get(username) ?? teamNames.get(username) ?? username,
  });
  const byName = (a: AskPerson, b: AskPerson) => a.name.localeCompare(b.name);
  const peopleOf = (team: string) =>
    (env.teams.find(t => t.name === team)?.members ?? [])
      .filter(m => askable(m.username))
      .map(m => person(m.username))
      .sort(byName);

  const sections: AskSection[] = [];
  const teammates = firstReviewTargets(mrx, env.roster, env.peers)
    .map(u => person(u))
    .sort(byName);
  if (teammates.length > 0)
    sections.push({ team: env.ownTeam, role: 'mine', people: teammates });

  const owners = new Map((mrx.ownerTeams ?? []).map(o => [o.team, o]));
  for (const owner of owners.values()) {
    if (owner.approved === true) continue;
    const approval = owner.approved === null ? 'checking' : 'needs';
    const people = peopleOf(owner.team);
    if (people.length > 0)
      sections.push({ team: owner.team, role: 'owner', approval, people });
    else if (env.canPostOwners)
      sections.push({
        team: owner.team,
        role: 'owner',
        approval,
        people,
        slack: owner.posted ? { posted: owner.posted } : {},
      });
  }

  for (const team of env.teams) {
    if (team.name === env.ownTeam) continue;
    const owner = owners.get(team.name);
    if (owner && owner.approved !== true) continue;
    const people = peopleOf(team.name);
    if (people.length === 0) continue;
    sections.push(
      owner
        ? { team: team.name, role: 'owner', approval: 'approved', people }
        : { team: team.name, role: 'other', people }
    );
  }
  return sections.length > 0 ? { sections } : null;
}
