import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import {
  attachOwnerTeams,
  ownerTeamsFromRules,
  readGithubOwnerRules,
  refreshOwnerTeams,
} from '../owner-teams.ts';
import { openStateDb } from '../state/db.ts';

const directory = {
  teams: {
    checkout: { slack: { codeOwnersChannel: '#pod-checkout' } },
    sprockets: { slack: { codeOwnersChannel: 'pod-sprockets' } },
    billing: { slack: { codeOwnersChannel: '#pod-billing' } },
  },
};

describe('ownerTeamsFromRules', () => {
  test('maps each owning section to its team through the directory channel', () => {
    const rules = [
      { section: 'Sprockets - #pod-sprockets', approved: false },
      { section: 'Billing - #pod-billing', approved: true },
    ];
    expect(ownerTeamsFromRules(rules, directory, null)).toEqual([
      { team: 'sprockets', channel: 'pod-sprockets', approved: false },
      { team: 'billing', channel: 'pod-billing', approved: true },
    ]);
  });

  test('a team is approved only when every rule of its sections is', () => {
    const rules = [
      { section: 'Sprockets - #pod-sprockets', approved: true },
      { section: 'Sprockets - #pod-sprockets', approved: false },
    ];
    expect(ownerTeamsFromRules(rules, directory, null)).toEqual([
      { team: 'sprockets', channel: 'pod-sprockets', approved: false },
    ]);
  });

  test('marks my own team instead of leaving it out', () => {
    const rules = [{ section: 'Checkout - #pod-checkout', approved: false }];
    expect(ownerTeamsFromRules(rules, directory, 'checkout')).toEqual([
      {
        team: 'checkout',
        channel: 'pod-checkout',
        approved: false,
        mine: true,
      },
    ]);
  });

  test('a channel no team claims stands as its own owner', () => {
    const rules = [
      { section: 'Intake - #intake-auto', approved: true },
      { section: 'FirstStop - #intake-auto', approved: false },
    ];
    expect(ownerTeamsFromRules(rules, directory, null)).toEqual([
      { channel: 'intake-auto', approved: false },
    ]);
  });

  test('a section naming no channel stands as its own owner', () => {
    const rules = [
      { section: 'SpareParts', approved: false },
      { section: 'SpareParts', approved: false },
    ];
    expect(ownerTeamsFromRules(rules, directory, null)).toEqual([
      { section: 'SpareParts', approved: false },
    ]);
  });

  test('keeps CODEOWNERS order across teams, channels and bare sections', () => {
    const rules = [
      { section: 'SpareParts', approved: false },
      { section: 'Ledger - #pod-ledger', approved: false },
      { section: 'Sprockets - #pod-sprockets', approved: false },
    ];
    expect(
      ownerTeamsFromRules(rules, directory, null).map(
        o => o.team ?? o.channel ?? o.section
      )
    ).toEqual(['SpareParts', 'pod-ledger', 'sprockets']);
  });
});

describe('ownerTeamsFromRules on GitHub', () => {
  const github = (value: string) => ({
    teams: {
      web: { github: { team: value } },
      api: { slack: { codeOwnersChannel: '#pod-api' } },
    },
  });

  test.each(['acme/web', '@ACME/web', '@acme/WEB'])(
    'github.team %p claims @acme/web without @ and in any case',
    value => {
      const rules = [{ section: '@acme/web', approved: false }];
      expect(
        ownerTeamsFromRules(rules, github(value), null, {}, 'github')
      ).toEqual([{ team: 'web', section: '@acme/web', approved: false }]);
    }
  );

  test('marks the active team and merges its tokens by approval', () => {
    const rules = [
      { section: '@acme/web', approved: true },
      { section: '@acme/web', approved: false },
    ];
    expect(
      ownerTeamsFromRules(rules, github('acme/web'), 'web', {}, 'github')
    ).toEqual([
      { team: 'web', section: '@acme/web', approved: false, mine: true },
    ]);
  });

  test('a login owner is that person, the token kept as the section', () => {
    const rules = [{ section: '@ellie-dev', approved: false }];
    expect(
      ownerTeamsFromRules(rules, github('acme/web'), null, {}, 'github')
    ).toEqual([
      { person: 'ellie-dev', section: '@ellie-dev', approved: false },
    ]);
  });

  test('a team token no directory team claims stands as its own section', () => {
    const rules = [{ section: '@acme/api', approved: false }];
    expect(
      ownerTeamsFromRules(rules, github('acme/web'), null, {}, 'github')
    ).toEqual([{ section: '@acme/api', approved: false }]);
  });

  test('a section with a channel in its name stays a section on GitHub', () => {
    const rules = [{ section: 'Api - #pod-api', approved: false }];
    expect(
      ownerTeamsFromRules(rules, github('acme/web'), null, {}, 'github')
    ).toEqual([{ section: 'Api - #pod-api', approved: false }]);
  });

  test('keeps the token order', () => {
    const rules = [
      { section: '@ellie-dev', approved: false },
      { section: '@acme/web', approved: false },
      { section: '@acme/api', approved: true },
    ];
    expect(
      ownerTeamsFromRules(rules, github('acme/web'), null, {}, 'github').map(
        o => o.person ?? o.team ?? o.section
      )
    ).toEqual(['ellie-dev', 'web', '@acme/api']);
  });

  test('GitLab ignores github.team and reads @ sections as sections', () => {
    const rules = [{ section: '@acme/web', approved: false }];
    expect(ownerTeamsFromRules(rules, github('acme/web'), null)).toEqual([
      { section: '@acme/web', approved: false },
    ]);
  });
});

