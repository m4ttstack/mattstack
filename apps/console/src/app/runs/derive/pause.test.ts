import type { RunDecisionRow, RunSummary } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { pausedBy, pauseStateOf, railHolds } from './pause';

const run = (id: string, over: Partial<RunSummary> = {}): RunSummary => ({
  id,
  repo: 'remote:acme%2Fweb',
  work_type: 'feature',
  pipeline: 'work',
  status: 'running',
  current_stage: null,
  spawned_by: null,
  started_at: 0,
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: 0,
  ticket: null,
  branch: null,
  ...over,
});

const hold = (
  decided_by: string,
  decided_at: number,
  scope = 'hold:plan:1'
): RunDecisionRow => ({
  contract: 'gate@1',
  scope,
  selection: '{"reason":"x"}',
  decided_by,
  decided_at,
});

const working: RunSummary['agent'] = { status: 'working', pane: 'p' };
const idle: RunSummary['agent'] = { status: 'idle', pane: 'p' };

describe('pausedBy', () => {
  it("is whoever decided the run's newest hold", () => {
    expect(pausedBy([hold('console', 1), hold('pane', 2)])).toBe('agent');
    expect(pausedBy([hold('pane', 1), hold('console', 2)])).toBe('console');
  });

  it('is the console when no hold was decided', () => {
    expect(pausedBy([hold('pane', 1, 'plan')])).toBe('console');
  });
});

describe('pauseStateOf', () => {
  const set = { reason: 'held', at: 5 };
  const stateOf = (by: string, agent: RunSummary['agent']) =>
    pauseStateOf(run('r1', { hold: set, agent }), [hold(by, 5)]);

  it('is none with no live pause', () => {
    expect(pauseStateOf(run('r1'), [])).toBe('none');
  });

  it('is pausing while the agent works and paused once it stops', () => {
    expect(stateOf('console', working)).toBe('pausing');
    expect(stateOf('console', idle)).toBe('paused');
    expect(stateOf('console', null)).toBe('paused');
  });

  it('is none while the agent works under its own hold, paused once it stops', () => {
    expect(stateOf('agent', working)).toBe('none');
    expect(stateOf('agent', idle)).toBe('paused');
  });
});

describe('railHolds', () => {
  const stages = [
    {
      name: 'plan',
      attempt: 1,
      status: 'running',
      started_at: 0,
      ended_at: null,
      reason: null,
      detail_path: null,
    },
  ];
  const held = (by: string, agent: RunSummary['agent']) =>
    railHolds(
      run('r1', { hold: { reason: 'held', at: 5 }, agent }),
      stages,
      [hold(by, 5)],
      []
    );
  const open = [{ stage: 'plan', from: 5, to: null }];

  it("leaves out the agent's own hold while it works", () => {
    expect(held('agent', working)).toEqual([]);
    expect(held('agent', idle)).toEqual(open);
  });

  it('keeps a console pause while the agent works', () => {
    expect(held('console', working)).toEqual(open);
  });
});
