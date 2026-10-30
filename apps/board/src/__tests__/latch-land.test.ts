import { afterAll, describe, expect, test } from 'bun:test';

import type { MRDetail } from '@mattstack/glance';
import {
  countNewDiscussions,
  fetchNewDiscussionCount,
  landFollowUp,
  type LandInput,
} from '../latch/land.ts';
import {
  putLatchRow,
  readLatchRow,
  type LatchRow,
} from '../latch/latch-state.ts';
import { armedLatchBody, latchBody } from '../latch/markers.ts';
import type { LatchGateway } from '../latch/post.ts';
import { copyFor, variantOfKey } from '../latch/variants.ts';
import { removeTempDbs, tempDb } from './latch-temp-db.ts';

afterAll(removeTempDbs);

const NOW = 2_000_000;
const MR = 'https://gitlab.com/acme/web/-/merge_requests/2317';
const IMG = '![re-review latch](/uploads/ab12/latch-2317.png)';
const ARMED = '<!-- mattstack:board re-review-latch v1 -->';
const SPENT = '<!-- mattstack:board re-review-latch v1 spent -->';

function row(over: Partial<LatchRow> = {}): LatchRow {
  return {
    mrUrl: MR,
    discussionId: 'd1',
    rootNoteId: 1,
    phase: 'running',
    wait: null,
    launchAt: 1_000,
    failures: 2,
    stuck: false,
    variant: 'running',
    replyDue: null,
    updatedAt: 1,
    ...over,
  };
}

function harness(
  over: Partial<LandInput> = {},
  stored: LatchRow | null = row()
) {
  const db = tempDb();
  if (stored) putLatchRow(stored, db);
  const calls: string[] = [];
  const uploads: string[] = [];
  const replies: string[] = [];
  const noteBodies = new Map<number, string>();
  let counted = 0;
  const gateway: LatchGateway = {
    async uploadFile(_p, filename) {
      calls.push('upload');
      uploads.push(filename);
      return { alt: '', url: '', full_path: '', markdown: IMG };
    },
    async createDiscussion() {
      calls.push('createDiscussion');
      return { id: 'new', notes: [{ id: 1 }] };
    },
    async updateNote(_p, _i, id, body) {
      calls.push(`updateNote:${id}`);
      noteBodies.set(id, body);
    },
    async resolveDiscussion(_p, _i, id) {
      calls.push(`resolve:${id}`);
    },
    async unresolveDiscussion(_p, _i, id) {
      calls.push(`unresolve:${id}`);
    },
    async createNote(_p, _i, body, d) {
      calls.push(`reply:${d}`);
      replies.push(body);
      return { id: 9 };
    },
  };
  const input: LandInput = {
    target: {
      projectId: 42,
      projectPath: 'acme/web',
      iid: 2317,
      mrUrl: MR,
      discussionId: 'd1',
      rootNoteId: 1,
    },
    outcome: 'comment',
    reviewRunStartedAt: 1_500,
    gateway,
    self: 'matt',
    countNew: async () => {
      counted++;
      return 3;
    },
    now: NOW,
    ...over,
  };
  return {
    db,
    input,
    calls,
    uploads,
    replies,
    noteBodies,
    land: () => landFollowUp(input, db),
    counted: () => counted,
  };
}

