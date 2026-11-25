import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import type { SealBinding, SealFields, SealResult } from '@mattstack/rt-client';
import type { DraftEnvelope, ReviewStatePayload } from '../peer/envelope.ts';
import { drainOutbox, enqueueOutbox, readOutbox } from '../peer/outbox.ts';
import {
  outcomePreparer,
  peerUsername,
  sealedAsk,
  sealedReviewSyncEnvelopes,
  sealFields,
  stripPlainText,
  type SealDeps,
} from '../peer/sealed-send.ts';
import {
  askBinding,
  outcomeBinding,
  reviewStateBinding,
} from '../peer/sealed.ts';
import { openStateDb } from '../state/db.ts';

const MR = 'https://git.example.com/acme/app/-/merge_requests/7';

type Reply = { ok: boolean; data?: SealResult };

function sealing(reply: () => Reply, self: string | null = 'ada') {
  const calls: { to: string[]; binding: SealBinding; fields: SealFields }[] =
    [];
  const deps: SealDeps = {
    self: () => self,
    seal: async a => {
      calls.push(a);
      return reply();
    },
  };
  return { calls, deps };
}

const sealed = (unreachable: string[] = []): Reply => ({
  ok: true,
  data: { ok: true, sealed: 'YWdl', unreachable },
});
const refused = (reason: 'no-recipients' | 'unavailable'): Reply => ({
  ok: true,
  data: { ok: false, reason },
});
const down = (): Reply => {
  throw new Error('no socket');
};

describe('sealFields', () => {
  const binding: SealBinding = { type: 't', from: 'ada', subject: 's' };

  test('nothing to seal asks for nothing', async () => {
    const t = sealing(sealed);
    expect(await sealFields(t.deps, ['bob'], binding, {})).toEqual({
      unsent: false,
      unreachable: [],
    });
    expect(t.calls).toEqual([]);
  });

  test('answers the sealed text and who cannot read it', async () => {
    const t = sealing(() => sealed(['cy']));
    expect(
      await sealFields(t.deps, ['bob', 'cy'], binding, { note: 'hi' })
    ).toEqual({ sealed: 'YWdl', unsent: false, unreachable: ['cy'] });
    expect(t.calls).toEqual([
      { to: ['bob', 'cy'], binding, fields: { note: 'hi' } },
    ]);
  });

  test('never throws, and says when the text was not sent', async () => {
    expect(
      await sealFields(
        sealing(() => refused('no-recipients')).deps,
        [' Bob '],
        binding,
        { note: 'hi' }
      )
    ).toEqual({ unsent: true, unreachable: ['bob'] });
    for (const reply of [
      () => refused('unavailable'),
      () => ({ ok: false }),
      () => ({ ok: true }),
      down,
    ])
      expect(
        await sealFields(sealing(reply).deps, ['bob'], binding, { note: 'hi' })
      ).toEqual({ unsent: true, unreachable: [] });
  });
});

describe('an ask', () => {
  const text = { title: 'T', sourceBranch: 'b', note: 'N' };

  test('carries its address, its number and its sealed text, and nothing else', async () => {
    const t = sealing(sealed);
    const { draft, unsentWhy } = await sealedAsk(
      t.deps,
      'Bob',
      'review',
      { mrUrl: MR, iid: 7 },
      text
    );
    expect(draft).toMatchObject({ to: 'bob', type: 'review-request' });
    expect(draft.payload).toEqual({ mrUrl: MR, iid: 7, sealed: 'YWdl' });
    expect(unsentWhy).toBeUndefined();
    expect(t.calls).toEqual([
      {
        to: ['bob'],
        binding: askBinding(
          { type: 'review-request', from: 'ada', id: draft.id },
          MR
        ),
        fields: text,
      },
    ]);
  });

  test('leaves out text it was not given', async () => {
    const t = sealing(sealed);
    await sealedAsk(
      t.deps,
      'bob',
      're-review',
      { mrUrl: MR, iid: 7 },
      { title: 'T', sourceBranch: undefined, note: '' }
    );
    expect(t.calls[0]!.fields).toEqual({ title: 'T' });
  });

  test('goes out without its text when that cannot be sealed, and says why', async () => {
    for (const [deps, why] of [
      [sealing(() => refused('no-recipients')).deps, 'no-key'],
      [sealing(() => refused('unavailable')).deps, 'unavailable'],
      [sealing(down).deps, 'unavailable'],
      [sealing(sealed, null).deps, 'unavailable'],
    ] as const) {
      const { draft, unsentWhy } = await sealedAsk(
        deps,
        'bob',
        'respond',
        { mrUrl: MR, iid: 7 },
        text
      );
      expect(draft).toMatchObject({ to: 'bob', type: 'respond-request' });
      expect(draft.payload).toEqual({ mrUrl: MR, iid: 7 });
      expect(unsentWhy).toBe(why);
    }
  });
});

