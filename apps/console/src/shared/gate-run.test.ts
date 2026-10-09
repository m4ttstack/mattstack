// @vitest-environment node
import type { GateRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { runIdOfGate } from './gate-run';

function row(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'g1',
    subject: 'run:r1',
    kind: 'self-review',
    questions: [],
    meta: null,
    status: 'open',
    answer: null,
    openedAt: 0,
    parkedAt: null,
    closedAt: null,
    closedReason: null,
    agent: null,
    pane: null,
    nudge: null,
    delivery: null,
    released: false,
    supersededBy: null,
    owner: null,
    escalatedAt: null,
    consumedAt: null,
    ...overrides,
  };
}

describe('runIdOfGate', () => {
  it('reads the id off a run: subject', () => {
    expect(runIdOfGate(row({ subject: 'run:r1' }))).toBe('r1');
  });

  it('prefers the run: subject over an origin run', () => {
    expect(
      runIdOfGate(row({ subject: 'run:r1', origin: { runId: 'r2' } }))
    ).toBe('r1');
  });

  it('reads origin.runId on an mr: subject', () => {
    expect(
      runIdOfGate(row({ subject: 'mr:acme/web!412', origin: { runId: 'r1' } }))
    ).toBe('r1');
  });

  it('is null with neither', () => {
    expect(runIdOfGate(row({ subject: 'mr:acme/web!412' }))).toBeNull();
    expect(
      runIdOfGate(row({ subject: 'herd:alpha', origin: { paneId: 'p1' } }))
    ).toBeNull();
  });
});
