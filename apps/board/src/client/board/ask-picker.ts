import type { BoardMRWithReview, OrgTeam } from '../types.ts';
import { askOutstanding, firstReviewTargets } from './format.ts';

export interface AskPerson {
  username: string;
  name: string;
}

export interface AskGroup {
  team: string;
  note?: string;
  people: AskPerson[];
}

export interface AskPickerModel {
  /** The seat's own team, as the plain ask menu lists it. */
  teammates: AskPerson[];
  /** Teams that own a section on this MR and have someone to ask. */
  owners: AskGroup[];
  /** Owning teams with nobody to ask: no member's board takes asks. */
  noBoard: string[];
  /** Every team with someone to ask, the seat's own first. */
  all: AskGroup[];
  opensOn: 'owners' | 'all';
}

export interface AskPickerEnv {
  roster: readonly string[];
  /** Usernames whose boards take asks; undefined = the relay has not said. */
  peers?: readonly string[];
  teams: readonly OrgTeam[];
  ownTeam: string | null;
  names?: ReadonlyMap<string, string>;
}

/**
 * Who an author can ask for a first review beyond their own team. Null when
 * nobody on another team can be asked, where the plain teammates menu is the
 * whole answer, and while an ask on this MR is still outstanding.
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
  const person = (username: string, name?: string): AskPerson => ({
    username,
    name: env.names?.get(username) ?? name ?? username,
  });
  const byName = (a: AskPerson, b: AskPerson) => a.name.localeCompare(b.name);
  const peopleOf = (team: OrgTeam) =>
    team.members
      .filter(m => askable(m.username))
      .map(m => person(m.username, m.name))
      .sort(byName);

  const others = env.teams
    .filter(t => t.name !== env.ownTeam)
    .map(t => ({ team: t.name, people: peopleOf(t) }));
  if (!others.some(g => g.people.length > 0)) return null;

  const teammates = firstReviewTargets(mrx, env.roster, env.peers)
    .map(u => person(u))
    .sort(byName);
  const owners: AskGroup[] = [];
  const noBoard: string[] = [];
  for (const owner of mrx.ownerTeams ?? []) {
    const people = others.find(g => g.team === owner.team)?.people ?? [];
    if (people.length === 0) noBoard.push(owner.team);
    else
      owners.push({
        team: owner.team,
        note: owner.approved ? 'approved' : 'needs approval',
        people,
      });
  }
  owners.sort(
    (a, b) =>
      Number(a.note === 'approved') - Number(b.note === 'approved') ||
      a.team.localeCompare(b.team)
  );
  const all: AskGroup[] = [
    ...(teammates.length > 0
      ? [
          {
            team: env.ownTeam ?? 'your team',
            ...(env.ownTeam ? { note: 'your team' } : {}),
            people: teammates,
          },
        ]
      : []),
    ...others.filter(g => g.people.length > 0),
  ];
  return {
    teammates,
    owners,
    noBoard,
    all,
    opensOn: owners.length > 0 ? 'owners' : 'all',
  };
}
