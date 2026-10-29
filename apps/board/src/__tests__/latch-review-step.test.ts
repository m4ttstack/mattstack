import { afterAll, describe, expect, test } from 'bun:test';

import type { MRDetail } from '@mattstack/glance';
import {
  putLatchRow,
  readLatchRow,
  type LatchRow,
} from '../latch/latch-state.ts';
import { armedLatchBody, latchBody, spentLatchBody } from '../latch/markers.ts';
import type { LatchGateway } from '../latch/post.ts';
import {
  applyReviewLatch,
  type ReviewLatchStep,
} from '../latch/review-step.ts';
import { removeTempDbs, tempDb } from './latch-temp-db.ts';

afterAll(removeTempDbs);

const MR = 'https://gitlab.com/acme/web/-/merge_requests/2317';
const IMG = '![re-review latch](/uploads/ab12/latch-2317.png)';

function disc(id: string, body: string, author: string, noteId = 1) {
  return {
    id,
    resolvable: true,
    resolved: false,
    notes: [
      {
        id: noteId,
        body,
        author: { id: 1, username: author, name: author, avatarUrl: null },
        createdAt: '2026-09-01T10:00:00Z',
        system: false,
        type: 'DiscussionNote',
        resolvable: true,
        resolved: false,
        position: null,
      },
    ],
  };
}
const detail = (...d: ReturnType<typeof disc>[]) =>
  ({
    mrIid: 2317,
    repositoryId: 'gitlab:42',
    discussions: d,
  }) as unknown as MRDetail;

function latchRow(over: Partial<LatchRow> = {}): LatchRow {
  return {
    mrUrl: MR,
    discussionId: 'mine',
    rootNoteId: 1,
    phase: 'running',
    wait: null,
    launchAt: 1_000,
    failures: 0,
    stuck: false,
    variant: 'running',
    updatedAt: 1,
    ...over,
  };
}

