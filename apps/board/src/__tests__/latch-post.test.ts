import { afterAll, describe, expect, test } from 'bun:test';

import type { LatchRef } from '../latch/discussions.ts';
import {
  putLatchRow,
  readLatchRow,
  type LatchRow,
} from '../latch/latch-state.ts';
import { latchKindOf } from '../latch/markers.ts';
import {
  bannerMarkdown,
  postLatch,
  rewriteLatch,
  spendAllLatches,
  spendLatch,
  type LatchGateway,
  type LatchTarget,
} from '../latch/post.ts';
import { removeTempDbs, tempDb } from './latch-temp-db.ts';

afterAll(removeTempDbs);

const MR = 'https://gitlab.com/acme/web/-/merge_requests/2317';
const NOW = 1_700_000_000_000;
const OLD_IMG = '![re-review latch](/uploads/ab12/latch-2317.png)';

function gateway() {
  const calls: string[] = [];
  const bodies: string[] = [];
  const uploads: Array<{ filename: string; contentType?: string }> = [];
  const gw: LatchGateway = {
    async uploadFile(_p, filename, _bytes, contentType) {
      calls.push(`upload:${filename}`);
      uploads.push({ filename, contentType });
      return {
        alt: filename,
        url: `/uploads/ab12/${filename}`,
        full_path: 'x',
        markdown: `![${filename}](/uploads/ab12/${filename})`,
      };
    },
    async createDiscussion(_p, _iid, body) {
      calls.push('createDiscussion');
      bodies.push(body);
      return { id: 'd1', notes: [{ id: 1 } as never] };
    },
    async updateNote(_p, _iid, noteId, body) {
      calls.push(`updateNote:${noteId}`);
      bodies.push(body);
    },
    async resolveDiscussion(_path, _iid, id) {
      calls.push(`resolve:${id}`);
    },
    async unresolveDiscussion(_path, _iid, id) {
      calls.push(`unresolve:${id}`);
    },
    async createNote(_p, _iid, body) {
      calls.push('createNote');
      bodies.push(body);
      return { id: 9 } as never;
    },
  };
  return { gw, calls, bodies, uploads };
}

function row(overrides: Partial<LatchRow> = {}): LatchRow {
  return {
    mrUrl: MR,
    discussionId: 'd1',
    rootNoteId: 1,
    phase: 'armed',
    wait: null,
    launchAt: null,
    failures: 0,
    stuck: false,
    variant: 'armed',
    replyDue: null,
    updatedAt: 1,
    ...overrides,
  };
}

const target: LatchTarget = {
  projectId: 42,
  projectPath: 'acme/web',
  iid: 2317,
  mrUrl: MR,
  discussionId: 'd1',
  rootNoteId: 1,
};

describe('bannerMarkdown', () => {
  test('uploads a gif named for the variant and titles it', async () => {
    const db = tempDb();
    const { gw, uploads } = gateway();
    const md = await bannerMarkdown(gw, 42, MR, 2317, { state: 'armed' }, db);
    expect(uploads).toEqual([
      { filename: 'latch-2317-armed.gif', contentType: 'image/gif' },
    ]);
    expect(md).toBe(
      '![Ready for another pass?](/uploads/ab12/latch-2317-armed.gif){width=520}'
    );
  });

  test('uploads once per variant', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    const v = { state: 'queued' as const, wait: 'cooldown' as const };
    const first = await bannerMarkdown(gw, 42, MR, 2317, v, db);
    const second = await bannerMarkdown(gw, 42, MR, 2317, v, db);
    expect(second).toBe(first);
    expect(calls).toEqual(['upload:latch-2317-queued-cooldown.gif']);
  });

  test('a different variant uploads its own banner', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    await bannerMarkdown(gw, 42, MR, 2317, { state: 'running' }, db);
    await bannerMarkdown(gw, 42, MR, 2317, { state: 'armed' }, db);
    expect(calls).toEqual([
      'upload:latch-2317-running.gif',
      'upload:latch-2317-armed.gif',
    ]);
  });
});

