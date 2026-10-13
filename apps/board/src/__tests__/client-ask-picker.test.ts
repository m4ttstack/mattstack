import { describe, expect, test } from 'bun:test';

import { askPickerModel } from '../client/board/ask-picker.ts';

const teams = [
  {
    name: 'billing',
    members: [{ username: 'ines', name: 'Ines Duarte' }],
  },
  {
    name: 'checkout',
    members: [{ username: 'ada' }, { username: 'rae', name: 'Rae Marlow' }],
  },
  {
    name: 'ingestion',
    members: [
      { username: 'sam', name: 'Sam Whitlow' },
      { username: 'lea', name: 'Lea Thorne' },
      { username: 'odile' },
    ],
  },
  { name: 'ledger', members: [{ username: 'kofi' }] },
];

const env = {
  roster: ['ada', 'rae'],
  peers: ['rae', 'sam', 'lea', 'ines'],
  teams,
  ownTeam: 'checkout',
};

const mine = (extra: object = {}) =>
  ({ author: { username: 'ada' }, ...extra }) as never;

const usernames = (people: Array<{ username: string }>) =>
  people.map(p => p.username);

describe('askPickerModel', () => {
  test('code owners lists the peered members of each owning team, the teams still needed first', () => {
    const model = askPickerModel(
      mine({
        ownerTeams: [
          { team: 'billing', approved: true },
          { team: 'ingestion', approved: false },
        ],
      }),
      env
    )!;
    expect(usernames(model.teammates)).toEqual(['rae']);
    expect(
      model.owners.map(g => [g.team, g.note, usernames(g.people)])
    ).toEqual([
      ['ingestion', 'needs approval', ['lea', 'sam']],
      ['billing', 'approved', ['ines']],
    ]);
    expect(model.opensOn).toBe('owners');
  });

  test('an owning team with no board to ask is named, not listed', () => {
    const model = askPickerModel(
      mine({ ownerTeams: [{ team: 'ledger', approved: false }] }),
      env
    )!;
    expect(model.owners).toEqual([]);
    expect(model.noBoard).toEqual(['ledger']);
    expect(model.opensOn).toBe('all');
  });

  test('all teams groups every askable person by team, mine first', () => {
    const model = askPickerModel(mine(), env)!;
    expect(model.all.map(g => [g.team, g.note, usernames(g.people)])).toEqual([
      ['checkout', 'your team', ['rae']],
      ['billing', undefined, ['ines']],
      ['ingestion', undefined, ['lea', 'sam']],
    ]);
    expect(model.opensOn).toBe('all');
  });

  test('a person is shown by their roster name, else their username', () => {
    const model = askPickerModel(mine(), env)!;
    expect(model.all[2]!.people).toEqual([
      { username: 'lea', name: 'Lea Thorne' },
      { username: 'sam', name: 'Sam Whitlow' },
    ]);
  });

  test('a teammate takes the name their team entry carries', () => {
    const model = askPickerModel(mine(), env)!;
    expect(model.teammates).toEqual([{ username: 'rae', name: 'Rae Marlow' }]);
  });

  test('someone already engaged with the MR is offered nowhere', () => {
    const model = askPickerModel(
      mine({
        ownerTeams: [{ team: 'ingestion', approved: false }],
        peerReviews: [{ reviewer: 'lea', status: 'reviewing', updatedAt: 1 }],
      }),
      env
    )!;
    expect(usernames(model.owners[0]!.people)).toEqual(['sam']);
    expect(usernames(model.all[2]!.people)).toEqual(['sam']);
  });

  test('before the relay has said who is enrolled, every member counts', () => {
    const model = askPickerModel(mine(), { ...env, peers: undefined })!;
    expect(usernames(model.all[2]!.people)).toEqual(['lea', 'odile', 'sam']);
  });

  test('with nobody on another team to ask there is no picker', () => {
    expect(askPickerModel(mine(), { ...env, peers: ['rae'] })).toBeNull();
    expect(askPickerModel(mine(), { ...env, teams: [] })).toBeNull();
  });

  test('an ask still outstanding on the MR leaves no picker', () => {
    expect(
      askPickerModel(
        mine({ sentNudge: { display: 'requested', reviewer: 'rae' } }),
        env
      )
    ).toBeNull();
  });
});
