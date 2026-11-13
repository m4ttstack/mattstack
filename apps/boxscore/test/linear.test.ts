import { describe, expect, it } from 'vitest';

import {
  eligibleForLinearDiscovery,
  parseChangeUrl,
} from '../src/server/linear/fetch.js';
import { mapIssue } from '../src/server/linear/map.js';
import type { RawIssue } from '../src/server/linear/raw-types.js';
import { computeSnapshot } from '../src/server/metrics/snapshot.js';
import { FETCH, mr, USERS, WINDOW } from './fixtures.js';

const SIZE_BAND = { tooSmall: 10, tooLarge: 400 };

const rawIssue = (overrides: Partial<RawIssue> = {}): RawIssue => ({
  id: 'id-1',
  identifier: 'ENG-1',
  title: 'Some issue',
  url: 'https://linear.app/acme/issue/ENG-1',
  state: null,
  attachments: null,
  ...overrides,
});

describe('eligibleForLinearDiscovery', () => {
  const at = (state: 'merged' | 'opened' | 'closed' | 'locked') =>
    mr({ iid: 1, authorUsername: 'alice', title: 'Fix ACME-100 bug', state });

  it('scans merged MRs (shipped work)', () => {
    expect(eligibleForLinearDiscovery(at('merged'))).toBe(true);
  });

  it('scans open MRs so in-review tickets are discovered', () => {
    // The bug this fixes: a ticket is 'In Review' precisely while its MR is open,
    // so open MRs must feed discovery or those tickets never enter the dataset.
    expect(eligibleForLinearDiscovery(at('opened'))).toBe(true);
  });

  it('scans locked MRs (mid-merge, still active)', () => {
    expect(eligibleForLinearDiscovery(at('locked'))).toBe(true);
  });

  it('skips closed (abandoned) MRs', () => {
    expect(eligibleForLinearDiscovery(at('closed'))).toBe(false);
  });
});

describe('mapIssue', () => {
  it('maps a raw issue to a normalized one, attributing to the given user', () => {
    const norm = mapIssue(rawIssue(), 'alice', [], null);
    expect(norm.creditedUser).toBe('alice');
    expect(norm.identifier).toBe('ENG-1');
    expect(norm.title).toBe('Some issue');
    expect(norm.url).toBe('https://linear.app/acme/issue/ENG-1');
    expect(norm.linkedMrs).toEqual([]);
    expect(norm.closedAt).toBeNull();
  });

  it('accepts null for the credited user (e.g. unlinked ticket)', () => {
    const norm = mapIssue(rawIssue(), null, [], null);
    expect(norm.creditedUser).toBeNull();
  });
});

describe('issuesCompleted metric', () => {
  const snap = computeSnapshot(FETCH, {
    window: WINDOW,
    users: USERS,
    sizeBand: SIZE_BAND,
  });

  it('counts verified tickets attributed to each user', () => {
    // alice: ENG-1 + ENG-2 = 2.
    expect(snap.byUser.alice!.issuesCompleted).toBe(2);
    // bob: ENG-3 = 1.
    expect(snap.byUser.bob!.issuesCompleted).toBe(1);
  });

  it('ignores tickets with a null credited user', () => {
    // ENG-5 has creditedUser: null ... it doesn't count for anyone.
    const total =
      snap.byUser.alice!.issuesCompleted + snap.byUser.bob!.issuesCompleted;
    expect(total).toBe(3);
  });

  it('tolerates a FetchResult with no linearIssues field (old cache envelopes)', () => {
    const { linearIssues: _omit, ...legacy } = FETCH;
    const legacySnap = computeSnapshot(legacy as typeof FETCH, {
      window: WINDOW,
      users: USERS,
      sizeBand: SIZE_BAND,
    });
    expect(legacySnap.byUser.alice!.issuesCompleted).toBe(0);
  });
});

describe('parseChangeUrl', () => {
  const pr = { projectPath: 'o/r', iid: 12 };

  it('reads a GitHub pull request URL, with or without a suffix', () => {
    for (const suffix of ['', '/files', '?x=1', '#c']) {
      expect(
        parseChangeUrl(`https://github.com/o/r/pull/12${suffix}`, 'github')
      ).toEqual(pr);
    }
  });

  it('rejects a GitHub issue URL', () => {
    expect(
      parseChangeUrl('https://github.com/o/r/issues/12', 'github')
    ).toBeNull();
  });

  it('rejects a GitLab MR URL on a GitHub team', () => {
    expect(
      parseChangeUrl('https://gl.example/o/r/-/merge_requests/12', 'github')
    ).toBeNull();
  });

  it('reads a GitLab MR URL on a GitLab team', () => {
    expect(
      parseChangeUrl('https://gl.example/o/r/-/merge_requests/12', 'gitlab')
    ).toEqual(pr);
  });
});