describe('landFollowUp', () => {
  test('comment lands as done-comments with the count and reopens', async () => {
    const h = harness();
    expect(await h.land()).toBe('landed');
    expect(h.uploads).toEqual(['latch-2317-done-comments-3.gif']);
    expect(h.calls).toEqual([
      'upload',
      'updateNote:1',
      'unresolve:d1',
      'reply:d1',
    ]);
    expect(h.noteBodies.get(1)).toStartWith(ARMED);
    expect(h.replies).toEqual(['Follow-up review done: 3 new comments.']);
    expect(readLatchRow(MR, h.db)).toMatchObject({
      phase: 'armed',
      failures: 0,
      stuck: false,
      wait: null,
      launchAt: null,
      variant: 'done-comments-3',
      replyDue: null,
      updatedAt: NOW,
    });
  });

  test('a reply that fails to post is still owed, and the approval still spends the extras', async () => {
    const h = harness({
      outcome: 'approve',
      latches: [
        {
          discussionId: 'd2',
          rootNoteId: 2,
          kind: 'armed',
          resolved: false,
          createdAt: '',
          body: '',
        },
      ],
    });
    h.input.gateway.createNote = async () => {
      throw new Error('gitlab 500');
    };
    expect(await h.land()).toBe('landed');
    expect(h.calls).toContain('updateNote:2');
    expect(readLatchRow(MR, h.db)).toMatchObject({
      phase: 'spent',
      replyDue: 'Follow-up review done: approved.',
    });
  });

  test('an abandoned landing owes no reply', async () => {
    const h = harness({ outcome: null });
    expect(await h.land()).toBe('landed');
    expect(h.replies).toEqual([]);
    expect(readLatchRow(MR, h.db)?.replyDue).toBeNull();
  });

  test('one new comment reads singular', async () => {
    const h = harness({ countNew: async () => 1 });
    await h.land();
    expect(h.replies).toEqual(['Follow-up review done: 1 new comment.']);
  });

  test('count null shows Review posted', async () => {
    const h = harness({ countNew: async () => null });
    expect(await h.land()).toBe('landed');
    expect(h.uploads).toEqual(['latch-2317-done-comments-none.gif']);
    const variant = variantOfKey(readLatchRow(MR, h.db)!.variant!);
    expect(copyFor(variant!).sub).toBe('Review posted. Resolve when ready');
    expect(h.replies).toEqual(['Follow-up review done.']);
  });

  test('a count of zero also replies without a number', async () => {
    const h = harness({ countNew: async () => 0 });
    await h.land();
    expect(h.uploads).toEqual(['latch-2317-done-comments-none.gif']);
    expect(h.replies).toEqual(['Follow-up review done.']);
  });

  test('approve spends with done-approved and one reply', async () => {
    const h = harness({ outcome: 'approve' });
    expect(await h.land()).toBe('landed');
    expect(h.uploads).toEqual(['latch-2317-done-approved.gif']);
    expect(h.calls).toEqual([
      'upload',
      'updateNote:1',
      'resolve:d1',
      'reply:d1',
    ]);
    expect(h.noteBodies.get(1)).toStartWith(SPENT);
    expect(h.replies).toEqual(['Follow-up review done: approved.']);
    expect(h.counted()).toBe(0);
    expect(readLatchRow(MR, h.db)).toMatchObject({
      phase: 'spent',
      variant: 'done-approved',
    });
  });

  test('abandoned review re-arms quietly', async () => {
    const h = harness({ outcome: null });
    expect(await h.land()).toBe('landed');
    expect(h.uploads).toEqual(['latch-2317-armed.gif']);
    expect(h.calls).toEqual(['upload', 'updateNote:1', 'unresolve:d1']);
    expect(h.noteBodies.get(1)).toStartWith(ARMED);
    expect(h.replies).toEqual([]);
    expect(h.counted()).toBe(0);
    expect(readLatchRow(MR, h.db)).toMatchObject({
      phase: 'armed',
      wait: null,
      launchAt: null,
      stuck: false,
      variant: 'armed',
    });
  });

  test('landFollowUp is idempotent across server and pass', async () => {
    const h = harness();
    expect(await h.land()).toBe('landed');
    expect(await h.land()).toBe('none');
    expect(h.calls.filter(c => c.startsWith('updateNote'))).toHaveLength(1);
    expect(h.replies).toHaveLength(1);
    expect(h.counted()).toBe(1);
  });

  // The server's signal and the pass overlap: B lands while A waits on its
  // GitLab count, and A's move then finds the row already armed.
  test('an interleaved second landing writes nothing', async () => {
    const h = harness();
    const b: string[] = [];
    h.input.countNew = async () => {
      b.push(await landFollowUp({ ...h.input, countNew: async () => 3 }, h.db));
      return 3;
    };
    expect(await h.land()).toBe('none');
    expect(b).toEqual(['landed']);
    expect(h.calls.filter(c => c.startsWith('updateNote'))).toHaveLength(1);
    expect(h.replies).toEqual(['Follow-up review done: 3 new comments.']);
  });

  test('a review whose runStartedAt is before launchAt does not land', async () => {
    const h = harness({ reviewRunStartedAt: 999 });
    expect(await h.land()).toBe('not-mine');
    expect(h.calls).toEqual([]);
    expect(readLatchRow(MR, h.db)).toEqual(row());
  });

  test('a spent row never lands', async () => {
    const spent = row({ phase: 'spent', variant: 'approved' });
    const h = harness({}, spent);
    expect(await h.land()).toBe('none');
    expect(h.calls).toEqual([]);
    expect(readLatchRow(MR, h.db)).toEqual(spent);
  });

  test('an error row with no launch stamp never lands', async () => {
    const failedFirst = row({ phase: 'error', launchAt: null, failures: 1 });
    const h = harness({ reviewRunStartedAt: NOW }, failedFirst);
    expect(await h.land()).toBe('not-mine');
    expect(h.calls).toEqual([]);
    expect(readLatchRow(MR, h.db)).toEqual(failedFirst);
  });

  test('a stuck error row whose review finished lands and clears stuck', async () => {
    const stuck = row({
      phase: 'error',
      failures: 3,
      stuck: true,
      variant: 'error-stuck',
    });
    const h = harness({}, stuck);
    expect(await h.land()).toBe('landed');
    expect(readLatchRow(MR, h.db)).toMatchObject({
      phase: 'armed',
      failures: 0,
      stuck: false,
    });
  });

  // The abandoned run consumed the request, so the next one is a new cycle.
  test('an abandoned review resets the failure count', async () => {
    const h = harness({ outcome: null });
    await h.land();
    expect(readLatchRow(MR, h.db)?.failures).toBe(0);
  });

  test('an approve landing spends the other copies approved', async () => {
    const extra = {
      discussionId: 'extra',
      rootNoteId: 2,
      kind: 'armed' as const,
      resolved: false,
      createdAt: '2026-09-01T10:00:00Z',
      body: armedLatchBody(IMG),
    };
    const self = {
      ...extra,
      discussionId: 'd1',
      rootNoteId: 1,
      kind: 'running' as const,
    };
    const h = harness({ outcome: 'approve', latches: [self, extra] });
    expect(await h.land()).toBe('landed');
    expect(h.uploads).toEqual([
      'latch-2317-done-approved.gif',
      'latch-2317-approved.gif',
    ]);
    expect(h.calls).toEqual([
      'upload',
      'updateNote:1',
      'resolve:d1',
      'reply:d1',
      'upload',
      'updateNote:2',
      'resolve:extra',
    ]);
    expect(h.noteBodies.get(2)).toStartWith(SPENT);
  });

  test('a row tracking another latch is not this one to land', async () => {
    const h = harness({}, row({ discussionId: 'other' }));
    expect(await h.land()).toBe('not-mine');
    expect(h.calls).toEqual([]);
  });

  test('no row lands nothing', async () => {
    const h = harness({}, null);
    expect(await h.land()).toBe('none');
    expect(h.calls).toEqual([]);
  });
});

