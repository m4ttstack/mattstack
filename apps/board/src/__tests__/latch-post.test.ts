import { afterAll, describe, expect, test } from 'bun:test';

import type { LatchRef } from '../latch/discussions.ts';
import { latchGateway, type GitlabLatchClients } from '../latch/gateway.ts';
import {
  cachedUpload,
  putLatchRow,
  readLatchRow,
  rememberUpload,
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
  type LatchMr,
  type LatchTarget,
} from '../latch/post.ts';
import { bannerAlt, GITHUB_BANNER_SET, variantKey } from '../latch/variants.ts';
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
    forge: 'gitlab',
    async uploadFiles(_mr, files) {
      return files.map(({ filename, contentType }) => {
        calls.push(`upload:${filename}`);
        uploads.push({ filename, contentType });
        return `![${filename}](/uploads/ab12/${filename})`;
      });
    },
    async createThread(_mr, body) {
      calls.push('createDiscussion');
      bodies.push(body);
      return { discussionId: 'd1', rootNoteId: 1 };
    },
    async updateNote(_mr, noteId, body) {
      calls.push(`updateNote:${noteId}`);
      bodies.push(body);
    },
    async resolveDiscussion(_mr, id) {
      calls.push(`resolve:${id}`);
    },
    async unresolveDiscussion(_mr, id) {
      calls.push(`unresolve:${id}`);
    },
    async createNote(_mr, body) {
      calls.push('createNote');
      bodies.push(body);
      return { id: 9 } as never;
    },
  };
  return { gw, calls, bodies, uploads };
}

function githubGateway() {
  const calls: string[] = [];
  const bodies: string[] = [];
  const batches: string[][] = [];
  let thread: () => Promise<{
    discussionId: string;
    rootNoteId: number;
  } | null> = async () => ({ discussionId: 'gh1', rootNoteId: 5 });
  const gw: LatchGateway = {
    forge: 'github',
    async uploadFiles(_mr, files) {
      calls.push('upload');
      batches.push(files.map(f => f.filename));
      return files.map(
        f => `![${f.alt}](https://github.com/user-attachments/${f.filename})`
      );
    },
    async createThread(_mr, body) {
      calls.push('createThread');
      bodies.push(body);
      return thread();
    },
    async updateNote(_mr, noteId, body) {
      calls.push(`updateNote:${noteId}`);
      bodies.push(body);
    },
    async resolveDiscussion() {},
    async unresolveDiscussion() {},
    async createNote() {
      return { id: 9 };
    },
  };
  return {
    gw,
    calls,
    bodies,
    batches,
    setThread: (fn: typeof thread) => {
      thread = fn;
    },
  };
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

const mr: LatchMr & { mrUrl: string } = {
  projectId: 42,
  projectPath: 'acme/web',
  iid: 2317,
  rtRepo: 'acme-web',
  mrUrl: MR,
};

const target: LatchTarget = {
  ...mr,
  discussionId: 'd1',
  rootNoteId: 1,
};

describe('bannerMarkdown', () => {
  test('uploads a gif named for the variant and titles it', async () => {
    const db = tempDb();
    const { gw, uploads } = gateway();
    const md = await bannerMarkdown(gw, mr, { state: 'armed' }, db);
    expect(uploads).toEqual([
      { filename: 'latch-2317-armed.gif', contentType: 'image/gif' },
    ]);
    expect(md).toBe(
      '![Ready for another pass? Resolve this thread to ask](/uploads/ab12/latch-2317-armed.gif)'
    );
  });

  test('uploads once per variant', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    const v = { state: 'queued' as const, wait: 'cooldown' as const };
    const first = await bannerMarkdown(gw, mr, v, db);
    const second = await bannerMarkdown(gw, mr, v, db);
    expect(second).toBe(first);
    expect(calls).toEqual(['upload:latch-2317-queued-cooldown.gif']);
  });

  test('a pre-3x upload cached with a width is uploaded again and replaced', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    rememberUpload(
      MR,
      'running',
      '![Follow-up review running](/uploads/old1/latch-2317-running.gif){width=520}',
      db
    );
    const md = await bannerMarkdown(gw, mr, { state: 'running' }, db);
    const want =
      '![Follow-up review running. Results post here when done](/uploads/ab12/latch-2317-running.gif)';
    expect(md).toBe(want);
    expect(calls).toEqual(['upload:latch-2317-running.gif']);
    expect(cachedUpload(MR, 'running', db)).toBe(want);
  });

  test('a banner cached with older copy is uploaded again and replaced', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    rememberUpload(
      MR,
      'queued-next-sweep',
      '![Follow-up review queued. Starts on the next sweep](/uploads/old1/latch-2317-queued-next-sweep.gif)',
      db
    );
    const md = await bannerMarkdown(
      gw,
      mr,
      { state: 'queued', wait: 'next-sweep' },
      db
    );
    expect(md).toBe(
      '![Follow-up review queued. Starts in a few minutes](/uploads/ab12/latch-2317-queued-next-sweep.gif)'
    );
    expect(calls).toEqual(['upload:latch-2317-queued-next-sweep.gif']);
  });

  test('a different variant uploads its own banner', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    await bannerMarkdown(gw, mr, { state: 'running' }, db);
    await bannerMarkdown(gw, mr, { state: 'armed' }, db);
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
    const posted = await postLatch(gw, mr, db);
    expect(posted).toEqual({ discussionId: 'd1', rootNoteId: 1 });
    expect(calls).toEqual(['upload:latch-2317-armed.gif', 'createDiscussion']);
    expect(latchKindOf(bodies[0]!)).toBe('armed');
    expect(bodies[0]).toContain('](/uploads/ab12/latch-2317-armed.gif)\n');
    expect(bodies[0]).toContain('Resolve this thread');
  });
});