function step(over: Partial<ReviewLatchStep>) {
  const calls: string[] = [];
  const replies: string[] = [];
  const gateway: LatchGateway = {
    async uploadFile() {
      calls.push('upload');
      return { alt: '', url: '', full_path: '', markdown: IMG };
    },
    async createDiscussion() {
      calls.push('createDiscussion');
      return { id: 'new', notes: [{ id: 1 }] };
    },
    async updateNote(_p, _i, id) {
      calls.push(`updateNote:${id}`);
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
  const s: ReviewLatchStep = {
    outcome: 'comment',
    arm: true,
    reviewRunStartedAt: 2_000,
    countNew: async () => 2,
    now: 5_000,
    self: 'matt',
    approvedBy: [],
    detail: detail(),
    gateway,
    projectId: 42,
    projectPath: 'acme/web',
    mrUrl: MR,
    iid: 2317,
    db: tempDb(),
    ...over,
  };
  return { s, calls, replies };
}

describe('applyReviewLatch', () => {
  test("a comment posts beside another reviewer's armed latch", async () => {
    const { s, calls } = step({
      detail: detail(disc('lee', armedLatchBody(IMG), 'lee')),
    });
    expect(await applyReviewLatch(s)).toBe('posted');
    expect(calls).toEqual(['upload', 'createDiscussion']);
  });

  test('a post records the latch as an armed row', async () => {
    const db = tempDb();
    const { s } = step({ db });
    await applyReviewLatch(s);
    expect(readLatchRow(MR, db)).toMatchObject({
      discussionId: 'new',
      rootNoteId: 1,
      phase: 'armed',
      variant: 'armed',
      failures: 0,
      stuck: false,
    });
  });

  test('a comment posts nothing while this reviewer has an armed latch', async () => {
    const { s, calls } = step({
      detail: detail(disc('mine', armedLatchBody(IMG), 'Matt')),
    });
    expect(await applyReviewLatch(s)).toBe('none');
    expect(calls).toEqual([]);
  });

  test('a comment posts again once this reviewer only has a spent latch', async () => {
    const { s } = step({
      detail: detail(disc('old', spentLatchBody(IMG), 'matt')),
    });
    expect(await applyReviewLatch(s)).toBe('posted');
  });

  test('a comment posts nothing while this reviewer approves in GitLab', async () => {
    const { s, calls } = step({ approvedBy: ['MATT'] });
    expect(await applyReviewLatch(s)).toBe('none');
    expect(calls).toEqual([]);
  });

  test("someone else's GitLab approval does not stop the post", async () => {
    const { s } = step({ approvedBy: ['lee'] });
    expect(await applyReviewLatch(s)).toBe('posted');
  });

  test("an approve spends this reviewer's latches and leaves others alone", async () => {
    const { s, calls } = step({
      outcome: 'approve',
      detail: detail(
        disc('mine', armedLatchBody(IMG), 'matt', 1),
        disc('lee', armedLatchBody(IMG), 'lee', 2)
      ),
    });
    expect(await applyReviewLatch(s)).toBe('spent');
    expect(calls).toEqual(['upload', 'updateNote:1', 'resolve:mine']);
  });

  test('review step never posts a duplicate beside a queued latch', async () => {
    const queued = latchBody('queued', IMG, 'queued');
    const { s, calls } = step({ detail: detail(disc('mine', queued, 'matt')) });
    expect(await applyReviewLatch(s)).toBe('none');
    expect(calls).toEqual([]);
  });

  // The daemon's discussion read can lag the row; the row alone proves a
  // live latch.
  test('a live row blocks the post when the read shows no latch yet', async () => {
    const db = tempDb();
    putLatchRow(latchRow({ phase: 'queued', variant: 'queued-cooldown' }), db);
    const { s, calls } = step({ db });
    expect(await applyReviewLatch(s)).toBe('none');
    expect(calls).toEqual([]);
  });

  test('a done review lands a running latch instead of posting', async () => {
    const db = tempDb();
    putLatchRow(latchRow(), db);
    const running = latchBody('running', IMG, 'running');
    const { s, calls, replies } = step({
      db,
      detail: detail(disc('mine', running, 'matt')),
    });
    expect(await applyReviewLatch(s)).toBe('landed');
    expect(calls).toEqual([
      'upload',
      'updateNote:1',
      'unresolve:mine',
      'reply:mine',
    ]);
    expect(replies).toEqual(['Follow-up review done: 2 new comments.']);
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'armed',
      variant: 'done-comments-2',
    });
  });

  test('countNew is asked from the latch launch stamp', async () => {
    const db = tempDb();
    putLatchRow(latchRow({ launchAt: 1_234 }), db);
    const asked: number[] = [];
    const { s } = step({
      db,
      countNew: async at => {
        asked.push(at);
        return 1;
      },
    });
    await applyReviewLatch(s);
    expect(asked).toEqual([1_234]);
  });

  test('an approve lands done-approved and spends the other copies approved', async () => {
    const db = tempDb();
    putLatchRow(latchRow(), db);
    const { s, calls, replies } = step({
      db,
      outcome: 'approve',
      detail: detail(
        disc('mine', latchBody('running', IMG, 'running'), 'matt', 1),
        disc('extra', armedLatchBody(IMG), 'matt', 2)
      ),
    });
    expect(await applyReviewLatch(s)).toBe('landed');
    expect(calls).toEqual([
      'upload',
      'updateNote:1',
      'resolve:mine',
      'reply:mine',
      'upload',
      'updateNote:2',
      'resolve:extra',
    ]);
    expect(replies).toEqual(['Follow-up review done: approved.']);
    expect(readLatchRow(MR, db)).toMatchObject({
      phase: 'spent',
      variant: 'done-approved',
    });
  });

  test('an approve after the pass landed it keeps the done-approved banner', async () => {
    const db = tempDb();
    putLatchRow(latchRow({ phase: 'spent', variant: 'done-approved' }), db);
    const uploads: string[] = [];
    const { s } = step({
      db,
      outcome: 'approve',
      detail: detail(disc('mine', latchBody('running', IMG, 'r'), 'matt', 1)),
    });
    const upload = s.gateway.uploadFile;
    s.gateway.uploadFile = async (p, f, b, ct) => {
      uploads.push(f);
      return upload(p, f, b, ct);
    };
    expect(await applyReviewLatch(s)).toBe('spent');
    expect(uploads).toEqual(['latch-2317-done-approved.gif']);
    expect(readLatchRow(MR, db)?.variant).toBe('done-approved');
  });

  test('an abandoned review re-arms a running latch with no reply', async () => {
    const db = tempDb();
    putLatchRow(latchRow(), db);
    const { s, calls, replies } = step({ db, outcome: null });
    expect(await applyReviewLatch(s)).toBe('landed');
    expect(calls).toEqual(['upload', 'updateNote:1', 'unresolve:mine']);
    expect(replies).toEqual([]);
  });

  test('a done review the board cannot vouch for never lands', async () => {
    const db = tempDb();
    putLatchRow(latchRow(), db);
    const { s, calls } = step({ db, reviewRunStartedAt: null });
    expect(await applyReviewLatch(s)).toBe('none');
    expect(calls).toEqual([]);
    expect(readLatchRow(MR, db)?.phase).toBe('running');
  });

  test('with re-review off a comment still lands a running latch but never posts', async () => {
    const db = tempDb();
    putLatchRow(latchRow(), db);
    const landed = step({ db, arm: false });
    expect(await applyReviewLatch(landed.s)).toBe('landed');
    const fresh = step({ arm: false });
    expect(await applyReviewLatch(fresh.s)).toBe('none');
    expect(fresh.calls).toEqual([]);
  });
});
