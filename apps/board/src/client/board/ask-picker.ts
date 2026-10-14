import type { BoardMRWithReview, OrgTeam, OwnerTeam } from '../types.ts';
import { askOutstanding, firstReviewTargets } from './format.ts';

export interface AskPerson {
  username: string;
  name: string;
}

/** One block in the picker. `mine` is the seat's own team; `owner` an owner
    of a Code Owner section (a team, a channel no team claims, or a section
    naming no channel), with its approval (`checking` while the MR changed
    since the read); `other` any other team. `slack` stands in for people on
    an owner with nobody to ask: the Code Owner post in `channel`, `posted`
    once that channel has it, or no channel to post in at all. */
export interface AskSection {
  team: string | null;
  role: 'mine' | 'owner' | 'other';
  approval?: 'needs' | 'approved' | 'checking';
  people: AskPerson[];
  slack?: { channel?: string; posted?: string };
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

  const approvalOf = (owner: OwnerTeam) =>
    owner.approved === true
      ? 'approved'
      : owner.approved === null
        ? 'checking'
        : 'needs';
  const owners = mrx.ownerTeams ?? [];
  const sections: AskSection[] = [];
  const teammates = firstReviewTargets(mrx, env.roster, env.peers)
    .map(u => person(u))
    .sort(byName);
  const myOwner = owners.find(o => o.mine);
  if (teammates.length > 0)
    sections.push({
      team: env.ownTeam,
      role: 'mine',
      ...(myOwner ? { approval: approvalOf(myOwner) } : {}),
      people: teammates,
    });

  for (const owner of owners) {
    if (owner.mine || owner.approved === true) continue;
    const approval = approvalOf(owner);
    const people = owner.team ? peopleOf(owner.team) : [];
    const team =
      owner.team ?? (owner.channel ? `#${owner.channel}` : owner.section!);
    if (people.length > 0)
      sections.push({ team, role: 'owner', approval, people });
    else if (env.canPostOwners)
      sections.push({
        team,
        role: 'owner',
        approval,
        people,
        slack: {
          ...(owner.channel ? { channel: owner.channel } : {}),
          ...(owner.posted ? { posted: owner.posted } : {}),
        },
      });
  }

  const byTeam = new Map(owners.flatMap(o => (o.team ? [[o.team, o]] : [])));
  for (const team of env.teams) {
    if (team.name === env.ownTeam) continue;
    const owner = byTeam.get(team.name);
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