describe('postLatch', () => {
  test('uploads the banner then creates a resolvable discussion', async () => {
    const db = tempDb();
    const { gw, calls, bodies } = gateway();
    const posted = await postLatch(gw, 42, 'acme/web', MR, 2317, db);
    expect(posted).toEqual({ discussionId: 'd1', rootNoteId: 1 });
    expect(calls).toEqual(['upload:latch-2317-armed.gif', 'createDiscussion']);
    expect(latchKindOf(bodies[0]!)).toBe('armed');
    expect(bodies[0]).toContain(
      '/uploads/ab12/latch-2317-armed.gif){width=520}'
    );
    expect(bodies[0]).toContain('Resolve this thread');
  });
});

describe('rewriteLatch', () => {
  // A crash between the two writes leaves the phase visible on the note,
  // and the row decides recovery.
  test('writes the note before unresolving', async () => {
    const db = tempDb();
    const { gw, calls, bodies } = gateway();
    await rewriteLatch(
      gw,
      target,
      'armed',
      { state: 'done-comments', count: 3 },
      'unresolve',
      NOW,
      db
    );
    expect(calls).toEqual([
      'upload:latch-2317-done-comments-3.gif',
      'updateNote:1',
      'unresolve:d1',
    ]);
    expect(latchKindOf(bodies[0]!)).toBe('armed');
    expect(bodies[0]).toContain('addressed the new comments');
  });

  test('resolve resolves after the write, keep leaves the thread', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    await rewriteLatch(
      gw,
      target,
      'running',
      { state: 'running' },
      'resolve',
      NOW,
      db
    );
    await rewriteLatch(
      gw,
      target,
      'running',
      { state: 'running' },
      'keep',
      NOW,
      db
    );
    expect(calls).toEqual([
      'upload:latch-2317-running.gif',
      'updateNote:1',
      'resolve:d1',
      'updateNote:1',
    ]);
  });

  test("records the variant on this latch's row", async () => {
    const db = tempDb();
    putLatchRow(row({ phase: 'queued', variant: 'queued-next-sweep' }), db);
    const { gw } = gateway();
    await rewriteLatch(
      gw,
      target,
      'queued',
      { state: 'queued', wait: 'budget' },
      'keep',
      NOW,
      db
    );
    expect(readLatchRow(MR, db)).toMatchObject({
      variant: 'queued-budget',
      updatedAt: NOW,
    });
  });
});