describe('an outcome', () => {
  const publish = (t: ReturnType<typeof sealing>) => {
    const queued: DraftEnvelope[] = [];
    return {
      queued,
      run: async (...a: Parameters<ReturnType<typeof outcomePreparer>>) => {
        const prepared = await outcomePreparer(
          t.deps,
          d => void queued.push(d)
        )(...a);
        expect(queued).toEqual([]);
        prepared.send();
        return prepared.noteReason;
      },
    };
  };
  const base = {
    mrUrl: MR,
    iid: 7,
    nudgeId: 'n1',
    result: 'rejected' as const,
  };

  test('a fixed reason stays readable and a note never does', async () => {
    const t = sealing(sealed);
    const p = publish(t);
    expect(
      await p.run('Bob', {
        ...base,
        declined: true,
        reason: 'busy right now',
        declineNote: 'in a meeting',
      })
    ).toBeUndefined();
    expect(p.queued[0]).toMatchObject({ to: 'bob', type: 'nudge-outcome' });
    expect(p.queued[0]!.payload).toEqual({
      ...base,
      declined: true,
      reason: 'busy right now',
      sealed: 'YWdl',
    });
    expect(t.calls).toEqual([
      {
        to: ['bob'],
        binding: outcomeBinding('ada', MR, 'n1'),
        fields: { declineNote: 'in a meeting' },
      },
    ]);
  });

  test('a reason the code did not write is sealed', async () => {
    const t = sealing(sealed);
    const p = publish(t);
    await p.run('bob', { ...base, reason: 'the database was down' });
    expect(p.queued[0]!.payload).toEqual({ ...base, sealed: 'YWdl' });
    expect(t.calls[0]!.fields).toEqual({ reason: 'the database was down' });
  });

  test('with no text nothing is sealed', async () => {
    const t = sealing(sealed);
    const p = publish(t);
    const q = publish(t);
    await p.run('bob', { ...base, result: 'launched' });
    await q.run('bob', { ...base, reason: 'cooldown' });
    expect(t.calls).toEqual([]);
    expect([...p.queued, ...q.queued].map(d => d.payload)).toEqual([
      { ...base, result: 'launched' },
      { ...base, reason: 'cooldown' },
    ]);
  });

  test('it goes out either way, and a note that did not go says why', async () => {
    for (const [t, why] of [
      [sealing(() => refused('no-recipients')), 'no-key'],
      [sealing(down), 'unavailable'],
      [sealing(sealed, null), 'unavailable'],
    ] as const) {
      const p = publish(t);
      expect(
        await p.run('bob', { ...base, declined: true, declineNote: 'private' })
      ).toBe(why);
      expect(p.queued[0]!.payload).toEqual({ ...base, declined: true });
    }
  });

  test('a reason that could not be sealed is dropped without a word', async () => {
    const p = publish(sealing(down));
    expect(
      await p.run('bob', { ...base, reason: 'the database was down' })
    ).toBeUndefined();
    expect(p.queued[0]!.payload).toEqual(base);
  });
});

describe('peerUsername', () => {
  const realHome = process.env.HOME;
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'peer-username-'));
    process.env.HOME = home;
  });
  afterEach(() => {
    process.env.HOME = realHome;
    rmSync(home, { recursive: true, force: true });
  });

  test('is the name recorded for the org, else the seat, else unknown', () => {
    expect(peerUsername('seat')).toBe('seat');
    expect(peerUsername('all')).toBeNull();
    expect(peerUsername('')).toBeNull();
    const orgDir = join(home, '.mattstack', 'orgs', 'acme', 'mattstack', 'org');
    mkdirSync(orgDir, { recursive: true });
    writeFileSync(join(orgDir, 'settings.org.jsonc'), '{}');
    const teams = join(home, '.mattstack', 'rt', 'teams');
    mkdirSync(teams, { recursive: true });
    writeFileSync(
      join(teams, 'acme.json'),
      JSON.stringify({ forgeUsername: 'recorded' })
    );
    expect(peerUsername('seat')).toBe('recorded');
    expect(peerUsername('all')).toBe('recorded');
  });
});

