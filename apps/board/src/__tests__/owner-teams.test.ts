import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'bun:test';

import {
  attachOwnerTeams,
  ownerTeamsFromRules,
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
      { team: 'sprockets', approved: false },
      { team: 'billing', approved: true },
    ]);
  });

  test('a team is approved only when every rule of its sections is', () => {
    const rules = [
      { section: 'Sprockets - #pod-sprockets', approved: true },
      { section: 'Sprockets - #pod-sprockets', approved: false },
    ];
    expect(ownerTeamsFromRules(rules, directory, null)).toEqual([
      { team: 'sprockets', approved: false },
    ]);
  });

  test('leaves out my own team, sections with no channel and channels no team claims', () => {
    const rules = [
      { section: 'Checkout - #pod-checkout', approved: false },
      { section: 'Docs', approved: false },
      { section: 'Ledger - #pod-ledger', approved: false },
    ];
    expect(ownerTeamsFromRules(rules, directory, 'checkout')).toEqual([]);
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
      { ...mr(7, 't2'), ownerTeams: [{ team: 'sprockets', approved: false }] },
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
    ).toEqual([{ team: 'sprockets', approved: null }]);
  });

  test('the owning teams follow the directory as it is now, not as it was at the read', async () => {
    const db = memoryDb();
    await refreshOwnerTeams([mr(7, 't1')], {
      db,
      readRules: async () => [
        { section: 'Ledger - #pod-ledger', approved: false },
      ],
    });
    expect(attachOwnerTeams([mr(7, 't1')], config, db)[0]!.ownerTeams).toEqual(
      []
    );
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
    ).toEqual([{ team: 'ledger', approved: false }]);
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
      {
        team: 'sprockets',
        approved: false,
        posted: 'https://slack.example/p1',
      },
      { team: 'billing', approved: false },
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
