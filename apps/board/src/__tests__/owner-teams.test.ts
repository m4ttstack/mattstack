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
    ingestion: { slack: { codeOwnersChannel: 'pod-ingestion' } },
    billing: { slack: { codeOwnersChannel: '#pod-billing' } },
  },
};

describe('ownerTeamsFromRules', () => {
  test('maps each owning section to its team through the directory channel', () => {
    const rules = [
      { section: 'Ingestion - #pod-ingestion', approved: false },
      { section: 'Billing - #pod-billing', approved: true },
    ];
    expect(ownerTeamsFromRules(rules, directory, null)).toEqual([
      { team: 'ingestion', approved: false },
      { team: 'billing', approved: true },
    ]);
  });

  test('a team is approved only when every rule of its sections is', () => {
    const rules = [
      { section: 'Ingestion - #pod-ingestion', approved: true },
      { section: 'Ingestion - #pod-ingestion', approved: false },
    ];
    expect(ownerTeamsFromRules(rules, directory, null)).toEqual([
      { team: 'ingestion', approved: false },
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

const mr = (iid: number, updatedAt: string) => ({
  iid,
  webUrl: `https://gitlab.example.com/acme/shop/-/merge_requests/${iid}`,
  updatedAt,
});

describe('refreshOwnerTeams', () => {
  test('reads each MR once per updatedAt and attaches what it stored', async () => {
    const db = memoryDb();
    const reads: number[] = [];
    const deps = {
      db,
      directory,
      ownTeam: 'checkout',
      readRules: async (m: { iid: number }) => {
        reads.push(m.iid);
        return [{ section: 'Ingestion - #pod-ingestion', approved: false }];
      },
    };
    await refreshOwnerTeams([mr(7, 't1')], deps);
    await refreshOwnerTeams([mr(7, 't1')], deps);
    expect(reads).toEqual([7]);
    await refreshOwnerTeams([mr(7, 't2')], deps);
    expect(reads).toEqual([7, 7]);
    expect(attachOwnerTeams([mr(7, 't2'), mr(8, 't1')], db)).toEqual([
      { ...mr(7, 't2'), ownerTeams: [{ team: 'ingestion', approved: false }] },
      mr(8, 't1'),
    ]);
  });

  test('a failed read stores nothing, so the next pass tries again', async () => {
    const db = memoryDb();
    let calls = 0;
    const deps = {
      db,
      directory,
      ownTeam: null,
      readRules: async () => {
        calls += 1;
        return null;
      },
    };
    await refreshOwnerTeams([mr(7, 't1')], deps);
    await refreshOwnerTeams([mr(7, 't1')], deps);
    expect(calls).toBe(2);
    expect(attachOwnerTeams([mr(7, 't1')], db)).toEqual([mr(7, 't1')]);
  });
});