describe('countNewDiscussions', () => {
  function disc(
    id: string,
    body: string,
    author: string,
    createdAt: string,
    system = false
  ) {
    return {
      id,
      resolvable: true,
      resolved: false,
      notes: [
        {
          id: 1,
          body,
          author: { id: 1, username: author, name: author, avatarUrl: null },
          createdAt,
          system,
          type: 'DiscussionNote',
          resolvable: true,
          resolved: false,
          position: null,
        },
      ],
    };
  }
  const launchAt = Date.parse('2026-09-01T10:00:00Z');

  test("counts the reviewer's own threads opened at or after the launch", () => {
    const detail = {
      mrIid: 2317,
      repositoryId: 'gitlab:42',
      discussions: [
        disc('a', 'Rename this', 'Matt', '2026-09-01T10:00:00Z'),
        disc('b', 'Missing test', 'matt', '2026-09-01T10:05:00Z'),
        disc('c', 'Older thread', 'matt', '2026-09-01T09:59:59Z'),
        disc('d', 'Not mine', 'lee', '2026-09-01T10:05:00Z'),
        disc(
          'e',
          latchBody('running', IMG, 'x'),
          'matt',
          '2026-09-01T10:05:00Z'
        ),
        disc('f', armedLatchBody(IMG), 'matt', '2026-09-01T10:06:00Z'),
        disc('g', 'added 1 commit', 'matt', '2026-09-01T10:06:00Z', true),
      ],
    } as unknown as MRDetail;
    expect(countNewDiscussions(detail, 'matt', launchAt)).toBe(2);
  });

  test('fetchNewDiscussionCount counts a fresh read the same way', async () => {
    const detail = {
      mrIid: 2317,
      repositoryId: 'gitlab:42',
      discussions: [
        disc('a', 'Rename this', 'matt', '2026-09-01T10:01:00Z'),
        disc('b', armedLatchBody(IMG), 'matt', '2026-09-01T10:02:00Z'),
        disc('c', 'Before launch', 'matt', '2026-09-01T09:00:00Z'),
      ],
    } as unknown as MRDetail;
    expect(
      await fetchNewDiscussionCount(async () => detail, 'matt', launchAt)
    ).toBe(1);
  });

  test('fetchNewDiscussionCount is null when the read fails', async () => {
    const failing = async (): Promise<MRDetail> => {
      throw new Error('gitlab down');
    };
    expect(await fetchNewDiscussionCount(failing, 'matt', launchAt)).toBeNull();
  });
});
