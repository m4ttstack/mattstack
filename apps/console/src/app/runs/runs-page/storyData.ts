import type { GateRow, RunSummary } from '@mattstack/rt-client';

/** Invented `acme/web` runs for the runs page stories, at the boards'
    4:23 PM. */
export const STORY_NOW = new Date(2026, 9, 8, 16, 23).getTime();

export const at = (h: number, m = 0, day = 8) =>
  new Date(2026, 9, day, h, m).getTime();

export const storyRun = (over: Partial<RunSummary>): RunSummary => ({
  id: '20261008-1338',
  repo: 'remote:acme%2Fweb',
  work_type: 'feature',
  pipeline: 'work',
  status: 'running',
  current_stage: null,
  spawned_by: null,
  started_at: at(9),
  ended_at: null,
  pack_commits: null,
  pack_dirty: 0,
  attention: { needs: false, reason: null, evidence: '' },
  last_event_at: at(9),
  ticket: null,
  branch: null,
  ...over,
});

export const storyGate: GateRow = {
  id: 'g-418-plan',
  subject: 'run:20261008-1340',
  kind: 'plan',
  status: 'open',
  owner: 'human',
  openedAt: at(16, 17),
  questions: [
    {
      id: 'approach',
      label: 'Which approach should the plan take?',
      multi: false,
      options: [
        { value: 'server', label: 'Server-side filter (Recommended)' },
        { value: 'client', label: 'Client-side filter' },
        { value: 'both', label: 'Both, behind a flag' },
      ],
    },
    { id: 'scope', label: 'Scope?', multi: false, options: ['Small', 'Big'] },
  ],
  answer: null,
  origin: null,
} as unknown as GateRow;
