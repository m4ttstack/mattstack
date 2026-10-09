// @vitest-environment node
import type { GateRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { ATTENTION_MIN_AGE_MS, countsForConsoleBadge } from './gate-waiting';

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
    context: null,
    origin: null,
    ...overrides,
  } as GateRow;
}

describe('countsForConsoleBadge', () => {
  const now = 10_000_000;

  it('counts open and parked run gates Matt owns', () => {
    expect(countsForConsoleBadge(row(), now)).toBe(true);
    expect(countsForConsoleBadge(row({ status: 'parked' }), now)).toBe(true);
  });
  it('never counts herd-owned, answered, or non-run gates', () => {
    expect(countsForConsoleBadge(row({ owner: 'herd:h1' }), now)).toBe(false);
    expect(countsForConsoleBadge(row({ status: 'answered' }), now)).toBe(false);
    expect(countsForConsoleBadge(row({ subject: 'mr:https://x' }), now)).toBe(
      false
    );
  });
  it('excludes a young pane-attention gate', () => {
    const openedAt = now - (ATTENTION_MIN_AGE_MS - 1);
    expect(
      countsForConsoleBadge(row({ kind: 'pane-attention', openedAt }), now)
    ).toBe(false);
  });
  it('counts a pane-attention gate at exactly 2 minutes old', () => {
    const openedAt = now - ATTENTION_MIN_AGE_MS;
    expect(
      countsForConsoleBadge(row({ kind: 'pane-attention', openedAt }), now)
    ).toBe(true);
  });
});
