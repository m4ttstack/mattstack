import { describe, expect, test } from 'bun:test';

import type { MRDetail } from '@mattstack/glance';
import { armedLatchBody, spentLatchBody } from '../latch/markers.ts';
import type { LatchGateway } from '../latch/post.ts';
import {
  applyReviewLatch,
  type ReviewLatchStep,
} from '../latch/review-step.ts';

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

function step(over: Partial<ReviewLatchStep>) {
  const calls: string[] = [];
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
    async createNote(_p, _i, _b, d) {
      calls.push(`reply:${d}`);
      return { id: 9 };
    },
  };
  const s: ReviewLatchStep = {
    outcome: 'comment',
    self: 'matt',
    approvedBy: [],
    detail: detail(),
    gateway,
    projectId: 42,
    projectPath: 'acme/web',
    mrUrl: MR,
    iid: 2317,
    ...over,
  };
  return { s, calls };
}

describe('applyReviewLatch', () => {
  test("a comment posts beside another reviewer's armed latch", async () => {
    const { s, calls } = step({
      detail: detail(disc('lee', armedLatchBody(IMG), 'lee')),
    });
    expect(await applyReviewLatch(s)).toBe('posted');
    expect(calls).toEqual(['upload', 'createDiscussion']);
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
    expect(calls).toEqual(['updateNote:1', 'resolve:mine']);
  });
});
