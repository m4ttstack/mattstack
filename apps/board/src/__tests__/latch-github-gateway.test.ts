import { existsSync } from 'node:fs';
import { expect, test } from 'bun:test';

import { boardLatchGateway } from '../latch/board-gateway.ts';
import { githubLatchGateway } from '../latch/github-gateway.ts';
import type { LatchFile, LatchMr } from '../latch/post.ts';
import { stageFiles } from '../latch/stage.ts';

const mr: LatchMr = {
  projectId: null,
  projectPath: 'o/r',
  iid: 7,
  rtRepo: 'github.com/o/r',
};

type Call = { verb: string; payload: Record<string, unknown> };

function fake(reply: unknown) {
  const calls: Call[] = [];
  const command = (async (verb: string, payload: Record<string, unknown>) => {
    calls.push({ verb, payload });
    return typeof reply === 'function'
      ? (reply as (v: string) => unknown)(verb)
      : reply;
  }) as never;
  return { calls, command };
}

const files: LatchFile[] = [
  {
    filename: 'a.gif',
    bytes: new Uint8Array([1]),
    contentType: 'image/gif',
    alt: 'A',
  },
  {
    filename: 'b.gif',
    bytes: new Uint8Array([2]),
    contentType: 'image/gif',
    alt: 'B',
  },
];

test('uploadFiles sends staged paths, returns markdown in order and cleans up', async () => {
  const dirs: string[] = [];
  const f = fake({
    ok: true,
    data: { urls: { 'b.gif': 'https://x/b', 'a.gif': 'https://x/a' } },
  });
  const gw = githubLatchGateway({
    command: f.command,
    stage: async fs => {
      const s = await stageFiles(fs);
      dirs.push(s.dir);
      return s;
    },
  });
  const md = await gw.uploadFiles(mr, files);
  expect(md).toEqual(['![A](https://x/a)', '![B](https://x/b)']);
  expect(f.calls[0]!.verb).toBe('mr:attach-upload');
  const p = f.calls[0]!.payload as {
    repoName: string;
    iid: number;
    files: { path: string; name: string }[];
  };
  expect(p.repoName).toBe('github.com/o/r');
  expect(p.iid).toBe(7);
  expect(p.files.map(x => x.name)).toEqual(['a.gif', 'b.gif']);
  expect(existsSync(dirs[0]!)).toBe(false);
});

test('uploadFiles cleans up when the verb fails', async () => {
  const dirs: string[] = [];
  const f = fake({ ok: false, error: 'Error: mr:attach-upload failed: nope' });
  const gw = githubLatchGateway({
    command: f.command,
    stage: async fs => {
      const s = await stageFiles(fs);
      dirs.push(s.dir);
      return s;
    },
  });
  await expect(gw.uploadFiles(mr, files)).rejects.toThrow('nope');
  expect(existsSync(dirs[0]!)).toBe(false);
});

test('uploadFiles throws on a missing url', async () => {
  const f = fake({ ok: true, data: { urls: { 'a.gif': 'https://x/a' } } });
  const gw = githubLatchGateway({ command: f.command });
  await expect(gw.uploadFiles(mr, files)).rejects.toThrow('b.gif');
});

test('createThread maps the reply and the no-files fallback', async () => {
  const ok = fake({ ok: true, data: { discussionId: 'D1', noteId: 5 } });
  expect(
    await githubLatchGateway({ command: ok.command }).createThread(mr, 'hi')
  ).toEqual({
    discussionId: 'D1',
    rootNoteId: 5,
  });
  expect(ok.calls[0]).toEqual({
    verb: 'mr:comment-file',
    payload: { repoName: 'github.com/o/r', iid: 7, body: 'hi' },
  });
  const none = fake({ ok: true, data: { fallback: 'no-files' } });
  expect(
    await githubLatchGateway({ command: none.command }).createThread(mr, 'hi')
  ).toBeNull();
});

test('note and discussion verbs', async () => {
  const f = fake({ ok: true, data: { noteId: 9 } });
  const gw = githubLatchGateway({ command: f.command });
  await gw.updateNote(mr, 3, 'b');
  await gw.resolveDiscussion(mr, 'D');
  await gw.unresolveDiscussion(mr, 'D');
  expect(await gw.createNote(mr, 'r', 'D')).toEqual({ id: 9 });
  const base = { repoName: 'github.com/o/r', iid: 7 };
  expect(f.calls).toEqual([
    { verb: 'mr:note-update', payload: { ...base, noteId: 3, body: 'b' } },
    {
      verb: 'discussions:resolve',
      payload: { ...base, discussionId: 'D', resolved: true },
    },
    {
      verb: 'discussions:resolve',
      payload: { ...base, discussionId: 'D', resolved: false },
    },
    {
      verb: 'discussions:reply',
      payload: { ...base, discussionId: 'D', body: 'r' },
    },
  ]);
});

test('a daemon failure throws its reason', async () => {
  const f = fake({ ok: false, error: 'Error: mr:comment-file failed: nope' });
  await expect(
    githubLatchGateway({ command: f.command }).createThread(mr, 'x')
  ).rejects.toThrow(/^nope$/);
});

test('an unknown repo identity throws without calling the daemon', async () => {
  const f = fake({ ok: true, data: {} });
  await expect(
    githubLatchGateway({ command: f.command }).updateNote(
      { ...mr, rtRepo: '' },
      1,
      'b'
    )
  ).rejects.toThrow();
  expect(f.calls).toEqual([]);
});

test('boardLatchGateway picks by forge', () => {
  const cfg = (kind: 'gitlab' | 'github') =>
    ({ forge: { kind, host: 'h.example' } }) as never;
  expect(boardLatchGateway(cfg('gitlab'), null)).toBeNull();
  expect(boardLatchGateway(cfg('gitlab'), 'tok')!.forge).toBe('gitlab');
  expect(boardLatchGateway(cfg('github'), null)!.forge).toBe('github');
});
