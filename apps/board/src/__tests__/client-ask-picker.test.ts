import { describe, expect, test } from 'bun:test';

import {
  askPickerModel,
  type AskPickerModel,
} from '../client/board/ask-picker.ts';

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
    name: 'sprockets',
    members: [
      { username: 'sam', name: 'Sam Whitlow' },
      { username: 'nia', name: 'Nia Okoro' },
      { username: 'odile' },
    ],
  },
  { name: 'ledger', members: [{ username: 'kofi' }] },
];

const env = {
  roster: ['ada', 'rae'],
  peers: ['rae', 'sam', 'nia', 'ines'],
  teams,
  ownTeam: 'checkout',
};

const mine = (extra: object = {}) =>
  ({ author: { username: 'ada' }, ...extra }) as never;

const usernames = (people: Array<{ username: string }>) =>
  people.map(p => p.username);

const rows = (model: AskPickerModel | null) =>
  model!.sections.map(g => [
    g.team,
    g.role,
    g.approval ?? null,
    g.people.map(p => p.username),
    g.slack ?? null,
  ]);

describe('askPickerModel', () => {
  test('your team, then each owning team still to approve, then the rest with approved owners marked', () => {
    const model = askPickerModel(
      mine({
        ownerTeams: [
          { team: 'billing', approved: true },
          { team: 'sprockets', approved: false },
        ],
      }),
      env
    );
    expect(rows(model)).toEqual([
      ['checkout', 'mine', null, ['rae'], null],
      ['sprockets', 'owner', 'needs', ['nia', 'sam'], null],
      ['billing', 'owner', 'approved', ['ines'], null],
    ]);
  });

  test('an owning team whose approval is not read yet keeps its place among the needed ones', () => {
    const model = askPickerModel(
      mine({
        ownerTeams: [
          { team: 'billing', approved: true },
          { team: 'sprockets', approved: null },
        ],
      }),
      env
    );
    expect(rows(model).map(r => r.slice(0, 3))).toEqual([
      ['checkout', 'mine', null],
      ['sprockets', 'owner', 'checking'],
      ['billing', 'owner', 'approved'],
    ]);
  });

  test('a needed owning team with no board offers the Slack post where the repo can post to code owners', () => {
    const ownerTeams = [{ team: 'ledger', approved: false }];
    expect(
      rows(askPickerModel(mine({ ownerTeams }), { ...env, canPostOwners: true }))
    ).toContainEqual(['ledger', 'owner', 'needs', [], {}]);
  });

  test("once the team's channel has the post, its Slack row links there", () => {
    const ownerTeams = [
      { team: 'ledger', approved: false, posted: 'https://slack.example/p1' },
    ];
    expect(
      rows(askPickerModel(mine({ ownerTeams }), { ...env, canPostOwners: true }))
    ).toContainEqual([
      'ledger',
      'owner',
      'needs',
      [],
      { posted: 'https://slack.example/p1' },
    ]);
  });

  test('an owning team with nobody to ask leaves the list when nothing can be offered instead', () => {
    const model = askPickerModel(
      mine({
        ownerTeams: [
          { team: 'ledger', approved: false },
          { team: 'kiosk', approved: true },
        ],
      }),
      env
    );
    expect(rows(model).map(r => r[0])).toEqual([
      'checkout',
      'billing',
      'sprockets',
    ]);
    const approved = askPickerModel(
      mine({ ownerTeams: [{ team: 'ledger', approved: true }] }),
      { ...env, canPostOwners: true }
    );
    expect(rows(approved).map(r => r[0])).not.toContain('ledger');
  });

  test('every other team with someone to ask follows, in directory order', () => {
    expect(rows(askPickerModel(mine(), env))).toEqual([
      ['checkout', 'mine', null, ['rae'], null],
      ['billing', 'other', null, ['ines'], null],
      ['sprockets', 'other', null, ['nia', 'sam'], null],
    ]);
  });

  test('a person is shown by their roster name, else their username', () => {
    const model = askPickerModel(mine(), env)!;
    expect(model.sections[2]!.people).toEqual([
      { username: 'nia', name: 'Nia Okoro' },
      { username: 'sam', name: 'Sam Whitlow' },
    ]);
  });

  test('a teammate takes the name their team entry carries', () => {
    const model = askPickerModel(mine(), env)!;
    expect(model.sections[0]!.people).toEqual([
      { username: 'rae', name: 'Rae Marlow' },
    ]);
  });

  test('someone already engaged with the MR is offered nowhere', () => {
    const model = askPickerModel(
      mine({
        ownerTeams: [{ team: 'sprockets', approved: false }],
        peerReviews: [{ reviewer: 'nia', status: 'reviewing', updatedAt: 1 }],
      }),
      env
    );
    expect(rows(model)[1]).toEqual([
      'sprockets',
      'owner',
      'needs',
      ['sam'],
      null,
    ]);
  });

  test('before the relay has said who is enrolled, every member counts', () => {
    const model = askPickerModel(mine(), { ...env, peers: undefined });
    expect(rows(model)[2]![3]).toEqual(['nia', 'odile', 'sam']);
  });

  test('with no teammate to ask, the list starts at the other teams', () => {
    const model = askPickerModel(mine(), { ...env, roster: ['ada'] });
    expect(rows(model).map(r => r[0])).toEqual(['billing', 'sprockets']);
  });

  test('a board with no other team still gets the list, with just its own team', () => {
    expect(rows(askPickerModel(mine(), { ...env, teams: [] }))).toEqual([
      ['checkout', 'mine', null, ['rae'], null],
    ]);
  });

  test('nobody to ask anywhere leaves no picker', () => {
    expect(
      askPickerModel(mine(), { ...env, roster: ['ada'], peers: [] })
    ).toBeNull();
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
