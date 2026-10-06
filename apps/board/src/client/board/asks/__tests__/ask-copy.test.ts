import { describe, expect, test } from 'bun:test';
import { askedPhrase, confirmLine, firstName, historyOutcome, verbLabel, verbLane } from '../ask-copy.ts';

describe('ask copy', () => {
  test('phrases and verbs per kind', () => {
    expect([askedPhrase('review'), askedPhrase('re-review'), askedPhrase('respond')]).toEqual([
      'asked for a review', 'asked for a re-review', 'asked your agent to respond',
    ]);
    expect([verbLabel('review'), verbLabel('re-review'), verbLabel('respond')]).toEqual(['Review', 'Re-review', 'Respond']);
    expect([verbLane('re-review'), verbLane('respond')]).toEqual(['review', 'respond']);
  });
  test('first name from the roster name, else the username capitalized', () => {
    expect(firstName('Rae Marlow', 'rae')).toBe('Rae');
    expect(firstName(undefined, 'tom')).toBe('Tom');
  });
  test('history outcome words follow the spec table', () => {
    const h = (handled: object, kind = 'review') => historyOutcome({ kind, handled: { at: 0, ...handled } } as never);
    expect(h({ result: 'launched', reason: 'accepted' })).toEqual({ text: 'reviewed', tone: 'ok' });
    expect(h({ result: 'launched', reason: 'accepted' }, 're-review')).toEqual({ text: 're-reviewed', tone: 'ok' });
    expect(h({ result: 'launched', reason: 'accepted' }, 'respond')).toEqual({ text: 'responded', tone: 'ok' });
    expect(h({ result: 'launched', reason: 'always-allowed' })).toEqual({ text: 'reviewed · always allowed', tone: 'ok' });
    expect(h({ result: 'launched' })).toEqual({ text: 'reviewed', tone: 'ok' });
    expect(h({ result: 'rejected', declined: true, reason: 'busy right now' })).toEqual({ text: 'declined: busy right now', tone: 'quiet' });
    expect(h({ result: 'rejected', declined: true })).toEqual({ text: 'declined', tone: 'quiet' });
    expect(h({ result: 'rejected', reason: 'review-in-flight', reasonText: 'A review is already running' })).toEqual({ text: 'skipped: a review is already running', tone: 'quiet' });
    expect(h({ result: 'expired', reason: 'stale' })).toEqual({ text: 'expired, no answer in 48h', tone: 'warn' });
  });
  test('the brief confirm line', () => {
    expect(confirmLine('review', 1388)).toBe('Your agent is reviewing !1388');
    expect(confirmLine('respond', 1366)).toBe('Your agent is responding on !1366');
  });
});
