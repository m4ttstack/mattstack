#!/usr/bin/env bun
/**
 * The approval-rules, codeowner-sections and diverged-count reads are
 * optional interface members behind capability flags.
 */
import { describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import type { GitProvider } from '../src/GitProvider.ts';
import { useForgeStub, useInstantTimers } from './helpers/gh-fill-fixture.ts';

useForgeStub();
useInstantTimers();

describe('GitHub-parity read capabilities', () => {
  test('GitLab reports the reads it already has', () => {
    const p = new GitLabProvider('https://gitlab.example', 't');
    expect(p.capabilities.canFetchApprovalRules).toBe(true);
    expect(p.capabilities.canFetchCodeownerSections).toBe(true);
    expect(p.capabilities.canFetchDivergedCount).toBe(true);
    expect(typeof (p as GitProvider).fetchDivergedCounts).toBe('undefined');
  });

  test('a GitProvider-typed GitLab exposes the three reads', () => {
    const gp: GitProvider = new GitLabProvider('https://gitlab.example', 't');
    expect(typeof gp.fetchApprovalRules).toBe('function');
    expect(typeof gp.fetchCodeownerSections).toBe('function');
    expect(typeof gp.fetchDivergedCount).toBe('function');
  });
});
