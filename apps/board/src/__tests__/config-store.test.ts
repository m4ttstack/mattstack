import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';

import {
  getDef,
  switchboardUrl,
  validateWrite,
  type getSetting,
  type setSetting,
  type SettingScope,
} from '@mattstack/rt-client';
import {
  applyRosterEdit,
  boardConfigured,
  DEFAULT_SLACK_EMOJI,
  displayName,
  loadConfig,
  rosterWriteRefusal,
  saveMemberHidden,
  saveRosterMembers,
  saveTabs,
  teamView,
  type TabConfig,
} from '../config.ts';
import { fakeResolve } from './fake-resolve.ts';

type GetSettingFn = typeof getSetting;
type SetSettingFn = typeof setSetting;

// validateWrite's merged-result check reads the stores under HOME; an empty
// temp HOME keeps it from reading the real ones.
const origHome = process.env.HOME;
let home: string;
beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'board-store-home-'));
  process.env.HOME = home;
});
afterAll(() => {
  process.env.HOME = origHome;
  rmSync(home, { recursive: true, force: true });
});

const realView = { ...teamView };
beforeEach(() => {
  teamView.pack = () => null;
  teamView.team = () => null;
  teamView.rosterRefusal = () => null;
});
afterEach(() => {
  Object.assign(teamView, realView);
});

function throwingResolve(message = 'rt daemon unreachable'): GetSettingFn {
  return (() => {
    throw new Error(message);
  }) as GetSettingFn;
}

/** Records every setSetting call instead of writing anywhere real, and
    holds each one to the write gate setSetting applies. */
function fakeWrite(
  calls: Array<{ key: string; value: unknown; scope: string }>
): SetSettingFn {
  return ((key: string, value: unknown, scope: string) => {
    const def = getDef(key);
    expect(def).toBeDefined();
    expect(
      validateWrite(def!, value, { scope: scope as SettingScope })
    ).toEqual({ ok: true });
    calls.push({ key, value, scope });
  }) as SetSettingFn;
}

const TEAM = {
  'board.gitlabHost': 'gitlab.example.com',
  'board.projects': ['acme/widgets'],
  'mattstack.roster': [{ username: 'dev1' }, { username: 'dev2' }],
};

/** TEAM with its roster replaced. */
function withRoster(
  roster: unknown,
  extra: Record<string, unknown> = {}
): GetSettingFn {
  return fakeResolve({ ...TEAM, 'mattstack.roster': roster, ...extra });
}

const twoTeamsRoster = [
  { username: 'dev1', teams: ['widgets'] },
  { username: 'dev3', teams: ['gadgets'] },
];

