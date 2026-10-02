import { describe, expect, test } from 'bun:test';

import type { SentNudgeInfo } from '../../types.ts';
import { askBandModel } from '../ask-band.ts';

const NOW = 10_000_000_000;
const MIN = 60_000;

const sent = (over: Partial<SentNudgeInfo>): SentNudgeInfo => ({
  display: 'requested',
  reviewer: 'grace',
  sentAt: NOW - 3 * 60 * MIN,
  ...over,
});

describe('askBandModel', () => {
  test('requested: neutral, no action', () => {
    expect(askBandModel(sent({ kind: 're-review' }))).toEqual({
      tone: 'neutral',
      icon: 'send',
      name: 'Grace',
      who: "Grace's agent",
      title: 'Re-review from Grace',
      label: 're-review requested',
      note: `Sent ${new Date(NOW - 3 * 60 * MIN).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })}`,
      actions: [],
      steps: [{ name: 'Requested', detail: 'you', at: NOW - 3 * 60 * MIN }],
    });
  });

  test('only a pending ask carries the sent-time note', () => {
    for (const display of ['launched', 'done', 'failed', 'rejected'] as const)
      expect(askBandModel(sent({ display })).note).toBeUndefined();
  });

  test('words each ask kind', () => {
    expect(askBandModel(sent({ kind: 'review' })).label).toBe(
      'review requested'
    );
    expect(askBandModel(sent({ kind: 'respond' })).label).toBe(
      'response requested'
    );
    expect(askBandModel(sent({})).label).toBe('re-review requested');
  });

  test('confirmed and launched read as running, work tone, no action', () => {
    for (const display of ['confirmed', 'launched'] as const) {
      const m = askBandModel(
        sent({ display, kind: 'review', resolvedAt: NOW - 12 * MIN })
      );
      expect(m).toMatchObject({
        tone: 'work',
        icon: 'loader',
        label: 'reviewing',
      });
      expect(m.actions).toEqual([]);
    }
    expect(askBandModel(sent({ display: 'launched' })).label).toBe(
      're-reviewing'
    );
    expect(
      askBandModel(sent({ display: 'launched', kind: 'respond' })).label
    ).toBe('responding');
  });

  test('done: ok tone, the verdict, a dismiss action', () => {
    const m = askBandModel(
      sent({
        display: 'done',
        kind: 're-review',
        outcome: 'comment',
        finishedAt: NOW - 60 * MIN,
      })
    );
    expect(m).toMatchObject({
      tone: 'ok',
      icon: 'check',
      label: 're-reviewed: comments',
      actions: ['dismiss'],
    });
  });

  test('done verdict words', () => {
    const word = (outcome?: string, kind?: SentNudgeInfo['kind']) =>
      askBandModel(sent({ display: 'done', kind, outcome, finishedAt: NOW }))
        .label;
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
      })
    );
    expect(m).toMatchObject({
      tone: 'bad',
      icon: 'triangle-alert',
      label: 'failed to run: boom',
      actions: ['retry', 'dismiss'],
    });
    expect(
      askBandModel(sent({ display: 'failed', finishedAt: NOW })).label
    ).toBe('failed to run');
  });

  test('rejected: bad tone with the peer reason, retry', () => {
    const m = askBandModel(
      sent({ display: 'rejected', reason: 'busy', sentAt: NOW })
    );
    expect(m).toMatchObject({
      tone: 'bad',
      label: 'declined: busy',
      actions: ['retry', 'dismiss'],
    });
    expect(askBandModel(sent({ display: 'rejected' })).label).toBe('declined');
  });

  test('no answer: warn tone, retry; expired reads the same', () => {
    for (const display of ['no-response', 'expired'] as const) {
      expect(askBandModel(sent({ display }))).toMatchObject({
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
      })
    );
    expect(m.steps).toEqual([
      { name: 'Requested', detail: 'you', at: NOW - 3 * 60 * MIN },
      { name: 'Finished', detail: 'reviewed: approved', at: NOW - 60 * MIN },
    ]);
    const running = askBandModel(
      sent({ display: 'confirmed', resolvedAt: NOW - 10 * MIN })
    );
    expect(running.steps.map(s => s.name)).toEqual(['Requested', 'Started']);
    expect(running.steps[1]).toMatchObject({
      detail: "Grace's agent",
      at: NOW - 10 * MIN,
    });
  });

  test("names the teammate by the roster's first name when it has one", () => {
    const m = askBandModel(
      sent({ reviewer: 'ghop2', reviewerName: 'Grace Hopper' })
    );
    expect(m.name).toBe('Grace');
    expect(m.who).toBe("Grace's agent");
    expect(m.title).toBe('Re-review from Grace');
    expect(askBandModel(sent({ reviewer: 'ghop2' })).name).toBe('Ghop2');
  });

  test('the trail titles the ask and names the teammate', () => {
    expect(askBandModel(sent({ kind: 'respond' })).title).toBe(
      'Response from Grace'
    );
    expect(askBandModel(sent({ kind: 'review' })).title).toBe(
      'Review from Grace'
    );
  });
});
