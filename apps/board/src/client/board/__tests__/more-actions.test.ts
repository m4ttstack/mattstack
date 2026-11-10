import { describe, expect, test } from 'bun:test';

import type { BoardMRWithReview } from '../../types.ts';
import { heldOrder, moreAction, moreKey } from '../more-actions.ts';
import type { Candidate } from '../row-status.ts';

function mr(over: Partial<BoardMRWithReview> = {}): BoardMRWithReview {
  return { iid: 1, ...over } as unknown as BoardMRWithReview;
}

const line = (verbs: Candidate['verbs'], over: Partial<Candidate> = {}) =>
  ({ tone: 'go', word: 'w', verbs, ...over }) as Candidate;

describe('moreAction', () => {
  test('a look-only verb is a whole-line click', () => {
    const a = moreAction(
      line([{ kind: 'focus', label: 'focus', domain: 'respond' }]),
      mr({ respond: { status: 'implementing' } } as never)
    );
    expect(a).toMatchObject({ verb: { kind: 'focus' }, launches: false });
  });

  test('merge never shows; a line with only merge offers nothing', () => {
    expect(moreAction(line([{ kind: 'merge', label: 'merge' }]), mr())).toBe(
      null
    );
  });

  test('a launch on a quiet MR launches, from the action only', () => {
    const a = moreAction(
      line([{ kind: 'call-doctor', label: 'call doctor' }]),
      mr()
    );
    expect(a).toMatchObject({ verb: { kind: 'call-doctor' }, launches: true });
  });

  test('a launch while another lane works is hidden', () => {
    const a = moreAction(
      line([{ kind: 'call-doctor', label: 'call doctor' }]),
      mr({ respond: { status: 'implementing' } } as never)
    );
    expect(a).toBe(null);
  });

  test('a launch on its own running lane says focus, since that is all it does', () => {
    const a = moreAction(
      line([{ kind: 'launch-respond', label: 'respond' }]),
      mr({ respond: { status: 'implementing' } } as never)
    );
    expect(a).toMatchObject({
      verb: { kind: 'focus', label: 'focus', domain: 'respond' },
      launches: false,
    });
  });

  test('a lane whose pane died is not at work, so its redo still launches', () => {
    const a = moreAction(
      line([{ kind: 'redo', label: 'redo', domain: 'respond' }]),
      mr({
        respond: { status: 'implementing', sessionId: 's1' },
        orphan: { state: 'gone', sessionId: 's1' },
      } as never)
    );
    expect(a).toMatchObject({ verb: { kind: 'redo' }, launches: true });
  });
});

describe('heldOrder', () => {
  const a = line([], { source: 'Respond', word: 'implementing…' });
  const b = line([], { source: 'Doctor', word: 'watching CI…' });
  const c = line([], { source: 'Review', word: 'review ready' });

  test('keeps the order the list opened with when a poll re-ranks it', () => {
    const order = [a, b, c].map(moreKey);
    expect(heldOrder([c, b, a], order)).toEqual([a, b, c]);
  });

  test('a line that arrived since goes last; a resolved one drops out', () => {
    const order = [a, b].map(moreKey);
    expect(heldOrder([c, b], order)).toEqual([b, c]);
  });
});
