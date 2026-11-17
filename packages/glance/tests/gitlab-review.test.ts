import { afterEach, describe, expect, test } from 'bun:test';
import { GitLabProvider } from '../src/GitLabProvider.ts';
import { RateLimitedError } from '../src/errors.ts';
import type { DraftNote } from '../src/NoteMutator.ts';
import { submitGitLabReview, type GitLabReviewDeps } from '../src/gitlabReview.ts';
import type { ReviewSubmission } from '../src/types.ts';

const REFS = { base_sha: 'b', start_sha: 's', head_sha: 'h' };
const draft = (id: number, over: Partial<DraftNote> = {}): DraftNote => ({
  id,
  note: `n${id}`,
  discussion_id: null,
  line_code: `lc${id}`,
  resolve_discussion: false,
  ...over
});

type Mutator = GitLabReviewDeps['mutator'];

/** A scripted GitLab: records every call in order and keeps a pending list. */
function fake(over: Partial<Mutator> = {}) {
  const log: string[] = [];
  let pending: DraftNote[] = [];
  let next = 1;
  const mutator: Mutator = {
    fetchDiffRefs: async () => {
      log.push('refs');
      return REFS;
    },
    listDraftNotes: async () => {
      log.push('list');
      return [...pending];
    },
    createDraftNote: async (_p, _i, body, opts = {}) => {
      const d = draft(next++, { note: body, discussion_id: opts.inReplyToDiscussionId ?? null });
      log.push(
        opts.inReplyToDiscussionId
          ? `reply:${opts.inReplyToDiscussionId}:${opts.resolveDiscussion}`
          : `comment:${opts.position?.new_path}:${opts.position?.new_line}`
      );
      pending.push(d);
      return d;
    },
    deleteDraftNote: async (_p, _i, id) => {
      log.push(`delete:${id}`);
      pending = pending.filter((d) => d.id !== id);
    },
    publishDraftNotes: async (_p, _i, o) => {
      log.push(`publish:${o.reviewerState}:${o.note}`);
      pending = [];
    },
    ...over
  };
  const deps: GitLabReviewDeps = {
    mutator,
    project: 'group/proj',
    iid: 7,
    approve: async () => {
      log.push('approve');
    },
    resolve: async (id) => {
      log.push(`resolve:${id}`);
    }
  };
  return {
    deps,
    log,
    seed: (d: DraftNote[]) => {
      pending = d;
    },
    pending: () => pending
  };
}

const httpErr = (status: number) => Object.assign(new Error(`publishDraftNotes failed: ${status}`), { status });

const INPUT: ReviewSubmission = {
  outcome: 'comment',
  summary: 'sum',
  comments: [
    { body: 'c1', path: 'src/a.ts', line: 3 },
    { body: 'c2', path: 'src/b.ts', line: 9 }
  ],
  replies: [
    { discussionId: 'd1', body: 'fixed, thanks', resolve: true },
    { discussionId: 'd2', resolve: true },
    { discussionId: 'd3', body: 'still wrong', resolve: false }
  ]
};