describe('a review state', () => {
  const payload: ReviewStatePayload = {
    mrUrl: MR,
    iid: 7,
    status: 'error',
    reason: 'could not check out the branch',
    updatedAt: 5,
  };
  const input = {
    author: 'Outsider',
    self: 'ada',
    recipients: (author: string) => [author.toLowerCase(), 'bob', 'cy'],
    payload,
    askId: 'n1',
  };

  test('one seal covers everyone it goes to, the author included', async () => {
    const t = sealing(() => sealed(['outsider']));
    const envelopes = await sealedReviewSyncEnvelopes(t.deps, input);
    expect(envelopes.map(e => e.to)).toEqual(['outsider', 'bob', 'cy']);
    const { reason: _, ...facts } = payload;
    expect(envelopes.map(e => e.payload)).toEqual([
      { ...facts, sealed: 'YWdl', nudgeId: 'n1' },
      { ...facts, sealed: 'YWdl' },
      { ...facts, sealed: 'YWdl' },
    ]);
    expect(t.calls).toEqual([
      {
        to: ['outsider', 'bob', 'cy'],
        binding: reviewStateBinding('ada', payload),
        fields: { reason: payload.reason! },
      },
    ]);
  });

  test('a reason that cannot be sealed is dropped and the state goes out', async () => {
    for (const t of [
      sealing(() => refused('no-recipients')),
      sealing(down),
      sealing(sealed, null),
    ]) {
      const envelopes = await sealedReviewSyncEnvelopes(t.deps, input);
      expect(envelopes).toHaveLength(3);
      expect(JSON.stringify(envelopes)).not.toContain('check out');
      expect(envelopes[1]!.payload).toEqual({
        mrUrl: MR,
        iid: 7,
        status: 'error',
        updatedAt: 5,
      });
    }
  });

  test('a fixed reason, or none, is sealed by no one', async () => {
    const t = sealing(sealed);
    for (const reason of ['pane closed', undefined]) {
      const envelopes = await sealedReviewSyncEnvelopes(t.deps, {
        ...input,
        payload: { ...payload, reason },
      });
      expect((envelopes[1]!.payload as ReviewStatePayload).reason).toBe(reason);
    }
    expect(t.calls).toEqual([]);
  });

  test('a state that goes to no one seals nothing', async () => {
    const t = sealing(sealed);
    expect(
      await sealedReviewSyncEnvelopes(t.deps, { ...input, author: 'ada' })
    ).toEqual([]);
    expect(t.calls).toEqual([]);
  });
});

describe('a row queued by an older board', () => {
  let dir: string;
  let db: Database;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'peer-sealed-send-'));
    db = openStateDb(join(dir, 'state.db'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const row = (id: string, type: string, payload: object): DraftEnvelope => ({
    id,
    to: 'bob',
    type,
    sentAt: 1,
    payload,
  });
  const facts = { mrUrl: MR, iid: 7 };

  test('is stripped of its text as it leaves, and in the queue when it stays', async () => {
    enqueueOutbox(
      row('e1', 'review-request', {
        ...facts,
        title: 'SECRET',
        sourceBranch: 'SECRET',
        note: 'SECRET',
      }),
      db
    );
    enqueueOutbox(
      row('e2', 'nudge-outcome', {
        ...facts,
        nudgeId: 'n1',
        result: 'rejected',
        reason: 'SECRET',
        declineNote: 'SECRET',
      }),
      db
    );
    enqueueOutbox(
      row('e3', 'nudge-outcome', {
        ...facts,
        nudgeId: 'n1',
        result: 'rejected',
        reason: 'not my area',
      }),
      db
    );
    const sent: DraftEnvelope[] = [];
    await drainOutbox(async d => {
      sent.push(d);
      return 503;
    }, db);
    expect(sent.map(d => d.payload)).toEqual([
      facts,
      { ...facts, nudgeId: 'n1', result: 'rejected' },
      { ...facts, nudgeId: 'n1', result: 'rejected', reason: 'not my area' },
    ]);
    expect(JSON.stringify(readOutbox(db))).not.toContain('SECRET');
  });

  test('keeps its sealed text', () => {
    const d = row('e1', 'review-request', { ...facts, sealed: 'YWdl' });
    expect(stripPlainText(d)).toEqual(d);
    const odd = row('e1', 'x', null as unknown as object);
    expect(stripPlainText(odd)).toEqual(odd);
  });
});