describe('loadConfig: the store and the registry defaults', () => {
  test('with only the team keys set, every other field is its registry default', () => {
    const cfg = loadConfig(fakeResolve(TEAM));
    expect(cfg).toMatchObject({
      title: 'MRs ready for review',
      defaultMember: 'all',
      gateGraceMinutes: 90,
      doctorSkill: '',
      botUsernames: [],
      reviewsWorkspace: 'reviews',
      respondsWorkspace: 'responses',
      doctorsWorkspace: 'doctors',
      questionsWorkspace: 'questions',
      reviewCwd: '',
      respondCwd: '',
      doctorCwd: '',
      claudeCommand: '',
      staleAfterDays: null,
      ticketPrefixes: [],
      tabs: [{ id: 'team', label: 'Team', source: { kind: 'authors' } }],
      rtRepos: { 'acme/widgets': 'gitlab.example.com/acme/widgets' },
    });
    expect(cfg.slack).toMatchObject({
      channel: '',
      singleTemplate: '{title}: {url}',
      autoResolveIntervalMinutes: 15,
    });
  });

  test('a partial workspaces value keeps the defaults for the rest', () => {
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'board.workspaces': { reviews: 'rev' } })
    );
    expect([
      cfg.reviewsWorkspace,
      cfg.respondsWorkspace,
      cfg.doctorsWorkspace,
    ]).toEqual(['rev', 'responses', 'doctors']);
  });

  test('a board with no team keys, or an empty roster, is not configured', () => {
    expect(() => loadConfig(fakeResolve({}))).toThrow(
      'missing required field "gitlabHost"'
    );
    expect(boardConfigured(fakeResolve({}))).toBe(false);
    expect(
      boardConfigured(fakeResolve({ ...TEAM, 'mattstack.roster': [] }))
    ).toBe(false);
    expect(boardConfigured(fakeResolve(TEAM))).toBe(true);
  });

  test('a resolver that throws on every key reads as not configured, never crashes', () => {
    expect(boardConfigured(throwingResolve())).toBe(false);
  });

  test('a resolver throw on a key with a default reads the default, never crashes', () => {
    const r = fakeResolve(TEAM);
    const flaky = (<T>(key: string, opts?: unknown) => {
      if (key === 'board.tabs') throw new Error('store unreadable');
      return r<T>(key, opts as never);
    }) as typeof r;
    expect(loadConfig(flaky).tabs).toEqual(
      getDef('board.tabs')!.default as TabConfig[]
    );
  });

  test('hidden state comes from board.hiddenMembers alone; an inline roster flag is ignored', () => {
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'mattstack.roster': [
          { username: 'dev1', hidden: true },
          { username: 'dev2' },
        ],
        'board.hiddenMembers': ['dev2'],
      })
    );
    expect(cfg.members).toEqual([
      { username: 'dev1' },
      { username: 'dev2', hidden: true },
    ]);
  });

  test('hiding a member when nobody has hidden anyone writes just that member at user scope', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden('dev2', true, fakeResolve(TEAM), fakeWrite(calls));
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['dev2'], scope: 'user' },
    ]);
  });
});

describe('loadConfig: store values', () => {
  test('a store value wins over the registry default', () => {
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'board.gitlabHost': 'https://gitlab.example.com',
        'board.title': 'Team Board',
      })
    );
    expect(cfg.gitlabHost).toBe('https://gitlab.example.com');
    expect(cfg.title).toBe('Team Board');
    expect(cfg.projects).toEqual(['acme/widgets']);
  });

  test('board.workspaces: a partial value keeps the default for the rest', () => {
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'board.workspaces': { reviews: 'store-reviews' } })
    );
    expect(cfg.reviewsWorkspace).toBe('store-reviews');
    expect(cfg.respondsWorkspace).toBe('responses');
    expect(cfg.doctorsWorkspace).toBe('doctors');
    expect(cfg.questionsWorkspace).toBe('questions');
  });

  test('board.workspaces.questions overrides the questions workspace', () => {
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'board.workspaces': { questions: 'q' } })
    );
    expect(cfg.questionsWorkspace).toBe('q');
  });

  test('board.cwds: a partial value keeps the default for the rest', () => {
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'board.cwds': { doctor: '/store/doctor' } })
    );
    expect(cfg.reviewCwd).toBe('');
    expect(cfg.respondCwd).toBe('');
    expect(cfg.doctorCwd).toBe('/store/doctor');
  });

  test('rtRepos derives from board.projects and board.gitlabHost; board.rtRepos in the store is not read', () => {
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'board.gitlabHost': 'https://GitLab.example.com',
        'board.projects': ['acme/widgets', 'acme/gadgets'],
        'board.rtRepos': [{ project: 'acme/widgets', repo: 'store-repo-name' }],
      })
    );
    expect(cfg.rtRepos).toEqual({
      'acme/widgets': 'gitlab.example.com/acme/widgets',
      'acme/gadgets': 'gitlab.example.com/acme/gadgets',
    });
  });

  test("a store gitlabHost or projects of the wrong type fails parseConfig's validation, never a TypeError inside derivation", () => {
    expect(() =>
      loadConfig(fakeResolve({ ...TEAM, 'board.gitlabHost': 42 }))
    ).toThrow(/gitlabHost/);
    expect(() =>
      loadConfig(fakeResolve({ ...TEAM, 'board.projects': 'acme/widgets' }))
    ).toThrow(/projects/);
  });

  test('gateGraceMinutes: a store value wins', () => {
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'board.gateGraceMinutes': 120 })
    );
    expect(cfg.gateGraceMinutes).toBe(120);
  });

  test('mattstack.roster is the roster', () => {
    const cfg = loadConfig(
      withRoster([{ username: 'suite', name: 'Suite Wide' }])
    );
    expect(cfg.members).toEqual([{ username: 'suite', name: 'Suite Wide' }]);
  });

  test('board.hiddenMembers overlays a mattstack.roster roster', () => {
    const cfg = loadConfig(
      withRoster([{ username: 'ann' }, { username: 'bo' }], {
        'board.hiddenMembers': ['bo'],
      })
    );
    expect(cfg.members).toEqual([
      { username: 'ann' },
      { username: 'bo', hidden: true },
    ]);
  });
});

