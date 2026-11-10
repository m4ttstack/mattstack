import { describe, expect, it } from 'bun:test';
import { mapReviews, toUserRefFromActor } from '../src/githubFill.ts';
import { ghNode } from './helpers/gh-fill-fixture.ts';

const user = (login: string, databaseId: number) => ({
  __typename: 'User' as const,
  login,
  avatarUrl: `https://avatars.example/${login}`,
  databaseId,
  name: login
});
const review = (state: string, login: string, id: number) => ({
  state,
  submittedAt: '2026-01-02T00:00:00Z',
  author: user(login, id)
});
const request = (login: string, id: number) => ({
  requestedReviewer: {
    login,
    databaseId: id,
    name: login,
    avatarUrl: `https://avatars.example/${login}`
  }
});

describe('mapReviews', () => {
  it('a reviewer stays listed after approving', () => {
    const r = review('APPROVED', 'bob', 12);
    const s = mapReviews(
      ghNode({
        reviewRequests: { nodes: [] },
        latestReviews: { nodes: [r] },
        latestOpinionatedReviews: { nodes: [r] }
      }),
      null
    );
    expect(s.reviewers).toHaveLength(1);
    expect(s.reviewers[0]!.id).toBe('github:user:12');
    expect(s.reviewers[0]!.reviewState).toBe('APPROVED');
  });

  it('comment-only reviewer is listed as REVIEWED', () => {
    const s = mapReviews(
      ghNode({
        latestReviews: { nodes: [review('COMMENTED', 'carol', 13)] },
        latestOpinionatedReviews: { nodes: [] }
      }),
      null
    );
    expect(s.reviewers.map(r => [r.username, r.reviewState])).toEqual([
      ['carol', 'REVIEWED']
    ]);
    expect(s.approvedBy).toEqual([]);
  });

  it('a comment after an approval keeps the approval', () => {
    const s = mapReviews(
      ghNode({
        latestReviews: { nodes: [review('COMMENTED', 'bob', 12)] },
        latestOpinionatedReviews: { nodes: [review('APPROVED', 'bob', 12)] }
      }),
      null
    );
    expect(s.approvedBy.map(u => u.username)).toEqual(['bob']);
  });

  it('re-requested reviewer reads UNREVIEWED', () => {
    const s = mapReviews(
      ghNode({
        reviewRequests: { nodes: [request('bob', 12)] },
        latestReviews: { nodes: [review('APPROVED', 'bob', 12)] }
      }),
      null
    );
    expect(s.reviewers).toHaveLength(1);
    expect(s.reviewers[0]!.reviewState).toBe('UNREVIEWED');
  });

  it('two required, one approval', () => {
    const s = mapReviews(
      ghNode({
        reviewDecision: 'REVIEW_REQUIRED',
        baseRef: { branchProtectionRule: { requiredApprovingReviewCount: 2 } }
      }),
      null
    );
    expect(s.approvalsRequired).toBe(2);
    expect(s.approvalsLeft).toBe(1);
    expect(s.approved).toBe(false);
  });

  it('rulesets beat a smaller classic count', () => {
    const s = mapReviews(
      ghNode({
        baseRef: { branchProtectionRule: { requiredApprovingReviewCount: 1 } }
      }),
      2
    );
    expect(s.approvalsRequired).toBe(2);
  });

  it('no requirement reads approved, not awaiting', () => {
    const s = mapReviews(
      ghNode({
        reviewDecision: null,
        baseRef: { branchProtectionRule: null },
        latestReviews: { nodes: [] },
        latestOpinionatedReviews: { nodes: [] }
      }),
      null
    );
    expect(s.approvalsRequired).toBe(0);
    expect(s.approved).toBe(true);
    expect(s.approvalsLeft).toBe(0);
  });

  it('requirement with unreadable count', () => {
    const s = mapReviews(
      ghNode({
        reviewDecision: 'REVIEW_REQUIRED',
        baseRef: { branchProtectionRule: null },
        latestReviews: { nodes: [] },
        latestOpinionatedReviews: { nodes: [] }
      }),
      null
    );
    expect(s.approvalsRequired).toBeNull();
    expect(s.approvalsLeft).toBe(0);
    expect(s.approved).toBe(false);
  });

  it('team-only request', () => {
    const s = mapReviews(
      ghNode({
        reviewDecision: 'REVIEW_REQUIRED',
        baseRef: { branchProtectionRule: null },
        reviewRequests: { nodes: [{ requestedReviewer: { slug: 'core' } }] },
        latestReviews: { nodes: [] },
        latestOpinionatedReviews: { nodes: [] }
      }),
      null
    );
    expect(s.reviewers).toEqual([]);
    expect(s.approved).toBe(false);
    expect(s.approvalsRequired).toBeNull();
  });

  it('changes requested blocks', () => {
    const r = review('CHANGES_REQUESTED', 'bob', 12);
    const s = mapReviews(
      ghNode({
        reviewDecision: 'CHANGES_REQUESTED',
        latestReviews: { nodes: [r] },
        latestOpinionatedReviews: { nodes: [r] }
      }),
      null
    );
    expect(s.approved).toBe(false);
    expect(s.reviewers[0]!.reviewState).toBe('REQUESTED_CHANGES');
  });

  it("the PR author's own thread replies do not list them as a reviewer", () => {
    // GitHub files an author's reply in a review thread as a COMMENTED review.
    const s = mapReviews(
      ghNode({
        author: user('alice', 11),
        latestReviews: {
          nodes: [review('COMMENTED', 'alice', 11), review('APPROVED', 'bob', 12)]
        },
        latestOpinionatedReviews: { nodes: [review('APPROVED', 'bob', 12)] }
      }),
      null
    );
    expect(s.reviewers.map(r => r.username)).toEqual(['bob']);
  });

  it('a deleted PR author does not hide a deleted reviewer', () => {
    const s = mapReviews(
      ghNode({
        author: null,
        latestReviews: { nodes: [{ state: 'COMMENTED', submittedAt: null, author: null }] }
      }),
      null
    );
    expect(s.reviewers.map(r => r.username)).toEqual(['ghost']);
  });

  it('deleted and bot authors map without throwing', () => {
    const s = mapReviews(
      ghNode({
        latestReviews: {
          nodes: [
            { state: 'COMMENTED', submittedAt: null, author: null },
            {
              state: 'COMMENTED',
              submittedAt: null,
              author: {
                __typename: 'Bot',
                login: 'coderabbitai',
                avatarUrl: null,
                databaseId: 99
              }
            }
          ]
        }
      }),
      null
    );
    expect(s.reviewers.map(r => r.username)).toEqual([
      'ghost',
      'coderabbitai[bot]'
    ]);
    expect(s.reviewers[1]!.id).toBe('github:user:99');
  });
});

describe('toUserRefFromActor', () => {
  it('maps null to the ghost placeholder', () => {
    expect(toUserRefFromActor(null)).toEqual({
      id: 'github:user:ghost',
      username: 'ghost',
      name: 'Deleted user',
      avatarUrl: null
    });
  });
});
