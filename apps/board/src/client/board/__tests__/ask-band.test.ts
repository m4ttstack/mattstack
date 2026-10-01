import { describe, expect, test } from 'bun:test';

import type { SentNudgeInfo } from '../../types.ts';
import { askBandModel } from '../ask-band.ts';

const NOW = 10_000_000_000;
const MIN = 60_000;

const sent = (over: Partial<SentNudgeInfo>): SentNudgeInfo => ({
  display: 'requested',
  reviewer: 'leath',
  sentAt: NOW - 3 * 60 * MIN,
  ...over,
});

describe('askBandModel', () => {
  test('requested: neutral, no action, age since sent', () => {
    expect(askBandModel(sent({ kind: 're-review' }), NOW)).toEqual({
      tone: 'neutral',
      icon: 'send',
      who: "leath's agent",
      label: 're-review requested',
      age: '3h',
      actions: [],
      trail: ['requested 3h ago'],
    });
  });

  test('words each ask kind', () => {
    expect(askBandModel(sent({ kind: 'review' }), NOW).label).toBe(
      'review requested'
    );
    expect(askBandModel(sent({ kind: 'respond' }), NOW).label).toBe(
      'response requested'
    );
    expect(askBandModel(sent({}), NOW).label).toBe('re-review requested');
  });

  test('confirmed and launched read as running, work tone, no action', () => {
    for (const display of ['confirmed', 'launched'] as const) {
      const m = askBandModel(
        sent({ display, kind: 'review', resolvedAt: NOW - 12 * MIN }),
        NOW
      );
      expect(m).toMatchObject({
        tone: 'work',
        icon: 'loader',
        label: 'reviewing',
        age: '12m',
      });
      expect(m.actions).toEqual([]);
    }
    expect(askBandModel(sent({ display: 'launched' }), NOW).label).toBe(
      're-reviewing'
    );
    expect(
      askBandModel(sent({ display: 'launched', kind: 'respond' }), NOW).label
    ).toBe('responding');
  });

  test('done: ok tone, the verdict, a dismiss action', () => {
    const m = askBandModel(
      sent({
        display: 'done',
        kind: 're-review',
        outcome: 'comment',
        finishedAt: NOW - 60 * MIN,
      }),
      NOW
    );
    expect(m).toMatchObject({
      tone: 'ok',
      icon: 'check',
      label: 're-reviewed: comments',
      age: '1h ago',
      actions: ['dismiss'],
    });
  });

  test('done verdict words', () => {
    const word = (outcome?: string, kind?: SentNudgeInfo['kind']) =>
      askBandModel(
        sent({ display: 'done', kind, outcome, finishedAt: NOW }),
        NOW
      ).label;
    expect(word('approve', 'review')).toBe('reviewed: approved');
    expect(word('comment', 'review')).toBe('reviewed: comments');
    expect(word(undefined, 'respond')).toBe('responded');
    expect(word(undefined)).toBe('re-reviewed');
  });

  test('failed: bad tone, retry, the reason when there is one', () => {
    const m = askBandModel(
      sent({
        display: 'failed',
        reason: 'boom',
        finishedAt: NOW - 20 * MIN,
      }),
      NOW
    );
    expect(m).toMatchObject({
      tone: 'bad',
      icon: 'triangle-alert',
      label: 'failed to run: boom',
      age: '20m ago',
      actions: ['retry', 'dismiss'],
    });
    expect(
      askBandModel(sent({ display: 'failed', finishedAt: NOW }), NOW).label
    ).toBe('failed to run');
  });

  test('rejected: bad tone with the peer reason, retry', () => {
    const m = askBandModel(
      sent({ display: 'rejected', reason: 'busy', sentAt: NOW }),
      NOW
    );
    expect(m).toMatchObject({
      tone: 'bad',
      label: 'declined: busy',
      actions: ['retry', 'dismiss'],
    });
    expect(askBandModel(sent({ display: 'rejected' }), NOW).label).toBe(
      'declined'
    );
  });

  test('no answer: warn tone, retry; expired reads the same', () => {
    for (const display of ['no-response', 'expired'] as const) {
      expect(askBandModel(sent({ display }), NOW)).toMatchObject({
        tone: 'warn',
        icon: 'hourglass',
        label: 'no answer',
        actions: ['retry', 'dismiss'],
      });
    }
  });

  test('the trail lists what the row knows, oldest first', () => {
    const m = askBandModel(
      sent({
        display: 'done',
        kind: 'review',
        outcome: 'approve',
        resolvedAt: NOW - 60 * MIN,
        finishedAt: NOW - 60 * MIN,
      }),
      NOW
    );
    expect(m.trail).toEqual([
      'requested 3h ago',
      'finished 1h ago: reviewed: approved',
    ]);
    const running = askBandModel(
      sent({ display: 'confirmed', resolvedAt: NOW - 10 * MIN }),
      NOW
    );
    expect(running.trail).toEqual([
      'requested 3h ago',
      'started 10m ago',
    ]);
  });
});