describe('loadConfig: store values get the normalization and validation parseConfig applies', () => {
  test('a lowercase store ticketPrefixes normalizes (trim + uppercase)', () => {
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'board.ticketPrefixes': ['acme', ' int '] })
    );
    expect(cfg.ticketPrefixes).toEqual(['ACME', 'INT']);
  });

  test("a partial store slack object gets the default fill for the fields it doesn't carry", () => {
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'board.slack': { singleTemplate: '{url}' } })
    );
    expect(cfg.slack).toEqual({
      channel: '',
      singleTemplate: '{url}',
      multiHeader: "{count} MR's ready for review :pray:",
      multiItem: '- {title}: {url}',
      autoResolveIntervalMinutes: 15,
      emoji: DEFAULT_SLACK_EMOJI,
      emojiAliases: {},
    });
  });

  test('a board.switchboardUrl an older rt left in the store is never read', () => {
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'board.switchboardUrl': 'https://old-store.example.app',
      })
    );
    expect(cfg.switchboard.url).toBe(switchboardUrl());
  });

  const twoTeams = twoTeamsRoster;

  test('the team pack comes from the active team, never from a setting, and survives the store round trip', () => {
    teamView.pack = () => 'widgets';
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'board.title': 'Acme',
        'board.defaultPack': 'gadgets',
      })
    );
    expect(cfg.title).toBe('Acme');
    expect(cfg.teamPack).toBe('widgets');
  });

  test('orgMembers lists every roster entry, teamed or not', () => {
    teamView.team = () => 'widgets';
    const cfg = loadConfig(
      withRoster([
        { username: 'Dev1', name: 'Dev One', teams: ['widgets'] },
        { username: 'dev3', teams: ['gadgets'] },
        { username: 'dev5' },
      ])
    );
    expect(cfg.orgMembers).toEqual(['dev1', 'dev3', 'dev5']);
  });

  test("the roster is the active team's members", () => {
    teamView.team = () => 'widgets';
    const cfg = loadConfig(withRoster(twoTeams));
    expect(cfg.members.map(m => m.username)).toEqual(['dev1']);
  });

  test("every team's members ride along whatever the active team is", () => {
    teamView.team = () => 'widgets';
    const cfg = loadConfig(
      withRoster([
        { username: 'dev1', name: 'Dev One', teams: ['widgets'] },
        { username: 'dev3', teams: ['gadgets', 'widgets'] },
        { username: 'dev5' },
      ])
    );
    expect(cfg.ownTeam).toBe('widgets');
    expect(cfg.orgTeams).toEqual([
      { name: 'gadgets', members: [{ username: 'dev3' }] },
      {
        name: 'widgets',
        members: [{ username: 'dev1', name: 'Dev One' }, { username: 'dev3' }],
      },
    ]);
  });

  test('a Mac on no team, and a team nobody is listed on, see the whole roster instead of failing to load', () => {
    const everyone = loadConfig(withRoster(twoTeams));
    expect(everyone.members.map(m => m.username)).toEqual(['dev1', 'dev3']);
    teamView.team = () => 'sprockets';
    const empty = loadConfig(withRoster(twoTeams));
    expect(empty.members.map(m => m.username)).toEqual(['dev1', 'dev3']);
  });

  test('a save from the everyone view replaces the roster as edited and puts nobody on a team', () => {
    teamView.team = () => 'sprockets';
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveRosterMembers(twoTeams, withRoster(twoTeams), fakeWrite(calls));
    expect(calls[0]!.value).toEqual(twoTeams);
  });

  test("saving from one team's view writes the org roster, keeps the other team's members, and reloads", () => {
    teamView.team = () => 'widgets';
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const cfg = saveRosterMembers(
      [{ username: 'dev1' }, { username: 'dev4' }],
      withRoster(twoTeams),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      {
        key: 'mattstack.roster',
        value: [
          { username: 'dev1', teams: ['widgets'] },
          { username: 'dev3', teams: ['gadgets'] },
          { username: 'dev4', teams: ['widgets'] },
        ],
        scope: 'org',
      },
    ]);
    expect(cfg.members.map(m => m.username)).toEqual(['dev1']);
  });

  test('a bad store defaultMember (not "all" or a known member) is rejected', () => {
    expect(() =>
      loadConfig(fakeResolve({ ...TEAM, 'board.defaultMember': 'ghost' }))
    ).toThrow(/defaultMember/);
  });

  test('a store member with no username is rejected', () => {
    expect(() => loadConfig(withRoster([{ name: 'No User' }]))).toThrow(
      /username/
    );
  });

  test("a malformed store value's error names the settings store, never config.json", () => {
    const resolve = fakeResolve({ ...TEAM, 'board.defaultMember': 'ghost' });
    expect(() => loadConfig(resolve)).toThrow(/settings-store value/);
    try {
      loadConfig(resolve);
    } catch (err) {
      expect((err as Error).message).not.toContain('config.json');
    }
  });
});