describe('attachOwnerTeams on GitHub', () => {
  test('reads stored rules through the forge it is given', async () => {
    const db = memoryDb();
    await refreshOwnerTeams([mr(7, 't1')], {
      db,
      readRules: async () => [{ section: '@ellie-dev', approved: false }],
    });
    const [row] = attachOwnerTeams(
      [mr(7, 't1')],
      { directory, ownTeam: null, forge: 'github' },
      db
    );
    expect(row!.ownerTeams).toEqual([
      { person: 'ellie-dev', section: '@ellie-dev', approved: false },
    ]);
  });
});

describe('readGithubOwnerRules', () => {
  const reply = (r: unknown) => {
    const calls: Array<{ verb: string; body: unknown }> = [];
    const command = (async (verb: string, body: unknown) => {
      calls.push({ verb, body });
      return r;
    }) as never;
    return { calls, command };
  };

  test('asks mr:owner-rules and keeps only CODE_OWNER rules', async () => {
    const { calls, command } = reply({
      ok: true,
      data: {
        rules: [
          { type: 'ANY_APPROVER', section: null, approved: false },
          { type: 'CODE_OWNER', section: '@acme/web', approved: true },
          { type: 'CODE_OWNER', section: null, approved: false },
          { type: 'CODE_OWNER', section: '@ellie-dev', approved: false },
        ],
      },
    });
    expect(await readGithubOwnerRules('github.com/o/r', 7, command)).toEqual({
      ok: true,
      rules: [
        { section: '@acme/web', approved: true },
        { section: '@ellie-dev', approved: false },
      ],
    });
    expect(calls).toEqual([
      { verb: 'mr:owner-rules', body: { repoName: 'github.com/o/r', iid: 7 } },
    ]);
  });

  test('an unknownReason reads as no owners', async () => {
    const { command } = reply({
      ok: true,
      data: {
        rules: [{ type: 'CODE_OWNER', section: '@acme/web', approved: false }],
        unknownReason: 'no CODEOWNERS file',
      },
    });
    expect(await readGithubOwnerRules('github.com/o/r', 7, command)).toEqual({
      ok: true,
      rules: [],
    });
  });

  test('a daemon error is a 502', async () => {
    const { command } = reply({ ok: false, error: 'rt daemon unreachable' });
    const read = await readGithubOwnerRules('github.com/o/r', 7, command);
    expect(read).toMatchObject({ ok: false, status: 502 });
    expect(JSON.stringify(read)).toContain('rt daemon unreachable');
  });

  test('an empty reply is a 502, not an empty list', async () => {
    const { command } = reply({ ok: true });
    expect(
      await readGithubOwnerRules('github.com/o/r', 7, command)
    ).toMatchObject({ ok: false, status: 502 });
  });
});

const memoryDb = () =>
  openStateDb(join(mkdtempSync(join(tmpdir(), 'board-owners-')), 'state.db'));

