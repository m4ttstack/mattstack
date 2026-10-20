import { describe, expect, test } from 'bun:test';

import type { MRDetail } from '@mattstack/glance';
import { armedLatchBody } from '../latch/markers.ts';
import { respondTargets } from '../respond-targets.ts';

const AUTHOR = 'dorothy';
let noteId = 0;

function note(
  username: string,
  opts: {
    resolvable?: boolean;
    resolved?: boolean;
    body?: string;
    at?: string;
    name?: string;
  } = {}
) {
  return {
    id: ++noteId,
    body: opts.body ?? 'a comment',
    author: {
      id: `gitlab:user:${username}`,
      username,
      name: opts.name ?? username[0]!.toUpperCase() + username.slice(1),
      avatarUrl: null,
    },
    createdAt: opts.at ?? '2026-07-10T00:00:00Z',
    system: false,
    type: 'DiscussionNote',
    resolvable: opts.resolvable ?? true,
    resolved: opts.resolved ?? false,
    position: null,
  };
}

function detail(discussions: Array<ReturnType<typeof note>[]>): MRDetail {
  return {
    mrIid: 1,
    repositoryId: 'gitlab:42',
    discussions: discussions.map((notes, i) => ({
      id: `d${i}`,
      resolvable: null,
      resolved: null,
      notes,
    })),
  } as unknown as MRDetail;
}

const overview = (u: string, at?: string, name?: string) =>
  note(u, { resolvable: false, at, name });

describe('respondTargets', () => {
  test("counts a person's awaiting threads and open Overview comments together", () => {
    const d = detail([
      [note('john')],
      [note('john', { resolved: true })],
      [overview('john')],
      [overview('john')],
      [overview('john')],
    ]);
    expect(respondTargets(d, AUTHOR)).toEqual([
      { username: 'john', name: 'John', openThreads: 1, openComments: 3 },
    ]);
  });

  test("drops a thread whose last note is the author's", () => {
    const d = detail([[note('john'), note(AUTHOR)]]);
    expect(respondTargets(d, AUTHOR)).toEqual([]);
  });

  test('an Overview comment the author replied on is answered', () => {
    const d = detail([[overview('john'), overview(AUTHOR)]]);
    expect(respondTargets(d, AUTHOR)).toEqual([]);
  });

  test('an Overview comment followed by a later author Overview comment is answered', () => {
    const d = detail([
      [overview('john', '2026-07-10T00:00:00Z')],
      [overview(AUTHOR, '2026-07-11T00:00:00Z')],
    ]);
    expect(respondTargets(d, AUTHOR)).toEqual([]);
  });

  test("a third person's reply on an Overview comment does not answer it", () => {
    const d = detail([[overview('john'), overview('priya')]]);
    const john = respondTargets(d, AUTHOR).find(t => t.username === 'john');
    expect(john?.openComments).toBe(1);
  });

  test('excludes the author, bots and latch threads', () => {
    const d = detail([
      [overview(AUTHOR)],
      [note(AUTHOR)],
      [note('review-bot')],
      [overview('review-bot')],
      [note('danger', { name: 'Danger' })],
      [overview('danger', undefined, 'Danger')],
      [note('john', { body: armedLatchBody('![x](y)') })],
    ]);
    expect(respondTargets(d, AUTHOR, ['Danger'])).toEqual([]);
  });

  test('an author-started thread John replied to last makes no target', () => {
    const d = detail([[note(AUTHOR), note('john')]]);
    expect(respondTargets(d, AUTHOR)).toEqual([]);
  });

  test('a bot-started thread John replied to last makes no target', () => {
    const d = detail([[note('review-bot'), note('john')]]);
    expect(respondTargets(d, AUTHOR)).toEqual([]);
  });

  test("an author Overview note earlier than John's comment does not answer it", () => {
    const d = detail([
      [overview(AUTHOR, '2026-07-09T00:00:00Z')],
      [overview('john', '2026-07-10T00:00:00Z')],
    ]);
    expect(respondTargets(d, AUTHOR)[0]?.openComments).toBe(1);
  });

  test('omits people with nothing open', () => {
    const d = detail([[note('john', { resolved: true })]]);
    expect(respondTargets(d, AUTHOR)).toEqual([]);
  });

  test('sorts by display name', () => {
    const d = detail([
      [note('zed', { name: 'Darryl' })],
      [note('amy', { name: 'Priya' })],
      [note('bob', { name: 'John' })],
    ]);
    expect(respondTargets(d, AUTHOR).map(t => t.name)).toEqual([
      'Darryl',
      'John',
      'Priya',
    ]);
  });
});