describe('loadConfig: members roster + hiddenMembers overlay', () => {
  test('mattstack.roster (org roster) and board.hiddenMembers (user overlay) compose', () => {
    const cfg = loadConfig(
      withRoster([{ username: 'carol', name: 'Carol' }, { username: 'dave' }], {
        'board.hiddenMembers': ['dave'],
      })
    );
    expect(cfg.members).toEqual([
      { username: 'carol', name: 'Carol' },
      { username: 'dave', hidden: true },
    ]);
  });
});

describe('loadConfig: board.tabs', () => {
  test('a board.tabs store value is the tab list', () => {
    const resolve = fakeResolve({
      ...TEAM,
      'board.tabs': [
        {
          id: 'q',
          label: 'Q',
          source: { kind: 'codeowners', section: 'Acme', excludeMembers: true },
          slackChannel: 'team-codeowners',
        },
      ],
    });
    const cfg = loadConfig(resolve);
    expect(cfg.tabs[0]!.id).toBe('q');
  });
});

describe('saveRosterMembers', () => {
  test('removal round-trips through the same writer', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const stored = [{ username: 'alice' }, { username: 'bob' }];
    saveRosterMembers(
      [{ username: 'alice' }],
      withRoster(stored),
      fakeWrite(calls)
    );
    expect(calls[0]!.value).toEqual([{ username: 'alice' }]);
  });

  test('writes mattstack.roster at org', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const next = [{ username: 'alice' }, { username: 'bob', name: 'Bob Ng' }];
    saveRosterMembers(
      next,
      withRoster([{ username: 'alice' }]),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'mattstack.roster', value: next, scope: 'org' },
    ]);
  });

  test('a write to mattstack.roster strips hidden: that key has no such field', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveRosterMembers(
      [{ username: 'alice' }, { username: 'bob', hidden: true, name: 'Bob' }],
      withRoster([{ username: 'alice' }]),
      fakeWrite(calls)
    );
    expect(calls[0]!.value).toEqual([
      { username: 'alice' },
      { username: 'bob', name: 'Bob' },
    ]);
  });

  test('a board edit keeps a key the store re-recorded after the board loaded', () => {
    teamView.team = () => 'widgets';
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const stale = [
      { username: 'dev1', name: 'Dev 1', agePublicKey: 'age1old' },
      { username: 'dev4' },
    ];
    saveRosterMembers(
      stale,
      withRoster([
        { username: 'dev1', agePublicKey: 'age1new', teams: ['widgets'] },
      ]),
      fakeWrite(calls)
    );
    expect(calls[0]!.value).toEqual([
      {
        username: 'dev1',
        name: 'Dev 1',
        agePublicKey: 'age1new',
        teams: ['widgets'],
      },
      { username: 'dev4', teams: ['widgets'] },
    ]);
  });

  test('an entry added to the store after the board loaded survives a save from the everyone view and from a team view', () => {
    const later = [
      ...twoTeamsRoster,
      { username: 'dev5', agePublicKey: 'age1ccc', teams: ['widgets'] },
    ];
    for (const [team, shown] of [
      [null, ['dev1', 'dev3']],
      ['widgets', ['dev1']],
    ] as const) {
      teamView.team = () => team;
      const calls: Array<{ key: string; value: unknown; scope: string }> = [];
      saveRosterMembers(
        [
          { username: 'dev1', name: 'Dev One' },
          ...(team ? [] : [{ username: 'dev3' }]),
        ],
        withRoster(later),
        fakeWrite(calls),
        [...shown]
      );
      expect(calls[0]!.value).toContainEqual({
        username: 'dev5',
        agePublicKey: 'age1ccc',
        teams: ['widgets'],
      });
    }
  });

  test('a blank-name rename in a team view clears the stored name', () => {
    teamView.team = () => 'widgets';
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    const resolve = withRoster([
      { username: 'dev1', name: 'Dev One', teams: ['widgets'] },
    ]);
    const view = loadConfig(resolve).members;
    const edit = applyRosterEdit(
      view,
      { action: 'rename', username: 'dev1', name: '' },
      null
    );
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    saveRosterMembers(edit.members, resolve, fakeWrite(calls));
    expect(calls[0]!.value).toEqual([{ username: 'dev1', teams: ['widgets'] }]);
  });
});