describe('GitHub banners', () => {
  test('the common set is the six banners an ordinary cycle shows', () => {
    expect(GITHUB_BANNER_SET.map(variantKey)).toEqual([
      'armed',
      'queued-next-sweep',
      'running',
      'done-comments-none',
      'done-approved',
      'approved',
    ]);
  });

  test('a GitHub arm uploads the common set in one batch', async () => {
    const db = tempDb();
    const { gw, calls, batches } = githubGateway();
    const posted = await postLatch(gw, mr, db);
    expect(posted).toEqual({ discussionId: 'gh1', rootNoteId: 5 });
    expect(calls).toEqual(['upload', 'createThread']);
    expect(batches).toEqual([
      GITHUB_BANNER_SET.map(v => `latch-2317-${variantKey(v)}.gif`),
    ]);
    for (const v of GITHUB_BANNER_SET) {
      const key = variantKey(v);
      expect(cachedUpload(MR, key, db)).toBe(
        `![${bannerAlt(v)}](https://github.com/user-attachments/latch-2317-${key}.gif)`
      );
    }
  });

  test('a later common banner reuses the batch', async () => {
    const db = tempDb();
    const { gw, batches } = githubGateway();
    await postLatch(gw, mr, db);
    const md = await bannerMarkdown(gw, mr, { state: 'running' }, db);
    expect(batches).toHaveLength(1);
    expect(md).toBe(cachedUpload(MR, 'running', db)!);
  });

  test('a common banner uploads only the members not yet cached', async () => {
    const db = tempDb();
    const { gw, batches } = githubGateway();
    for (const state of ['armed', 'approved'] as const)
      rememberUpload(MR, state, `![${bannerAlt({ state })}](/a.gif)`, db);
    rememberUpload(MR, 'done-approved', '![older copy](/b.gif)', db);
    await bannerMarkdown(gw, mr, { state: 'running' }, db);
    expect(batches).toEqual([
      [
        'latch-2317-queued-next-sweep.gif',
        'latch-2317-running.gif',
        'latch-2317-done-comments-none.gif',
        'latch-2317-done-approved.gif',
      ],
    ]);
  });

  test('a rare banner uploads alone on GitHub even with nothing cached', async () => {
    const db = tempDb();
    const { gw, batches } = githubGateway();
    const md = await bannerMarkdown(gw, mr, { state: 'error-stuck' }, db);
    expect(batches).toEqual([['latch-2317-error-stuck.gif']]);
    expect(md).toBe(
      '![Follow-up review stuck. Reviewer notified](https://github.com/user-attachments/latch-2317-error-stuck.gif)'
    );
    expect(cachedUpload(MR, 'armed', db)).toBeNull();
  });

  test('a GitLab arm still uploads one file', async () => {
    const db = tempDb();
    const { gw, uploads } = gateway();
    await postLatch(gw, mr, db);
    expect(uploads).toEqual([
      { filename: 'latch-2317-armed.gif', contentType: 'image/gif' },
    ]);
  });

  test('a failed thread post reuses the cached batch next tick', async () => {
    const db = tempDb();
    const { gw, calls, setThread } = githubGateway();
    let fail = true;
    setThread(async () => {
      if (fail) {
        fail = false;
        throw new Error('github 502');
      }
      return { discussionId: 'gh1', rootNoteId: 5 };
    });
    await expect(postLatch(gw, mr, db)).rejects.toThrow('github 502');
    expect(await postLatch(gw, mr, db)).toEqual({
      discussionId: 'gh1',
      rootNoteId: 5,
    });
    expect(calls).toEqual(['upload', 'createThread', 'createThread']);
  });

  test('a PR with no changed files is the no-files outcome', async () => {
    const db = tempDb();
    const { gw, setThread } = githubGateway();
    setThread(async () => null);
    expect(await postLatch(gw, mr, db)).toEqual({ noFiles: true });
  });

  test('the GitHub armed sentence names the PR', async () => {
    const db = tempDb();
    const { gw, bodies } = githubGateway();
    await postLatch(gw, mr, db);
    expect(bodies[0]).toContain("I'll take another pass over the PR.");
    expect(bodies[0]).not.toContain('MR');
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
    await spendLatch(gw, mr, armed, { state: 'approved' }, NOW, db);
    expect(calls).toEqual([
      'upload:latch-2317-approved.gif',
      'updateNote:1',
      'resolve:d1',
    ]);
    expect(latchKindOf(bodies[0]!)).toBe('spent');
    expect(bodies[0]).toContain('![Approved. Nothing more to do](');
    expect(bodies[0]!.trimEnd().endsWith(')')).toBe(true);
  });

  test('an already-spent latch that is resolved draws no writes', async () => {
    const db = tempDb();
    const { gw, calls } = gateway();
    await spendLatch(
      gw,
      mr,
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
      mr,
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
    await spendLatch(gw, mr, armed, { state: 'superseded' }, NOW, db);
    expect(bodies[0]).toContain('![Replaced. Use the newer thread](');
    expect(bodies[0]).not.toContain('Approved');
  });

  test('spending the canonical latch moves its row to spent', async () => {
    const db = tempDb();
    putLatchRow(row({ phase: 'running', variant: 'running' }), db);
    const { gw } = gateway();
    await spendLatch(gw, mr, armed, { state: 'approved' }, NOW, db);
    const r = readLatchRow(MR, db);
    expect(r?.phase).toBe('spent');
    expect(r?.variant).toBe('approved');
    expect(r?.updatedAt).toBe(NOW);
  });

  test("spending a duplicate leaves the canonical latch's row alone", async () => {
    const db = tempDb();
    putLatchRow(row({ discussionId: 'canon', rootNoteId: 7 }), db);
    const { gw } = gateway();
    await spendLatch(gw, mr, armed, { state: 'superseded' }, NOW, db);
    const r = readLatchRow(MR, db);
    expect(r?.phase).toBe('armed');
    expect(r?.variant).toBe('armed');
  });

  // landFollowUp may already have moved the row; the note still needs writing.
  test('a row already spent still gets the note rewritten and resolved', async () => {
    const db = tempDb();
    putLatchRow(row({ phase: 'spent', variant: 'running' }), db);
    const { gw, calls } = gateway();
    await spendLatch(gw, mr, armed, { state: 'done-approved' }, NOW, db);
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
      mr,
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
      mr,
      [armed, other],
      { state: 'superseded' },
      NOW,
      db
    );
    expect(
      bodies.every(b => b.includes('![Replaced. Use the newer thread]('))
    ).toBe(true);
  });
});

