import { describe, expect, test } from 'bun:test';

import { ASK_HISTORY_MS, buildAskInbox } from '../peer/ask-inbox.ts';
import type { NudgeState } from '../peer/nudges.ts';

const ask = (id: string, over: Partial<NudgeState> = {}): NudgeState => ({
  id,
  mrUrl: `https://x/mr/${id}`,
  iid: 1,
  from: 'rae',
  receivedAt: 100,
  ...over,
});

describe('buildAskInbox', () => {
  test('waiting asks oldest first, kind defaults to re-review', () => {
    const { pending } = buildAskInbox(
      [ask('b', { receivedAt: 200, kind: 'review' }), ask('a')],
      300
    );
    expect(pending.map(p => [p.id, p.kind])).toEqual([
      ['a', 're-review'],
      ['b', 'review'],
    ]);
  });

  test('handled asks are history, newest first, inside 14 days', () => {
    const now = 10 * ASK_HISTORY_MS;
    const { pending, history } = buildAskInbox(
      [
        ask('old', {
          handled: { at: now - ASK_HISTORY_MS - 1, result: 'launched' },
        }),
        ask('x', {
          handled: {
            at: now - 10,
            result: 'rejected',
            reason: 'busy right now',
            note: 'later',
          },
        }),
        ask('y', {
          handled: { at: now - 5, result: 'expired', reason: 'stale' },
        }),
      ],
      now
    );
    expect(pending).toEqual([]);
    expect(history.map(h => h.id)).toEqual(['y', 'x']);
    expect(history[1]?.handled).toEqual({
      at: now - 10,
      result: 'rejected',
      reason: 'busy right now',
      note: 'later',
    });
  });

  test('a view carries what the card shows', () => {
    const { pending } = buildAskInbox(
      [
        ask('a', {
          title: 'debounce the claim search',
          sourceBranch: 'acme-1388-x',
          note: 'retry path',
        }),
      ],
      300
    );
    expect(pending[0]).toMatchObject({
      title: 'debounce the claim search',
      sourceBranch: 'acme-1388-x',
      note: 'retry path',
      from: 'rae',
    });
  });
});