describe("rosterWriteRefusal: the org roster is the org admins' to change", () => {
  test('answers with the role refusal', () => {
    teamView.rosterRefusal = () =>
      "The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change.";
    expect(rosterWriteRefusal()).toBe(
      "The org's shared files belong to its admins. Ask dev1 (an org admin) to make this change."
    );
  });

  test('an admin is not refused', () => {
    expect(rosterWriteRefusal()).toBeNull();
  });
});

describe('saveMemberHidden', () => {
  test('writes board.hiddenMembers (user)', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'bob',
      true,
      withRoster([{ username: 'alice' }, { username: 'bob' }], {
        'board.hiddenMembers': [],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['bob'], scope: 'user' },
    ]);
    // A resolver that already reflects the write's own value proves the overlay reads it back correctly.
    const reloaded = loadConfig(
      withRoster([{ username: 'alice' }, { username: 'bob' }], {
        'board.hiddenMembers': ['bob'],
      })
    );
    expect(reloaded.members).toEqual([
      { username: 'alice' },
      { username: 'bob', hidden: true },
    ]);
  });

  test('unhiding removes the username from the stored array rather than appending a duplicate', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'alice',
      false,
      withRoster([{ username: 'alice' }, { username: 'bob' }], {
        'board.hiddenMembers': ['alice', 'bob'],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['bob'], scope: 'user' },
    ]);
  });

  test('an unknown member throws before any write', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    expect(() =>
      saveMemberHidden(
        'ghost',
        true,
        withRoster([{ username: 'alice' }], { 'board.hiddenMembers': [] }),
        fakeWrite(calls)
      )
    ).toThrow(/unknown member/);
    expect(calls).toEqual([]);
  });
});