describe("gitlab gateway sends today's calls", () => {
  function gitlab() {
    const calls: unknown[][] = [];
    const clients: GitlabLatchClients = {
      mutator: {
        async uploadFile(...args) {
          calls.push(['uploadFile', ...args]);
          return {
            markdown: '![a](/u/a.gif)',
            url: '',
            alt: '',
            full_path: '',
          };
        },
        async createDiscussion(...args) {
          calls.push(['createDiscussion', ...args]);
          return { id: 'disc', notes: [{ id: 77 }] } as never;
        },
        async updateNote(...args) {
          calls.push(['updateNote', ...args]);
        },
        async createNote(...args) {
          calls.push(['createNote', ...args]);
          return { id: 9 } as never;
        },
      },
      provider: {
        async resolveDiscussion(...args) {
          calls.push(['resolveDiscussion', ...args]);
        },
        async unresolveDiscussion(...args) {
          calls.push(['unresolveDiscussion', ...args]);
        },
      },
    };
    return { gw: latchGateway('https://gitlab.com', 'tok', clients), calls };
  }

  test('names itself gitlab', () => {
    expect(gitlab().gw.forge).toBe('gitlab');
  });

  test('uploadFiles makes one uploadFile per file', async () => {
    const { gw, calls } = gitlab();
    const bytes = new Uint8Array([1, 2]);
    const md = await gw.uploadFiles(mr, [
      { filename: 'a.gif', bytes, contentType: 'image/gif', alt: 'a' },
    ]);
    expect(md).toEqual(['![a](/u/a.gif)']);
    expect(calls).toEqual([['uploadFile', 42, 'a.gif', bytes, 'image/gif']]);
  });

  test('createThread makes createDiscussion and returns the root note', async () => {
    const { gw, calls } = gitlab();
    expect(await gw.createThread(mr, 'hi')).toEqual({
      discussionId: 'disc',
      rootNoteId: 77,
    });
    expect(calls).toEqual([['createDiscussion', 42, 2317, 'hi']]);
  });

  test('createThread throws when the discussion has no root note', async () => {
    const empty = latchGateway('https://gitlab.com', 'tok', {
      mutator: {
        uploadFile: async () => ({}) as never,
        createDiscussion: async () => ({ id: 'x', notes: [] }) as never,
        updateNote: async () => {},
        createNote: async () => ({ id: 1 }) as never,
      },
      provider: {
        resolveDiscussion: async () => {},
        unresolveDiscussion: async () => {},
      },
    });
    await expect(empty.createThread(mr, 'hi')).rejects.toThrow(
      'latch post on !2317 returned no root note'
    );
  });

  test('updateNote and createNote address the project id', async () => {
    const { gw, calls } = gitlab();
    await gw.updateNote(mr, 5, 'body');
    await gw.createNote(mr, 'reply', 'disc');
    expect(calls).toEqual([
      ['updateNote', 42, 2317, 5, 'body'],
      ['createNote', 42, 2317, 'reply', 'disc'],
    ]);
  });

  test('resolve and unresolve address the project path', async () => {
    const { gw, calls } = gitlab();
    await gw.resolveDiscussion(mr, 'disc');
    await gw.unresolveDiscussion(mr, 'disc');
    expect(calls).toEqual([
      ['resolveDiscussion', 'acme/web', 2317, 'disc'],
      ['unresolveDiscussion', 'acme/web', 2317, 'disc'],
    ]);
  });

  test('a write that needs a project id throws without one', async () => {
    const { gw, calls } = gitlab();
    const noId = { ...mr, projectId: null };
    await expect(gw.createThread(noId, 'hi')).rejects.toThrow('no project id');
    await gw.resolveDiscussion(noId, 'disc');
    expect(calls).toEqual([['resolveDiscussion', 'acme/web', 2317, 'disc']]);
  });
});
