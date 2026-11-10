import type { GateRow } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import {
  agedLabel,
  isExpired,
  leftLabel,
  personaTrigger,
  SLACK_GATE_TTL_MS,
  slackGateView,
} from './slack-gate';

const MIN = 60_000;

function gate(overrides: Partial<GateRow> = {}): GateRow {
  return {
    id: 'g1',
    subject: 'slack:U1',
    kind: 'slack-open',
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

describe('slackGateView', () => {
  it('reads a new chat: person, requester brief and the pane that asked', () => {
    const view = slackGateView(
      gate({
        pane: 'w1-2',
        context: 'Person: Priya Raman\n\nBrief:\nNeed a second pair of eyes.',
        meta: {
          action: 'open',
          person: 'U1',
          personName: 'Priya Raman',
          brief: 'Need a second pair of eyes.',
          requesterHandle: 'refund-fix',
        },
      })
    );
    expect(view).toMatchObject({
      kind: 'new',
      name: 'Priya Raman',
      brief: 'Need a second pair of eyes.',
      origin: { from: 'pane', pane: 'w1-2' },
    });
  });

  it("shows a teammate's new chat request by their message, not the operator brief", () => {
    const view = slackGateView(
      gate({
        context: 'Person: Dana\n\nMessage:\n@Maude the export hangs',
        meta: {
          action: 'open',
          person: 'U2',
          personName: 'Dana',
          brief:
            'Dana asked for help over Slack with @Maude. Their message arrives first.',
          triggerTs: '1730000000.000100',
        },
      })
    );
    expect(view).toMatchObject({
      kind: 'new',
      brief: '@Maude the export hangs',
      origin: { from: 'teammate' },
    });
  });

  it("keeps a pane's request as the pane's when a teammate's message joined it", () => {
    const view = slackGateView(
      gate({
        pane: 'w1-2',
        context: 'Person: Dana\n\nBrief:\nExport hangs.\n\nThen:\n@Maude hello',
        meta: {
          action: 'open',
          person: 'U2',
          personName: 'Dana',
          brief: 'Export hangs.',
          appendedTriggerTs: '1730000000.000100',
        },
      })
    );
    expect(view).toMatchObject({
      brief: 'Export hangs.',
      origin: { from: 'pane', pane: 'w1-2' },
    });
  });

  it('reads a resume with a trigger as the teammate asking', () => {
    const view = slackGateView(
      gate({
        context:
          'Person: Dana\n\nMessage:\nBack on this.\n\nThen:\nStill failing.',
        meta: {
          action: 'resume',
          person: 'U2',
          personName: 'Dana',
          triggerTs: '1730000000.000100',
          requesterHandle: 'refund-fix',
        },
      })
    );
    expect(view).toMatchObject({
      kind: 'resume',
      brief: 'Back on this.\n\nThen:\nStill failing.',
      origin: { from: 'teammate' },
    });
  });

  it('reads a resume with no trigger as a pane asking', () => {
    const view = slackGateView(
      gate({
        pane: 'w1-5',
        context: 'Person: Mei\n\nAn agent asked to pick this chat back up.',
        meta: {
          action: 'resume',
          person: 'U3',
          personName: 'Mei',
          triggerTs: null,
        },
      })
    );
    expect(view).toMatchObject({
      kind: 'resume',
      brief: 'An agent asked to pick this chat back up.',
      origin: { from: 'pane', pane: 'w1-5' },
    });
  });

  it('falls back to the requester handle, then to no origin', () => {
    expect(
      slackGateView(
        gate({
          meta: { action: 'open', personName: 'A', requesterHandle: 'agent-x' },
        })
      ).origin
    ).toEqual({ from: 'handle', handle: 'agent-x' });
    expect(
      slackGateView(gate({ meta: { action: 'open', personName: 'A' } })).origin
    ).toBeNull();
  });

  it('names the person from the subject when meta has no name', () => {
    expect(slackGateView(gate({ subject: 'slack:U9' })).name).toBe('U9');
  });

  it('expires 30 minutes after it opened', () => {
    expect(slackGateView(gate({ openedAt: 5 * MIN })).expiresAt).toBe(
      5 * MIN + SLACK_GATE_TTL_MS
    );
  });
});

describe('ages', () => {
  it('counts whole minutes old', () => {
    expect(agedLabel(0, 4 * MIN + 30_000)).toBe('4m old');
    expect(agedLabel(0, 0)).toBe('0m old');
  });

  it('counts minutes left, never below zero, and warns under five', () => {
    expect(leftLabel(30 * MIN, 4 * MIN)).toEqual({
      text: '26m left',
      urgent: false,
    });
    expect(leftLabel(30 * MIN, 27 * MIN)).toEqual({
      text: '3m left',
      urgent: true,
    });
    expect(leftLabel(30 * MIN, 31 * MIN)).toEqual({
      text: '0m left',
      urgent: true,
    });
  });
});

describe('personaTrigger', () => {
  it('is the trigger when set, else the name after an @', () => {
    expect(personaTrigger({ name: 'Maude' }, ' hey bot ')).toBe(
      'hey bot'
    );
    expect(personaTrigger({ name: 'Otto' })).toBe('@Otto');
    expect(personaTrigger({ name: 'Otto' }, '  ')).toBe('@Otto');
  });
});

describe('isExpired', () => {
  it('is true from the moment the gate expires', () => {
    expect(isExpired({ expiresAt: 10 }, 9)).toBe(false);
    expect(isExpired({ expiresAt: 10 }, 10)).toBe(true);
  });
});