describe('saveMemberHidden against the org roster', () => {
  test('hiding a member writes board.hiddenMembers', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'carol',
      true,
      withRoster([{ username: 'alice' }, { username: 'carol' }]),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['carol'], scope: 'user' },
    ]);
  });

  test('un-hiding omits the username but keeps another hidden one', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'carol',
      false,
      withRoster([{ username: 'alice' }, { username: 'carol' }], {
        'board.hiddenMembers': ['alice', 'carol'],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['alice'], scope: 'user' },
    ]);
  });

  test('un-hiding the only hidden member writes an empty list', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'carol',
      false,
      withRoster([{ username: 'alice' }, { username: 'carol' }], {
        'board.hiddenMembers': ['carol'],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: [], scope: 'user' },
    ]);
  });

  test('un-hiding a member who was never hidden writes the list unchanged', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveMemberHidden(
      'carol',
      false,
      withRoster([{ username: 'alice' }, { username: 'carol' }], {
        'board.hiddenMembers': ['alice'],
      }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.hiddenMembers', value: ['alice'], scope: 'user' },
    ]);
  });

  test('an unknown username throws before any write', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    expect(() =>
      saveMemberHidden(
        'ghost',
        true,
        withRoster([{ username: 'alice' }, { username: 'carol' }]),
        fakeWrite(calls)
      )
    ).toThrow(/unknown member "ghost"/);
    expect(calls).toEqual([]);
  });
});

describe('slack default emoji re-export sanity', () => {
  test('still the standard set', () => {
    expect(DEFAULT_SLACK_EMOJI).toEqual({
      looking: 'eyes',
      commented: 'speech_balloon',
      approved: 'white_check_mark',
    });
  });
});

describe('saveTabs', () => {
  const codeowners: TabConfig = {
    id: 'acme',
    label: 'Acme',
    source: { kind: 'codeowners', section: 'Acme', excludeMembers: true },
  };
  const team: TabConfig = {
    id: 'team',
    label: 'Team',
    source: { kind: 'authors' },
  };

  test('writes board.tabs (team)', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveTabs(
      [team, codeowners],
      fakeResolve({ ...TEAM, 'board.tabs': [team] }),
      fakeWrite(calls)
    );
    expect(calls).toEqual([
      { key: 'board.tabs', value: [team, codeowners], scope: 'team' },
    ]);
  });

  test('an invalid list throws before any write', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    expect(() => saveTabs([], fakeResolve(TEAM), fakeWrite(calls))).toThrow(
      /must not be empty/
    );
    expect(() =>
      saveTabs(
        [team, team],
        fakeResolve({ ...TEAM, 'board.tabs': [team] }),
        fakeWrite(calls)
      )
    ).toThrow(/duplicate tab id/);
    expect(() =>
      saveTabs(
        [{ id: 'x', label: 'X', source: { kind: 'codeowners' } }],
        fakeResolve(TEAM),
        fakeWrite(calls)
      )
    ).toThrow(/section/);
    expect(calls).toEqual([]);
  });

  test('optional per-tab fields survive validation and absent ones stay absent', () => {
    const calls: Array<{ key: string; value: unknown; scope: string }> = [];
    saveTabs(
      [
        {
          ...codeowners,
          slackChannel: 'team-codeowners',
          reviewSkill: 'external-review',
        },
      ],
      fakeResolve(TEAM),
      fakeWrite(calls)
    );
    saveTabs([team], fakeResolve(TEAM), fakeWrite(calls));
    const written = calls.map(c => (c.value as TabConfig[])[0]!);
    expect(written[0]).toEqual({
      ...codeowners,
      slackChannel: 'team-codeowners',
      reviewSkill: 'external-review',
    });
    expect('slackChannel' in written[1]!).toBe(false);
  });
});