describe('spendLatch', () => {
  const armed: LatchRef = {
    discussionId: 'd1',
    rootNoteId: 1,
    kind: 'armed',
    resolved: true,
    createdAt: '2026-09-01T10:00:00Z',
    body: `<!-- mattstack:board re-review-latch v1 -->\n\n${OLD_IMG}\n\nbody`,
  };

  // Rewrite BEFORE resolve. A crash between them leaves a spent-but-unresolved
  // latch, which the pass repairs. The reverse leaves a resolved-but-unspent
  // latch, which is indistinguishable from a human request.
  test('rewrites the body before resolving', async () => {
    const db = tempDb();
    const { gw, calls, bodies } = gateway();
    await spendLatch(
      gw,
      42,
      'acme/web',
      MR,
      2317,
      armed,
      { state: 'approved' },
      NOW,
      db
    );
    expect(calls).toEqual([
      'upload:latch-2317-approved.gif',
      'updateNote:1',
      'resolve:d1',
    ]);
    expect(latchKindOf(bodies[0]!)).toBe('spent');
    expect(bodies[0]).toContain('Approved, so this latch is spent');
    expect(bodies[0]).toContain('![Approved](');
  });

  test('an already-spent latch that is resolved draws no writes', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    await spendLatch(
      gw,
      42,
      'acme/web',
      MR,
      2317,
      { ...armed, kind: 'spent', resolved: true },
      { state: 'approved' },
      NOW,
      db
    );
    expect(calls).toEqual([]);
  });

  // The crash-repair path: body already spent, thread still open.
  test('an already-spent latch that is unresolved is only re-resolved', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    await spendLatch(
      gw,
      42,
      'acme/web',
      MR,
      2317,
      { ...armed, kind: 'spent', resolved: false },
      { state: 'approved' },
      NOW,
      db
    );
    expect(calls).toEqual(['resolve:d1']);
  });

  test('a superseded variant writes the superseded wording instead', async () => {
    const db = tempDb();
    const { gw, bodies } = gateway();
    await spendLatch(
      gw,
      42,
      'acme/web',
      MR,
      2317,
      armed,
      { state: 'superseded' },
      NOW,
      db
    );
    expect(bodies[0]).toContain('Superseded by a newer latch on this MR');
    expect(bodies[0]).not.toContain('Approved');
  });

  test('spending the canonical latch moves its row to spent', async () => {
    const db = tempDb();
    putLatchRow(row({ phase: 'running', variant: 'running' }), db);
    const { gw } = gateway();
    await spendLatch(
      gw,
      42,
      'acme/web',
      MR,
      2317,
      armed,
      { state: 'approved' },
      NOW,
      db
    );
    const r = readLatchRow(MR, db);
    expect(r?.phase).toBe('spent');
    expect(r?.variant).toBe('approved');
    expect(r?.updatedAt).toBe(NOW);
  });

  test("spending a duplicate leaves the canonical latch's row alone", async () => {
    const db = tempDb();
    putLatchRow(row({ discussionId: 'canon', rootNoteId: 7 }), db);
    const { gw } = gateway();
    await spendLatch(
      gw,
      42,
      'acme/web',
      MR,
      2317,
      armed,
      { state: 'superseded' },
      NOW,
      db
    );
    const r = readLatchRow(MR, db);
    expect(r?.phase).toBe('armed');
    expect(r?.variant).toBe('armed');
  });

  // landFollowUp may already have moved the row; the note still needs writing.
  test('a row already spent still gets the note rewritten and resolved', async () => {
    const db = tempDb();
    putLatchRow(row({ phase: 'spent', variant: 'running' }), db);
    const { gw, calls } = gateway();
    await spendLatch(
      gw,
      42,
      'acme/web',
      MR,
      2317,
      armed,
      { state: 'done-approved' },
      NOW,
      db
    );
    expect(calls).toEqual([
      'upload:latch-2317-done-approved.gif',
      'updateNote:1',
      'resolve:d1',
    ]);
    expect(readLatchRow(MR, db)?.variant).toBe('done-approved');
  });
});

describe('spendAllLatches', () => {
  const armed: LatchRef = {
    discussionId: 'd1',
    rootNoteId: 1,
    kind: 'armed',
    resolved: true,
    createdAt: '2026-09-01T10:00:00Z',
    body: `<!-- mattstack:board re-review-latch v1 -->\n\n${OLD_IMG}\n\nbody`,
  };

  test('spends every latch given, deduped by discussion id, one upload', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    const other: LatchRef = { ...armed, discussionId: 'd2', rootNoteId: 2 };
    await spendAllLatches(
      gw,
      42,
      'acme/web',
      MR,
      2317,
      [armed, other, armed],
      { state: 'approved' },
      NOW,
      db
    );
    expect(calls).toEqual([
      'upload:latch-2317-approved.gif',
      'updateNote:1',
      'resolve:d1',
      'updateNote:2',
      'resolve:d2',
    ]);
  });

  test('passes the variant through to every latch spent', async () => {
    const db = tempDb();
    const { gw, bodies } = gateway();
    const other: LatchRef = { ...armed, discussionId: 'd2', rootNoteId: 2 };
    await spendAllLatches(
      gw,
      42,
      'acme/web',
      MR,
      2317,
      [armed, other],
      { state: 'superseded' },
      NOW,
      db
    );
    expect(
      bodies.every(b => b.includes('Superseded by a newer latch on this MR'))
    ).toBe(true);
  });
});