describe('submitGitLabReview', () => {
  test('posts comments, then replies, publishes once, then resolves the bodiless reply', async () => {
    const f = fake();
    const out = await submitGitLabReview(f.deps, INPUT);
    expect(f.log).toEqual([
      'list',
      'refs',
      'comment:src/a.ts:3',
      'comment:src/b.ts:9',
      'reply:d1:true',
      'reply:d3:false',
      'publish:reviewed:sum',
      'resolve:d2'
    ]);
    expect(out).toEqual({
      published: true,
      comments: 2,
      replies: 2,
      repliedTo: ['d1', 'd3'],
      resolved: ['d1', 'd2'],
      approved: false,
      resolveErrors: [],
      reviewId: null,
      reviewerState: null
    });
  });

  test('approve runs after the publish', async () => {
    const f = fake();
    const out = await submitGitLabReview(f.deps, { ...INPUT, outcome: 'approve', replies: [] });
    expect(f.log.slice(-2)).toEqual(['publish:reviewed:sum', 'approve']);
    expect(out.published && out.approved).toBe(true);
  });

  test('request_changes publishes with requested_changes and never approves', async () => {
    const f = fake();
    const out = await submitGitLabReview(f.deps, { ...INPUT, outcome: 'request_changes', replies: [] });
    expect(f.log).toEqual(['list', 'refs', 'comment:src/a.ts:3', 'comment:src/b.ts:9', 'publish:requested_changes:sum']);
    expect(out.published && out.approved).toBe(false);
  });

  test("the caller's own pending comments refuse the review before anything is created", async () => {
    const f = fake();
    f.seed([draft(50, { note: 'half a thought\nsecond line' }), draft(51, { note: 'another' })]);
    const out = await submitGitLabReview(f.deps, INPUT);
    expect(out).toEqual({
      published: false,
      reason: 'pending-drafts',
      pending: { count: 2, firstLines: ['half a thought', 'another'], ids: [50, 51] }
    });
    expect(f.log).toEqual(['list']);
  });

  describe('includePendingIds', () => {
    const snapshotAtPublish = (f: ReturnType<typeof fake>) => {
      const seen: string[][] = [];
      const publish = f.deps.mutator.publishDraftNotes;
      f.deps.mutator.publishDraftNotes = async (p, i, o) => {
        seen.push(f.pending().map((d) => d.note));
        return publish(p, i, o);
      };
      return seen;
    };

    test("publishes the caller's pending comment together with the review", async () => {
      const f = fake();
      f.seed([draft(50, { note: 'half a thought' })]);
      const seen = snapshotAtPublish(f);
      const out = await submitGitLabReview(f.deps, { ...INPUT, includePendingIds: [50] });
      expect(out.published).toBe(true);
      expect(seen[0]).toEqual(expect.arrayContaining(['half a thought', 'c1', 'c2']));
    });

    test("a failed review rolls back only its own comments and keeps the caller's", async () => {
      const f = fake();
      f.seed([draft(50, { note: 'half a thought' })]);
      const create = f.deps.mutator.createDraftNote;
      f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
        if (body === 'c2') throw new Error('boom');
        return create(p, i, body, opts);
      };
      await expect(submitGitLabReview(f.deps, { ...INPUT, includePendingIds: [50] })).rejects.toThrow(/review not posted/);
      expect(f.pending().map((d) => d.id)).toEqual([50]);
    });

    test('a stale id list is refused before anything is created', async () => {
      const f = fake();
      f.seed([draft(50, { note: 'half a thought' }), draft(51, { note: 'written since' })]);
      const out = await submitGitLabReview(f.deps, { ...INPUT, includePendingIds: [50] });
      expect(out).toEqual({
        published: false,
        reason: 'pending-drafts',
        pending: { count: 2, firstLines: ['half a thought', 'written since'], ids: [50, 51] }
      });
      expect(f.log).toEqual(['list']);
    });

    test('pending comments plus this review past one page are refused before anything is created', async () => {
      const f = fake();
      f.seed(Array.from({ length: 30 }, (_, i) => draft(500 + i)));
      const comments = Array.from({ length: 80 }, (_, i) => ({ body: `c${i}`, path: 'src/a.ts', line: i + 1 }));
      await expect(
        submitGitLabReview(f.deps, { ...INPUT, comments, replies: [], includePendingIds: f.pending().map((d) => d.id) })
      ).rejects.toThrow(/review not posted: .*30 pending comments.*100/);
      expect(f.log).toEqual(['list']);
    });

    test("a timed-out create never mistakes the caller's comment for its own", async () => {
      const f = fake();
      f.seed([draft(50, { note: 'half a thought' })]);
      const seen = snapshotAtPublish(f);
      const create = f.deps.mutator.createDraftNote;
      let tries = 0;
      f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
        if (body === 'c2' && tries++ === 0) throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
        return create(p, i, body, opts);
      };
      const out = await submitGitLabReview(f.deps, { ...INPUT, includePendingIds: [50] });
      expect(out.published).toBe(true);
      expect(seen[0]).toEqual(expect.arrayContaining(['half a thought', 'c1', 'c2']));
    });
  });

  test('a null line_code deletes everything this call created and names the anchor', async () => {
    const f = fake({});
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      const d = await create(p, i, body, opts);
      return body === 'c2' ? { ...d, line_code: null } : d;
    };
    const out = await submitGitLabReview(f.deps, INPUT);
    expect(out).toEqual({
      published: false,
      reason: 'bad-anchors',
      badAnchors: [{ index: 1, path: 'src/b.ts', line: 9 }]
    });
    expect(f.log).not.toContain('publish:reviewed:sum');
    expect(f.pending()).toEqual([]);
  });

  test('a create that throws rolls back and reports nothing posted', async () => {
    const f = fake();
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === 'c2') throw new Error('boom');
      return create(p, i, body, opts);
    };
    await expect(submitGitLabReview(f.deps, INPUT)).rejects.toThrow(/review not posted: Error: boom/);
    expect(f.pending()).toEqual([]);
  });

  test('a rollback that cannot delete says how many pending comments are left', async () => {
    const f = fake({
      deleteDraftNote: async () => {
        throw new Error('nope');
      }
    });
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === 'c2') throw new Error('boom');
      return create(p, i, body, opts);
    };
    await expect(submitGitLabReview(f.deps, INPUT)).rejects.toThrow(/1 pending comment could not be deleted/);
  });

  test('a create that lands on GitLab and then throws is still rolled back', async () => {
    const f = fake();
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      const d = await create(p, i, body, opts);
      if (body === 'c2') throw new Error('socket hang up');
      return d;
    };
    await expect(submitGitLabReview(f.deps, INPUT)).rejects.toThrow(/review not posted: Error: socket hang up; rolled back, nothing was posted$/);
    expect(f.pending()).toEqual([]);
  });

  const timeout = () => Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });

  test('a create that times out before landing is retried once and the review posts', async () => {
    const f = fake();
    const create = f.deps.mutator.createDraftNote;
    let tries = 0;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === 'c2' && tries++ === 0) throw timeout();
      return create(p, i, body, opts);
    };
    const out = await submitGitLabReview(f.deps, INPUT);
    expect(out.published).toBe(true);
    expect(f.log.filter((l) => l === 'comment:src/b.ts:9')).toHaveLength(1);
  });

  test('a create that lands and then times out is kept, not posted twice', async () => {
    const f = fake();
    const create = f.deps.mutator.createDraftNote;
    let tries = 0;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      const d = await create(p, i, body, opts);
      if (body === 'c2' && tries++ === 0) throw timeout();
      return d;
    };
    let published: string[] = [];
    const publish = f.deps.mutator.publishDraftNotes;
    f.deps.mutator.publishDraftNotes = async (p, i, o) => {
      published = f.pending().map((d) => d.note);
      return publish(p, i, o);
    };
    const out = await submitGitLabReview(f.deps, INPUT);
    expect(out.published).toBe(true);
    expect(published.filter((n) => n === 'c2')).toHaveLength(1);
  });

  test('a draft that appears during a timed-out create is not taken for it unless the body matches', async () => {
    const f = fake();
    const create = f.deps.mutator.createDraftNote;
    let tries = 0;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === 'c2' && tries++ === 0) {
        f.seed([...f.pending(), draft(90, { note: 'typed in the GitLab UI meanwhile' })]);
        throw timeout();
      }
      return create(p, i, body, opts);
    };
    const seen: string[][] = [];
    const publish = f.deps.mutator.publishDraftNotes;
    f.deps.mutator.publishDraftNotes = async (p, i, o) => {
      seen.push(f.pending().map((d) => d.note));
      return publish(p, i, o);
    };
    const out = await submitGitLabReview(f.deps, INPUT);
    expect(out.published).toBe(true);
    expect(seen[0]).toContain('c2');
  });

  test('a timed-out create that lands late is published once, not twice', async () => {
    const f = fake();
    const create = f.deps.mutator.createDraftNote;
    let tries = 0;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === 'c2' && tries++ === 0) {
        // GitLab keeps going after the client gives up: the draft commits after the check.
        const list = f.deps.mutator.listDraftNotes;
        f.deps.mutator.listDraftNotes = async (pp, ii) => {
          const now = await list(pp, ii);
          f.deps.mutator.listDraftNotes = list;
          await create(p, i, body, opts);
          return now;
        };
        throw timeout();
      }
      return create(p, i, body, opts);
    };
    const seen: string[][] = [];
    const publish = f.deps.mutator.publishDraftNotes;
    f.deps.mutator.publishDraftNotes = async (p, i, o) => {
      seen.push(f.pending().map((d) => d.note));
      return publish(p, i, o);
    };
    const out = await submitGitLabReview(f.deps, INPUT);
    expect(out.published).toBe(true);
    expect(seen[0]!.filter((n) => n === 'c2')).toHaveLength(1);
  });

  test('a create that times out twice rolls back and says nothing was posted', async () => {
    const f = fake();
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === 'c2') throw timeout();
      return create(p, i, body, opts);
    };
    await expect(submitGitLabReview(f.deps, INPUT)).rejects.toThrow(/review not posted: .*timed out.*; rolled back, nothing was posted$/);
    expect(f.pending()).toEqual([]);
  });

  test('a rollback whose delete fails includes the first error text', async () => {
    const f = fake({
      deleteDraftNote: async () => {
        throw new Error('nope');
      }
    });
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === 'c2') throw new Error('boom');
      return create(p, i, body, opts);
    };
    await expect(submitGitLabReview(f.deps, INPUT)).rejects.toThrow(
      'review not posted: Error: boom; 1 pending comment could not be deleted and is still on the MR (first error: Error: nope)'
    );
  });

  test('the list call failing during rollback still deletes the created ids', async () => {
    const f = fake();
    const list = f.deps.mutator.listDraftNotes;
    let lists = 0;
    f.deps.mutator.listDraftNotes = async (p, i) => {
      if (lists++ > 0) throw new Error('list down');
      return list(p, i);
    };
    const create = f.deps.mutator.createDraftNote;
    f.deps.mutator.createDraftNote = async (p, i, body, opts) => {
      if (body === 'c2') throw new Error('boom');
      return create(p, i, body, opts);
    };
    await expect(submitGitLabReview(f.deps, INPUT)).rejects.toThrow(
      /review not posted: Error: boom.*\(first error: Error: list down\)/
    );
    expect(f.log).toContain('delete:1');
    expect(f.pending()).toEqual([]);
  });

  test("a failed publish that leaves only some of this call's pending comments says it partly landed and deletes the rest", async () => {
    const f = fake();
    f.deps.mutator.publishDraftNotes = async () => {
      f.seed(f.pending().slice(1));
      throw new Error('socket hang up');
    };
    const err = await submitGitLabReview(f.deps, { ...INPUT, replies: [] }).then(
      () => null,
      (e: unknown) => String(e)
    );
    expect(err).not.toBeNull();
    expect(err).not.toContain('nothing was posted');
    expect(err).toContain('1 of 2');
    expect(err).toContain('look at the MR before retrying');
    expect(f.log).toContain('delete:2');
    expect(f.log).not.toContain('delete:1');
    expect(f.pending()).toEqual([]);
  });

  test('a publish that throws but left no pending comments counts as landed', async () => {
    const f = fake();
    const publish = f.deps.mutator.publishDraftNotes;
    f.deps.mutator.publishDraftNotes = async (p, i, o) => {
      await publish(p, i, o);
      throw new Error('timeout');
    };
    const out = await submitGitLabReview(f.deps, INPUT);
    expect(out.published).toBe(true);
  });

  test('a 5xx publish with every pending comment still there is an unknown outcome, never nothing posted', async () => {
    const f = fake({
      publishDraftNotes: async () => {
        throw httpErr(502);
      }
    });
    const err = await submitGitLabReview(f.deps, INPUT).then(
      () => null,
      (e: unknown) => String(e)
    );
    expect(err).toContain(
      'publish failed and its outcome is unknown: Error: publishDraftNotes failed: 502; GitLab may have posted some or all of this review; look at the MR before retrying'
    );
    expect(err).not.toContain('nothing was posted');
    expect(f.pending()).toEqual([]);
  });

  test('a publish GitLab refuses before acting reports nothing posted and deletes the pending comments', async () => {
    const f = fake({
      publishDraftNotes: async () => {
        throw httpErr(422);
      }
    });
    await expect(submitGitLabReview(f.deps, INPUT)).rejects.toThrow(
      /^publish failed, nothing was posted: Error: publishDraftNotes failed: 422$/
    );
    expect(f.pending()).toEqual([]);
  });

  test('a publish still rate limited past the deadline reports nothing posted, since a 429 is never applied', async () => {
    const f = fake({
      publishDraftNotes: async () => {
        throw new RateLimitedError('GitLab rate limit hit on POST /bulk_publish; retry after 70 seconds', {
          kind: 'secondary',
          resetAt: null,
          retryAfterMs: 70_000,
          operation: 'POST /bulk_publish'
        });
      }
    });
    await expect(submitGitLabReview(f.deps, INPUT)).rejects.toThrow(/^publish failed, nothing was posted: RateLimitedError: /);
    expect(f.pending()).toEqual([]);
  });

  test('a summary-only publish GitLab refuses reports nothing posted', async () => {
    const f = fake({
      publishDraftNotes: async () => {
        throw httpErr(403);
      }
    });
    await expect(
      submitGitLabReview(f.deps, { outcome: 'comment', summary: 'sum', comments: [], replies: [] })
    ).rejects.toThrow(/^publish failed, nothing was posted/);
  });

  test('a publish that times out or is aborted is an unknown outcome and deletes the pending comments', async () => {
    for (const name of ['TimeoutError', 'AbortError']) {
      const f = fake({
        publishDraftNotes: async () => {
          throw new DOMException('gave up', name);
        }
      });
      const err = await submitGitLabReview(f.deps, INPUT).then(
        () => null,
        (e: unknown) => String(e)
      );
      expect(err).toContain('publish failed and its outcome is unknown');
      expect(err).toContain('GitLab may have posted some or all of this review');
      expect(err).not.toContain('nothing was posted');
      expect(f.pending()).toEqual([]);
    }
  });

  test('an unknown outcome names the comments it could not delete', async () => {
    const f = fake({
      publishDraftNotes: async () => {
        throw httpErr(500);
      },
      deleteDraftNote: async () => {
        throw new Error('nope');
      }
    });
    await expect(submitGitLabReview(f.deps, INPUT)).rejects.toThrow(
      /look at the MR before retrying; 4 pending comments could not be deleted and are still on the MR \(first error: Error: nope\)$/
    );
  });

  test('a publish that throws with nothing pending to check reports an unknown outcome', async () => {
    const f = fake({
      publishDraftNotes: async () => {
        throw new Error('timeout');
      }
    });
    await expect(
      submitGitLabReview(f.deps, {
        outcome: 'comment',
        summary: 'sum',
        comments: [],
        replies: [{ discussionId: 'd2', resolve: true }]
      })
    ).rejects.toThrow(/outcome is unknown.*look for the summary/);
    expect(f.log).not.toContain('resolve:d2');
  });

  test('a refused approval after the publish is reported, not thrown', async () => {
    const f = fake();
    f.deps.approve = async () => {
      throw new Error('401 Unauthorized');
    };
    const out = await submitGitLabReview(f.deps, { ...INPUT, outcome: 'approve' });
    expect(out.published && out.approved).toBe(false);
    expect(out.published && out.approveError).toContain('401');
  });

  test('a failed resolve-only is listed and the rest still resolve', async () => {
    const f = fake();
    f.deps.resolve = async (id) => {
      if (id === 'd2') throw new Error('gone');
    };
    const out = await submitGitLabReview(f.deps, {
      ...INPUT,
      replies: [
        { discussionId: 'd2', resolve: true },
        { discussionId: 'd4', resolve: true }
      ]
    });
    expect(out.published && out.resolved).toEqual(['d4']);
    expect(out.published && out.resolveErrors).toEqual([{ discussionId: 'd2', error: 'Error: gone' }]);
  });

  test('more than 100 comments and replies is refused before any request; 100 is not', async () => {
    const comments = Array.from({ length: 60 }, (_, i) => ({ body: `c${i}`, path: 'a.ts', line: i + 1 }));
    const replies = (n: number) => Array.from({ length: n }, (_, i) => ({ discussionId: `d${i}`, resolve: true }));
    const over = fake();
    await expect(
      submitGitLabReview(over.deps, { outcome: 'comment', summary: 'sum', comments, replies: replies(41) })
    ).rejects.toThrow('review not posted: 101 comments and replies exceed the limit of 100');
    expect(over.log).toEqual([]);
    const at = fake();
    const out = await submitGitLabReview(at.deps, { outcome: 'comment', summary: 'sum', comments, replies: replies(40) });
    expect(out.published).toBe(true);
    expect(at.log[0]).toBe('list');
  });

  test('a summary-only review skips diff refs and publishes', async () => {
    const f = fake();
    await submitGitLabReview(f.deps, { outcome: 'comment', summary: 'sum', comments: [], replies: [] });
    expect(f.log).toEqual(['list', 'publish:reviewed:sum']);
  });
});

describe('GitLabProvider.submitReview', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('drives the draft flow, the approval and the resolve against the project path', async () => {
    const calls: string[] = [];
    const replies = [
      json([]),
      new Response(null, { status: 204 }),
      json({ id: 1 }, 201),
      json({ id: 'd2', notes: [] })
    ];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      calls.push(`${String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()} ${url.pathname}`);
      const reply = replies.shift();
      if (!reply) throw new Error(`unexpected request ${url.pathname}`);
      return reply;
    }) as typeof fetch;
    const out = await new GitLabProvider('https://gitlab.example.com', 'tok').submitReview('group/proj', 7, {
      outcome: 'approve',
      summary: 'sum',
      comments: [],
      replies: [{ discussionId: 'd2', resolve: true }]
    });
    const mr = '/api/v4/projects/group%2Fproj/merge_requests/7';
    expect(calls).toEqual([
      `GET ${mr}/draft_notes`,
      `POST ${mr}/draft_notes/bulk_publish`,
      `POST ${mr}/approve`,
      `PUT ${mr}/discussions/d2`
    ]);
    expect(out).toMatchObject({ published: true, approved: true, resolved: ['d2'], reviewId: null, reviewerState: null });
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