describe('displayName: stored name beats the GitLab profile', () => {
  test('a stored name wins over the GitLab profile name', () => {
    expect(displayName({ username: 'dee', name: 'Dee Fox' }, 'D. Fox')).toBe(
      'Dee Fox'
    );
  });

  test('the GitLab profile fills in when there is no stored name', () => {
    expect(displayName({ username: 'bo' }, 'Bo Chen')).toBe('Bo Chen');
  });

  test('null when neither side has one', () => {
    expect(displayName({ username: 'cy' }, null)).toBeNull();
    expect(displayName({ username: 'cy' }, undefined)).toBeNull();
  });

  test('a blank stored name does not shadow the profile', () => {
    expect(displayName({ username: 'x', name: '   ' }, 'Real Name')).toBe(
      'Real Name'
    );
  });
});

describe('applyRosterEdit: pure roster mutation', () => {
  const roster = [
    { username: 'ann', name: 'Ann Lee' },
    { username: 'bo' },
    { username: 'cy', hidden: true },
  ];

  test('add appends with a name', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'add', username: 'dee', name: 'Dee Fox' },
      'ann'
    );
    expect(r).toEqual({
      ok: true,
      members: [...roster, { username: 'dee', name: 'Dee Fox' }],
    });
  });

  test('add without a name omits the field rather than storing empty', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'add', username: 'dee', name: '  ' },
      'ann'
    );
    expect(r.ok && r.members.at(-1)).toEqual({ username: 'dee' });
  });

  test('add trims the username', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'add', username: '  dee  ' },
      'ann'
    );
    expect(r.ok && r.members.at(-1)).toEqual({ username: 'dee' });
  });

  test('add rejects a duplicate', () => {
    expect(
      applyRosterEdit(roster, { action: 'add', username: 'bo' }, 'ann')
    ).toEqual({ ok: false, error: '"bo" is already on the roster' });
  });

  test('remove drops the entry', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'remove', username: 'bo' },
      'ann'
    );
    expect(r.ok && r.members.map(m => m.username)).toEqual(['ann', 'cy']);
  });

  test('remove rejects an unknown username', () => {
    expect(
      applyRosterEdit(roster, { action: 'remove', username: 'zed' }, 'ann')
    ).toEqual({ ok: false, error: 'unknown member "zed"' });
  });

  test('remove refuses to empty the roster', () => {
    expect(
      applyRosterEdit(
        [{ username: 'ann' }],
        { action: 'remove', username: 'ann' },
        null
      )
    ).toEqual({ ok: false, error: 'the roster cannot be emptied' });
  });

  test('remove refuses to drop the board owner', () => {
    expect(
      applyRosterEdit(roster, { action: 'remove', username: 'ann' }, 'ann')
    ).toEqual({
      ok: false,
      error: 'you cannot drop yourself: this board runs as you',
    });
  });

  test('rename sets a name on an existing member, in place', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'bo', name: 'Bo Chen' },
      'ann'
    );
    expect(r.ok && r.members).toEqual([
      { username: 'ann', name: 'Ann Lee' },
      { username: 'bo', name: 'Bo Chen' },
      { username: 'cy', hidden: true },
    ]);
  });

  test('rename replaces an existing name', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'ann', name: 'Ann Marie Lee' },
      'ann'
    );
    expect(r.ok && r.members[0]).toEqual({
      username: 'ann',
      name: 'Ann Marie Lee',
    });
  });

  test('rename to blank clears the name so the gitlab profile takes over', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'ann', name: '   ' },
      'ann'
    );
    expect(r.ok && r.members[0]).toEqual({ username: 'ann' });
  });

  test('rename preserves a hidden flag', () => {
    const r = applyRosterEdit(
      roster,
      { action: 'rename', username: 'cy', name: 'Cy Park' },
      'ann'
    );
    expect(r.ok && r.members[2]).toEqual({
      username: 'cy',
      name: 'Cy Park',
      hidden: true,
    });
  });

  test('rename rejects an unknown username', () => {
    expect(
      applyRosterEdit(
        roster,
        { action: 'rename', username: 'zed', name: 'Z' },
        'ann'
      )
    ).toEqual({ ok: false, error: 'unknown member "zed"' });
  });

  test('the input roster is never mutated', () => {
    const snapshot = JSON.parse(JSON.stringify(roster));
    applyRosterEdit(
      roster,
      { action: 'rename', username: 'bo', name: 'Bo' },
      'ann'
    );
    applyRosterEdit(roster, { action: 'remove', username: 'bo' }, 'ann');
    expect(roster).toEqual(snapshot);
  });
});

