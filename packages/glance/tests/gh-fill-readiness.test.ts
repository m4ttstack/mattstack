import { describe, expect, it } from 'bun:test';
import { githubReadiness } from '../src/githubFill.ts';
import type { Pipeline } from '../src/types.ts';

const pipe = (status: string): Pipeline => ({
  id: 'github:run:1',
  status,
  createdAt: null,
  webUrl: null,
  jobs: []
});

type Input = Parameters<typeof githubReadiness>[0];
const base: Input = {
  state: 'opened',
  isDraft: false,
  mergeStateStatus: 'CLEAN',
  reviewDecision: null,
  pipeline: null,
  unresolvedThreadCount: 0,
  contextsComplete: true
};
const r = (over: Partial<Input>) => githubReadiness({ ...base, ...over });
const blocked = (over: Partial<Input>) => r({ mergeStateStatus: 'BLOCKED', ...over });

describe('githubReadiness', () => {
  it('CLEAN and HAS_HOOKS are ready', () => {
    expect(r({ mergeStateStatus: 'CLEAN' })).toEqual({ state: 'ready', reasons: [] });
    expect(r({ mergeStateStatus: 'HAS_HOOKS' })).toEqual({ state: 'ready', reasons: [] });
  });
  it('UNSTABLE is ready', () => {
    expect(r({ mergeStateStatus: 'UNSTABLE' })).toEqual({ state: 'ready', reasons: [] });
  });
  it('DIRTY is blocked by conflicts', () => {
    expect(r({ mergeStateStatus: 'DIRTY' })).toEqual({ state: 'blocked', reasons: ['conflicts'] });
  });
  it('BEHIND is blocked by behind', () => {
    expect(r({ mergeStateStatus: 'BEHIND' })).toEqual({ state: 'blocked', reasons: ['behind'] });
  });
  it('DRAFT reads draft', () => {
    expect(r({ mergeStateStatus: 'DRAFT' })).toEqual({ state: 'draft', reasons: [] });
    expect(r({ isDraft: true })).toEqual({ state: 'draft', reasons: [] });
  });
  it('UNKNOWN reads checking', () => {
    expect(r({ mergeStateStatus: 'UNKNOWN' })).toEqual({ state: 'checking', reasons: [] });
  });
  it('BLOCKED by changes requested', () => {
    expect(blocked({ reviewDecision: 'CHANGES_REQUESTED' }).reasons).toEqual(['changes-requested']);
  });
  it('BLOCKED by review required', () => {
    expect(blocked({ reviewDecision: 'REVIEW_REQUIRED' }).reasons).toEqual(['approvals']);
  });
  it('BLOCKED by running checks', () => {
    expect(blocked({ pipeline: pipe('running') }).reasons).toEqual(['checks-running']);
  });
  it('BLOCKED by a canceled required check', () => {
    expect(blocked({ pipeline: pipe('canceled') }).reasons).toEqual(['checks-failing']);
  });
  it('BLOCKED by unresolved threads', () => {
    expect(blocked({ unresolvedThreadCount: 1 }).reasons).toEqual(['threads']);
  });
  it('BLOCKED names every cause', () => {
    expect(
      blocked({
        reviewDecision: 'REVIEW_REQUIRED',
        pipeline: pipe('failed'),
        unresolvedThreadCount: 2
      })
    ).toEqual({ state: 'blocked', reasons: ['checks-failing', 'approvals', 'threads'] });
  });
  it('BLOCKED with no visible cause reads other', () => {
    expect(blocked({ unresolvedThreadCount: null })).toEqual({
      state: 'blocked',
      reasons: ['other']
    });
  });
  it('merged and closed ignore UNKNOWN', () => {
    expect(r({ state: 'merged', mergeStateStatus: 'UNKNOWN' }).state).toBe('merged');
    expect(r({ state: 'closed', mergeStateStatus: 'UNKNOWN' }).state).toBe('closed');
  });
  it('incomplete contexts read checking', () => {
    expect(r({ contextsComplete: false })).toEqual({ state: 'checking', reasons: [] });
  });
});