const mr = (iid: number, updatedAt: string, approvedBy: string[] = []) => ({
  iid,
  webUrl: `https://gitlab.example.com/acme/shop/-/merge_requests/${iid}`,
  updatedAt,
  reviews: { approvedBy: approvedBy.map(username => ({ username })) },
});

const config = { directory, ownTeam: 'checkout' };
const needed = [{ section: 'Sprockets - #pod-sprockets', approved: false }];
const sprocketsNeeded = {
  team: 'sprockets',
  channel: 'pod-sprockets',
  approved: false,
};

describe('refreshOwnerTeams', () => {
  test('reads each MR once until it changes, and attaches the owning teams', async () => {
    const db = memoryDb();
    const reads: number[] = [];
    const deps = {
      db,
      readRules: async (m: { iid: number }) => {
        reads.push(m.iid);
        return needed;
      },
    };
    await refreshOwnerTeams([mr(7, 't1')], deps);
    await refreshOwnerTeams([mr(7, 't1')], deps);
    expect(reads).toEqual([7]);
    await refreshOwnerTeams([mr(7, 't2')], deps);
    expect(reads).toEqual([7, 7]);
    expect(attachOwnerTeams([mr(7, 't2'), mr(8, 't1')], config, db)).toEqual([
      { ...mr(7, 't2'), ownerTeams: [sprocketsNeeded] },
      mr(8, 't1'),
    ]);
  });

  test('a new approval is read again though updatedAt stands still', async () => {
    const db = memoryDb();
    let reads = 0;
    const deps = {
      db,
      readRules: async () => {
        reads += 1;
        return needed;
      },
    };
    await refreshOwnerTeams([mr(7, 't1')], deps);
    await refreshOwnerTeams([mr(7, 't1', ['sam'])], deps);
    expect(reads).toBe(2);
  });

  test('once the MR has changed, the teams stay but their approval is unknown until the next read', async () => {
    const db = memoryDb();
    await refreshOwnerTeams([mr(7, 't1')], {
      db,
      readRules: async () => needed,
    });
    expect(
      attachOwnerTeams([mr(7, 't1', ['sam'])], config, db)[0]!.ownerTeams
    ).toEqual([{ ...sprocketsNeeded, approved: null }]);
  });

  test('the owning teams follow the directory as it is now, not as it was at the read', async () => {
    const db = memoryDb();
    await refreshOwnerTeams([mr(7, 't1')], {
      db,
      readRules: async () => [
        { section: 'Ledger - #pod-ledger', approved: false },
      ],
    });
    expect(attachOwnerTeams([mr(7, 't1')], config, db)[0]!.ownerTeams).toEqual([
      { channel: 'pod-ledger', approved: false },
    ]);
    const withLedger = {
      ownTeam: 'checkout',
      directory: {
        teams: {
          ...directory.teams,
          ledger: { slack: { codeOwnersChannel: 'pod-ledger' } },
        },
      },
    };
    expect(
      attachOwnerTeams([mr(7, 't1')], withLedger, db)[0]!.ownerTeams
    ).toEqual([{ team: 'ledger', channel: 'pod-ledger', approved: false }]);
  });

  test("an owning team carries the link to the MR's post in its channel", async () => {
    const db = memoryDb();
    await refreshOwnerTeams([mr(7, 't1')], {
      db,
      readRules: async () => [
        ...needed,
        { section: 'Billing - #pod-billing', approved: false },
      ],
    });
    const posts = (url: string): Record<string, { permalink: string }> =>
      url === mr(7, 't1').webUrl
        ? { 'pod-sprockets': { permalink: 'https://slack.example/p1' } }
        : {};
    expect(
      attachOwnerTeams([mr(7, 't1')], { ...config, posts }, db)[0]!.ownerTeams
    ).toEqual([
      { ...sprocketsNeeded, posted: 'https://slack.example/p1' },
      { team: 'billing', channel: 'pod-billing', approved: false },
    ]);
  });

  test('a failed read stores nothing, so the next pass tries again', async () => {
    const db = memoryDb();
    let calls = 0;
    const deps = {
      db,
      readRules: async () => {
        calls += 1;
        return null;
      },
    };
    await refreshOwnerTeams([mr(7, 't1')], deps);
    await refreshOwnerTeams([mr(7, 't1')], deps);
    expect(calls).toBe(2);
    expect(attachOwnerTeams([mr(7, 't1')], config, db)).toEqual([mr(7, 't1')]);
  });
});