describe('loadConfig: mattstack.directory', () => {
  const DIRECTORY = {
    teams: {
      widgets: {
        linear: { team: 'ACME' },
        slack: {
          codeOwnersChannel: 'widgets-review',
          channels: [{ name: 'Widgets-Internal', kind: 'review' }],
        },
      },
    },
  };
  const realTeam = teamView.team;
  afterEach(() => {
    teamView.team = realTeam;
  });

  test("my team's review channel is the slack channel, and its channels are mine", () => {
    teamView.team = () => 'widgets';
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'mattstack.directory': DIRECTORY })
    );
    expect(cfg.slack.channel).toBe('widgets-internal');
    expect(cfg.ownChannels).toEqual(['widgets-review', 'widgets-internal']);
  });

  test('board.slack.reviewKind picks the kind', () => {
    teamView.team = () => 'widgets';
    const dir = structuredClone(DIRECTORY);
    dir.teams.widgets.slack.channels.push({ name: 'widgets-pr', kind: 'pr' });
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'mattstack.directory': dir,
        'board.slack': { reviewKind: 'pr' },
      })
    );
    expect(cfg.slack.channel).toBe('widgets-pr');
  });

  test('no review channel in my entry means no channel, not a default', () => {
    teamView.team = () => 'widgets';
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'mattstack.directory': {
          teams: {
            widgets: { slack: { codeOwnersChannel: 'widgets-review' } },
          },
        },
      })
    );
    expect(cfg.slack.channel).toBe('');
  });

  test('a codeowners tab without its own channel takes my code owners channel; a set one wins', () => {
    teamView.team = () => 'widgets';
    const tab = (id: string, slackChannel?: string) => ({
      id,
      label: id,
      source: { kind: 'codeowners', section: 'Widgets - #widgets-review' },
      ...(slackChannel ? { slackChannel } : {}),
    });
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'mattstack.directory': DIRECTORY,
        'board.tabs': [tab('a'), tab('b', 'watch-elsewhere')],
      })
    );
    expect(cfg.tabs.map(t => t.slackChannel)).toEqual([
      'widgets-review',
      'watch-elsewhere',
    ]);
  });

  test('the code owners channel a tab takes is bare, like the review channel', () => {
    teamView.team = () => 'widgets';
    const cfg = loadConfig(
      fakeResolve({
        ...TEAM,
        'mattstack.directory': {
          teams: {
            widgets: { slack: { codeOwnersChannel: '#Widgets-Review' } },
          },
        },
        'board.tabs': [
          {
            id: 'a',
            label: 'a',
            source: {
              kind: 'codeowners',
              section: 'Widgets - #widgets-review',
            },
          },
        ],
      })
    );
    expect(cfg.tabs.map(t => t.slackChannel)).toEqual(['widgets-review']);
  });

  test("ticket prefixes default to my team's Linear key; a set value wins", () => {
    teamView.team = () => 'widgets';
    expect(
      loadConfig(fakeResolve({ ...TEAM, 'mattstack.directory': DIRECTORY }))
        .ticketPrefixes
    ).toEqual(['ACME']);
    expect(
      loadConfig(
        fakeResolve({
          ...TEAM,
          'mattstack.directory': DIRECTORY,
          'board.ticketPrefixes': ['ACME', 'WID'],
        })
      ).ticketPrefixes
    ).toEqual(['ACME', 'WID']);
  });

  test('on no team there is no channel and nothing is mine', () => {
    teamView.team = () => null;
    const cfg = loadConfig(
      fakeResolve({ ...TEAM, 'mattstack.directory': DIRECTORY })
    );
    expect(cfg.slack.channel).toBe('');
    expect(cfg.ownChannels).toEqual([]);
  });
});
