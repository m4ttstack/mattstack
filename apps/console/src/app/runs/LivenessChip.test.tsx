import type { RunSummary } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { livenessSpec } from './LivenessChip';

const baseRun: RunSummary = {
  id: 'run-1',
  repo: 'acme',
  work_type: 'feature',
  pipeline: 'implement',
  status: 'running',
  current_stage: 'implement',
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 0,
  ticket: 'DEMO-1234',
  branch: 'feat/x',
  agent: null,
  stages: [],
};

describe('livenessSpec', () => {
  it('reads "waiting on you · <pane>" for a blocked run with an attributed agent', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'blocked',
        evidence: 'herdr reports blocked',
      },
      agent: { status: 'blocked', pane: 'pane-3' },
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('blocked');
    expect(spec.label).toContain('waiting on you · pane-3');
    expect(spec.color).toBe('bad');
  });

  it('falls back to plain "waiting on you" when a blocked run has no attributed agent', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'blocked',
        evidence: 'herdr reports blocked',
      },
      agent: null,
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('blocked');
    expect(spec.label).toBe('waiting on you');
  });

  it('gives attention.reason "blocked" precedence over a simultaneously-working agent', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'blocked',
        evidence: 'herdr reports blocked',
      },
      agent: { status: 'working', pane: 'pane-9' },
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('blocked');
    expect(spec.label).toContain('waiting on you · pane-9');
  });

  it('reads "failed" for a failed run', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'failed',
        evidence: 'stage implement failed',
      },
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('failed');
    expect(spec.label).toContain('failed');
    expect(spec.color).toBe('bad');
  });

  it('reads "stale · <first evidence clause>" for a stale run', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'stale',
        evidence:
          'no event in 41m while in implement, worktree quiet 52m, no agent working there; threshold is 30m',
      },
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('stale');
    expect(spec.label).toContain('stale · no event in 41m while in implement');
  });

  it('reads a warn label for a stranded run', () => {
    const run: RunSummary = {
      ...baseRun,
      attention: {
        needs: true,
        reason: 'stranded',
        evidence: 'worktree missing',
      },
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('stranded');
    expect(spec.color).toBe('warn');
  });

  it('reads "driven · agent working" when an agent is actively working', () => {
    const run: RunSummary = {
      ...baseRun,
      agent: { status: 'working', pane: 'pane-1' },
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('driven');
    expect(spec.label).toContain('driven · agent working');
    expect(spec.color).toBe('ok');
  });

  it('reads an idle label when the attributed agent is idle', () => {
    const run: RunSummary = {
      ...baseRun,
      agent: { status: 'idle', pane: 'pane-1' },
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('idle');
    expect(spec.label).toContain('idle');
    expect(spec.color).toBe('warn');
  });

  it('reads a plain running label when no agent is attributed (herdr-less machine)', () => {
    const run: RunSummary = { ...baseRun, agent: null };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('running');
    expect(spec.label).toContain('running');
    expect(spec.color).toBe('accent');
  });

  it('treats an "unknown" agent status as no evidence -- plain running label', () => {
    const run: RunSummary = {
      ...baseRun,
      agent: { status: 'unknown', pane: 'pane-1' },
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('running');
    expect(spec.label).toContain('running');
  });

  it('reads "done" for a finished run with no attributed agent', () => {
    const run: RunSummary = {
      ...baseRun,
      status: 'done',
      ended_at: 1000,
      agent: null,
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('done');
    expect(spec.label).toContain('done');
    expect(spec.color).toBe('ok');
  });

  it('reads the run\'s own status for a non-"done" terminal run, under a stable data-state', () => {
    const run: RunSummary = {
      ...baseRun,
      status: 'abandoned',
      ended_at: 1000,
      agent: null,
    };
    const spec = livenessSpec(run);
    expect(spec.state).toBe('finished-other');
    expect(spec.label).toContain('abandoned');
    expect(spec.color).toBe('warn');
  });
});
