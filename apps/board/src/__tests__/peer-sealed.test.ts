import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  ANNOUNCEMENT_PLACEHOLDER,
  announcementBinding,
  type OpenResult,
  type SealBinding,
  type SealFields,
} from '@mattstack/rt-client';
import { buildAskInbox, openAskTitle } from '../peer/ask-inbox.ts';
import {
  parseNudgeOutcomePayload,
  parseReReviewRequestPayload,
  parseReviewStatePayload,
  type Envelope,
} from '../peer/envelope.ts';
import { materializeEnvelope, runPeerTick } from '../peer/inbox.ts';
import { boardMaterializeDeps } from '../peer/materialize-deps.ts';
import {
  finishSentNudge,
  readNudges,
  readSentNudges,
  resolveSentNudge,
  sentNudgeView,
  writeNudge,
  writeSentNudge,
  type NudgeState,
  type SentNudge,
} from '../peer/nudges.ts';
import {
  attachPeerReviews,
  readPeerReviews,
  writePeerReview,
  type PeerReviewState,
} from '../peer/peer-reviews.ts';
import {
  ANNOUNCEMENT_MAX_AGE_MS,
  keepAnnouncement,
  openKeptAnnouncements,
  SEALED_ANNOUNCEMENT_NS,
} from '../peer/sealed-announcements.ts';
import {
  askBinding,
  createSealedReader,
  openOnce,
  outcomeBinding,
  reviewStateBinding,
  WIRE_REASONS,
  type SealedReader,
} from '../peer/sealed.ts';
import { openStateDb } from '../state/db.ts';
import { listKvValues } from '../state/kv-blob.ts';

const MR = 'https://git.example.com/acme/app/-/merge_requests/7';

let dir: string;
let db: Database;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'peer-sealed-'));
  db = openStateDb(join(dir, 'state.db'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Reply = {
  ok: boolean;
  data?: OpenResult;
  failure?: { code: string; message: string };
};

/** The daemon: `reply` answers every open, after the test lets it. */
function daemon(reply: () => Reply | Promise<Reply>) {
  const calls: { sealed: string; binding: SealBinding }[] = [];
  return {
    calls,
    open: async (a: { sealed: string; binding: SealBinding }) => {
      calls.push(a);
      return reply();
    },
  };
}

const opened = (fields: SealFields): Reply => ({
  ok: true,
  data: { ok: true, fields },
});
const refused = (
  reason: Extract<OpenResult, { ok: false }>['reason']
): Reply => ({ ok: true, data: { ok: false, reason } });
const settle = () => Bun.sleep(2);

/** A reader that has already opened everything to `fields`. */
const openReader = (fields: SealFields): SealedReader => ({
  read: () => ({ state: 'open', fields }),
});
const stuckReader = (state: 'pending' | 'unreadable'): SealedReader => ({
  read: () => ({ state }),
});

const BINDING: SealBinding = {
  type: 're-review-request',
  from: 'ada',
  subject: `${MR} e1`,
};

describe('payload parsers', () => {
  const ask = { mrUrl: MR, iid: 7 };
  const outcome = { ...ask, nudgeId: 'n1', result: 'rejected' };
  const state = { ...ask, status: 'error', updatedAt: 5 };

  test('keep sealed text and refuse one that is not a string', () => {
    for (const [parse, payload] of [
      [parseReReviewRequestPayload, ask],
      [parseNudgeOutcomePayload, outcome],
      [parseReviewStatePayload, state],
    ] as const) {
      expect(parse({ ...payload, sealed: 'YWdl' })?.sealed).toBe('YWdl');
      expect(parse(payload)?.sealed).toBeUndefined();
      expect(parse({ ...payload, sealed: 7 })).toBeNull();
      expect(parse({ ...payload, sealed: null })).toBeNull();
    }
  });
});

describe('bindings', () => {
  test('name the message they belong to', () => {
    expect(
      askBinding({ type: 'review-request', from: 'ada', id: 'e1' }, MR)
    ).toEqual({ type: 'review-request', from: 'ada', subject: `${MR} e1` });
    expect(outcomeBinding('ada', MR, 'n1')).toEqual({
      type: 'nudge-outcome',
      from: 'ada',
      subject: `${MR} n1`,
    });
    expect(
      reviewStateBinding('ada', { mrUrl: MR, status: 'error', updatedAt: 5 })
    ).toEqual({ type: 'review-state', from: 'ada', subject: `${MR} error 5` });
  });
});

describe('the sealed reader', () => {
  test('answers pending, opens once, says it changed, then answers from memory', async () => {
    let changed = 0;
    const d = daemon(() => opened({ note: 'hi' }));
    const reader = createSealedReader({
      open: d.open,
      changed: () => changed++,
      now: () => 0,
    });
    for (let i = 0; i < 3; i++)
      expect(reader.read('YWdl', BINDING)).toEqual({ state: 'pending' });
    await settle();
    expect(changed).toBe(1);
    expect(reader.read('YWdl', BINDING)).toEqual({
      state: 'open',
      fields: { note: 'hi' },
    });
    expect(d.calls).toEqual([{ sealed: 'YWdl', binding: BINDING }]);
  });

  test('one string under two bindings is read twice', async () => {
    const d = daemon(() => opened({ note: 'hi' }));
    const reader = createSealedReader({
      open: d.open,
      changed() {},
      now: () => 0,
    });
    reader.read('YWdl', BINDING);
    reader.read('YWdl', { ...BINDING, subject: 'other' });
    await settle();
    expect(d.calls).toHaveLength(2);
  });

  test('a daemon that is down or a locked key stays pending, and is asked again no sooner than 30 seconds later', async () => {
    for (const reply of [
      () => refused('unavailable'),
      () => ({ ok: false }),
      () => ({ ok: true }),
      () => {
        throw new Error('no socket');
      },
    ]) {
      let now = 0;
      let changed = 0;
      const d = daemon(reply as () => Reply);
      const reader = createSealedReader({
        open: d.open,
        changed: () => changed++,
        now: () => now,
      });
      reader.read('YWdl', BINDING);
      await settle();
      now = 29_999;
      expect(reader.read('YWdl', BINDING)).toEqual({ state: 'pending' });
      await settle();
      expect(d.calls).toHaveLength(1);
      now = 30_000;
      reader.read('YWdl', BINDING);
      await settle();
      expect(d.calls).toHaveLength(2);
      expect(changed).toBe(0);
    }
  });

  test('text that can never open is unreadable and never asked for again', async () => {
    for (const reply of [
      refused('not-for-this-key'),
      refused('mismatch'),
      refused('damaged'),
      { ok: false, failure: { code: 'text-invalid', message: 'too long' } },
    ]) {
      let now = 0;
      let changed = 0;
      const d = daemon(() => reply);
      const reader = createSealedReader({
        open: d.open,
        changed: () => changed++,
        now: () => now,
      });
      reader.read('YWdl', BINDING);
      await settle();
      now = 10 * 60_000;
      expect(reader.read('YWdl', BINDING)).toEqual({ state: 'unreadable' });
      await settle();
      expect(d.calls).toHaveLength(1);
      expect(changed).toBe(1);
    }
  });

  test('at most four are asked for at once, and the rest follow', async () => {
    const waiting: ((r: Reply) => void)[] = [];
    const d = daemon(
      () => new Promise<Reply>(resolve => waiting.push(resolve))
    );
    const reader = createSealedReader({
      open: d.open,
      changed() {},
      now: () => 0,
    });
    for (let i = 0; i < 10; i++) reader.read(`s${i}`, BINDING);
    await settle();
    expect(d.calls).toHaveLength(4);
    for (let i = 0; i < 10; i++) {
      waiting[i]!(opened({ note: `${i}` }));
      await settle();
    }
    expect(d.calls).toHaveLength(10);
    expect(reader.read('s9', BINDING)).toEqual({
      state: 'open',
      fields: { note: '9' },
    });
  });

  test('holds 500, letting go of the one looked at longest ago', async () => {
    let now = 0;
    const d = daemon(() => opened({ note: 'hi' }));
    const reader = createSealedReader({
      open: d.open,
      changed() {},
      now: () => now,
    });
    for (let i = 0; i < 500; i++) {
      reader.read(`s${i}`, BINDING);
      await Promise.resolve();
    }
    await Bun.sleep(20);
    now = 120_000;
    expect(reader.read('s0', BINDING).state).toBe('open');
    reader.read('s500', BINDING);
    await settle();
    expect(reader.read('s0', BINDING).state).toBe('open');
    expect(d.calls).toHaveLength(501);
    expect(reader.read('s1', BINDING).state).toBe('pending');
    await settle();
    expect(d.calls).toHaveLength(502);
  });

  test('more than 500 on screen at once does not open the same ones over and over', async () => {
    const d = daemon(() => opened({ note: 'hi' }));
    const reader = createSealedReader({
      open: d.open,
      changed() {},
      now: () => 0,
    });
    for (let draw = 0; draw < 3; draw++) {
      for (let i = 0; i < 520; i++) reader.read(`s${i}`, BINDING);
      await Bun.sleep(20);
    }
    expect(d.calls).toHaveLength(500);
    expect(reader.read('s510', BINDING)).toEqual({ state: 'pending' });
  });

  test('text longer than the daemon looks at is unreadable without asking', async () => {
    const d = daemon(() => opened({ note: 'hi' }));
    const reader = createSealedReader({
      open: d.open,
      changed() {},
      now: () => 0,
    });
    const long = 'A'.repeat(256 * 1024 + 1);
    expect(reader.read(long, BINDING)).toEqual({ state: 'unreadable' });
    expect(await openOnce(d.open, long, BINDING)).toEqual({
      state: 'unreadable',
    });
    expect(d.calls).toEqual([]);
  });

  test('openOnce answers the fields or nothing, whatever the daemon does', async () => {
    expect(
      await openOnce(daemon(() => opened({ note: 'hi' })).open, 'YWdl', BINDING)
    ).toEqual({ state: 'open', fields: { note: 'hi' } });
    expect(
      await openOnce(daemon(() => refused('mismatch')).open, 'YWdl', BINDING)
    ).toEqual({ state: 'unreadable' });
    const down = daemon(() => {
      throw new Error('no socket');
    });
    expect(await openOnce(down.open, 'YWdl', BINDING)).toEqual({
      state: 'pending',
    });
  });
});

function envelope(over: Partial<Envelope>): Envelope {
  return {
    id: 'e1',
    to: 'bob',
    from: 'ada',
    type: 're-review-request',
    sentAt: 1,
    receivedAt: 2,
    payload: {},
    ...over,
  };
}

const deps = () => ({
  ...boardMaterializeDeps(() => {}),
  writeNudge: (n: NudgeState) => writeNudge(n, db),
});

describe('asks', () => {
  test('a sealed ask is stored without its plain text and without opening anything', () => {
    materializeEnvelope(
      envelope({
        payload: {
          mrUrl: MR,
          iid: 7,
          sealed: 'YWdl',
          title: 'plain',
          note: 'plain',
          sourceBranch: 'plain',
        },
      }),
      deps(),
      10
    );
    const [n] = readNudges(db);
    expect(n).toMatchObject({ id: 'e1', mrUrl: MR, sealed: 'YWdl' });
    expect(JSON.stringify(n)).not.toContain('plain');
  });

  test('a sealed ask is acked', async () => {
    const acked: string[][] = [];
    const client = {
      publish: async () => 201,
      inbox: async () => [
        envelope({ payload: { mrUrl: MR, iid: 7, sealed: 'YWdl' } }),
      ],
      ack: async (ids: string[]) => {
        acked.push(ids);
        return true;
      },
      peers: async () => null,
      enrolled: async () => null,
      setAsksEnabled: async () => 'ok' as const,
    };
    await runPeerTick(
      client,
      { ...deps(), openAnnouncements: async () => {} },
      db
    );
    expect(acked).toEqual([['e1']]);
    expect(readNudges(db)).toHaveLength(1);
  });

  const sealedAsk: NudgeState = {
    id: 'e1',
    mrUrl: MR,
    iid: 7,
    from: 'ada',
    receivedAt: 2,
    sealed: 'YWdl',
  };

  test('shows the opened title, branch and note', () => {
    const seen: SealBinding[] = [];
    const reader: SealedReader = {
      read: (_s, b) => {
        seen.push(b);
        return {
          state: 'open',
          fields: {
            title: 'T',
            sourceBranch: 'b',
            note: 'N',
            other: 'x',
            textState: 'spoof',
          },
        };
      },
    };
    const { pending } = buildAskInbox(
      [
        sealedAsk,
        { ...sealedAsk, id: 'e2', kind: 'review' },
        { ...sealedAsk, id: 'e3', kind: 'respond' },
      ],
      10,
      reader
    );
    expect(pending[0]).toMatchObject({
      title: 'T',
      sourceBranch: 'b',
      note: 'N',
    });
    expect(pending[0]).not.toHaveProperty('textState');
    expect(pending[0]).not.toHaveProperty('sealed');
    expect(pending[0]).not.toHaveProperty('other');
    expect(seen).toEqual([
      askBinding({ type: 're-review-request', from: 'ada', id: 'e1' }, MR),
      askBinding({ type: 'review-request', from: 'ada', id: 'e2' }, MR),
      askBinding({ type: 'respond-request', from: 'ada', id: 'e3' }, MR),
    ]);
  });

  test('says when its text is not open yet, or never will be', () => {
    const withPlain = { ...sealedAsk, title: 'plain', note: 'plain' };
    for (const state of ['pending', 'unreadable'] as const) {
      const { pending } = buildAskInbox([withPlain], 10, stuckReader(state));
      expect(pending[0]).toMatchObject({ textState: state });
      expect(JSON.stringify(pending)).not.toContain('plain');
    }
    expect(buildAskInbox([sealedAsk], 10).pending[0]).toMatchObject({
      textState: 'pending',
    });
  });

  test('a notice reads the title once, or goes without it', async () => {
    const d = daemon(() => opened({ title: 'T', note: 'N' }));
    expect(await openAskTitle(sealedAsk, d.open)).toBe('T');
    expect(d.calls).toEqual([
      {
        sealed: 'YWdl',
        binding: askBinding(
          { type: 're-review-request', from: 'ada', id: 'e1' },
          MR
        ),
      },
    ]);
    for (const reply of [refused('unavailable'), refused('mismatch')])
      expect(
        await openAskTitle(
          { ...sealedAsk, title: 'plain' },
          daemon(() => reply).open
        )
      ).toBeUndefined();
    expect(
      await openAskTitle(
        { ...sealedAsk, sealed: undefined, title: 'plain' },
        d.open
      )
    ).toBe('plain');
  });

  test('an older board’s plain ask still shows its title and note', () => {
    materializeEnvelope(
      envelope({
        payload: {
          mrUrl: MR,
          iid: 7,
          title: 'T',
          note: 'N',
          sourceBranch: 'b',
        },
      }),
      deps(),
      10
    );
    const { pending } = buildAskInbox(
      readNudges(db),
      20,
      stuckReader('unreadable')
    );
    expect(pending[0]).toMatchObject({
      title: 'T',
      note: 'N',
      sourceBranch: 'b',
    });
    expect(pending[0]).not.toHaveProperty('textState');
  });
});

describe('outcomes', () => {
  const sent: SentNudge = {
    nudgeId: 'n1',
    mrUrl: MR,
    iid: 7,
    reviewer: 'ada',
    sentAt: 1,
  };
  const outcome = (payload: object) => {
    writeSentNudge(sent, db);
    const real = boardMaterializeDeps(() => {});
    materializeEnvelope(
      envelope({
        type: 'nudge-outcome',
        payload: {
          mrUrl: MR,
          iid: 7,
          nudgeId: 'n1',
          result: 'rejected',
          ...payload,
        },
      }),
      {
        ...real,
        resolveSentNudge: (mrUrl, r, from) =>
          resolveSentNudge(mrUrl, r, db, from),
      },
      10
    );
    return readSentNudges(db).get(MR)!;
  };

  test('a sealed decline shows its opened note beside its fixed reason', () => {
    const n = outcome({
      declined: true,
      reason: 'busy right now',
      sealed: 'YWdl',
      declineNote: 'plain',
    });
    expect(JSON.stringify(n)).not.toContain('plain');
    expect(n.resolution).toMatchObject({
      sealed: 'YWdl',
      sealedAs: outcomeBinding('ada', MR, 'n1'),
    });
    expect(
      sentNudgeView(n, 11, openReader({ declineNote: 'in a meeting' }))
    ).toMatchObject({
      declined: true,
      reason: 'busy right now',
      declineNote: 'in a meeting',
    });
    for (const reader of [
      undefined,
      stuckReader('pending'),
      stuckReader('unreadable'),
    ]) {
      const view = sentNudgeView(n, 11, reader)!;
      expect(view).toMatchObject({ declined: true, reason: 'busy right now' });
      expect(view.declineNote).toBeUndefined();
    }
  });

  test('beside sealed text only a fixed plain reason counts', () => {
    expect(
      outcome({ sealed: 'YWdl', reason: 'made up' }).resolution!.reason
    ).toBeUndefined();
    expect(
      outcome({ sealed: 'YWdl', reason: 'cooldown' }).resolution!.reason
    ).toBe('cooldown');
  });

  test('a sealed reason shows once opened', () => {
    const n = outcome({ sealed: 'YWdl' });
    expect(
      sentNudgeView(n, 11, openReader({ reason: 'no agent here' }))
    ).toMatchObject({ reason: 'no agent here' });
    expect(
      sentNudgeView(n, 11, stuckReader('pending'))!.reason
    ).toBeUndefined();
  });

  test('an older board’s plain reason and note show as they did', () => {
    const n = outcome({
      declined: true,
      reason: 'some words',
      declineNote: 'plain',
    });
    expect(sentNudgeView(n, 11, stuckReader('unreadable'))).toMatchObject({
      reason: 'some words',
      declineNote: 'plain',
    });
  });
});

describe('review states', () => {
  const arrive = (payload: object): PeerReviewState => {
    const real = boardMaterializeDeps(() => {});
    let written: PeerReviewState | undefined;
    materializeEnvelope(
      envelope({
        type: 'review-state',
        payload: {
          mrUrl: MR,
          iid: 7,
          status: 'error',
          updatedAt: 5,
          ...payload,
        },
      }),
      {
        ...real,
        writePeerReview: s => void (written = s),
        resolveSentNudge() {},
        finishSentNudge() {},
      },
      10
    );
    return written!;
  };
  const attach = (s: PeerReviewState, reader?: SealedReader) =>
    attachPeerReviews([{ webUrl: MR }], new Map([[MR, [s]]]), reader)[0]!
      .peerReviews![0]!;

  test('a sealed reason shows once opened, and never reaches the page sealed', () => {
    const s = arrive({ sealed: 'YWdl' });
    const seen: SealBinding[] = [];
    const reader: SealedReader = {
      read: (_s, b) => {
        seen.push(b);
        return { state: 'open', fields: { reason: 'could not check out' } };
      },
    };
    expect(attach(s, reader)).toEqual({
      mrUrl: MR,
      iid: 7,
      reviewer: 'ada',
      status: 'error',
      updatedAt: 5,
      receivedAt: 2,
      reason: 'could not check out',
    });
    expect(seen).toEqual([
      reviewStateBinding('ada', { mrUrl: MR, status: 'error', updatedAt: 5 }),
    ]);
    for (const r of [
      undefined,
      stuckReader('pending'),
      stuckReader('unreadable'),
    ]) {
      expect(attach(s, r).reason).toBeUndefined();
      expect(attach(s, r)).not.toHaveProperty('sealed');
    }
  });

  test('beside sealed text only a fixed plain reason counts', () => {
    expect(
      arrive({ sealed: 'YWdl', reason: 'made up' }).reason
    ).toBeUndefined();
    expect(arrive({ sealed: 'YWdl', reason: 'pane closed' }).reason).toBe(
      'pane closed'
    );
  });

  test('a plain reason shows as it did', () => {
    expect(
      attach(arrive({ reason: 'pane closed' }), stuckReader('unreadable'))
        .reason
    ).toBe('pane closed');
  });

  test('a finished ask carries the sealed reason with its binding', () => {
    writeSentNudge(
      { nudgeId: 'n1', mrUrl: MR, iid: 7, reviewer: 'ada', sentAt: 1 },
      db
    );
    const real = boardMaterializeDeps(() => {});
    materializeEnvelope(
      envelope({
        type: 'review-state',
        payload: {
          mrUrl: MR,
          iid: 7,
          status: 'error',
          updatedAt: 5,
          nudgeId: 'n1',
          sealed: 'YWdl',
          reason: 'made up',
        },
      }),
      {
        ...real,
        writePeerReview: () => true,
        finishSentNudge: (mrUrl, finish, before, nudgeId, from) =>
          finishSentNudge(mrUrl, finish, before, db, nudgeId, from),
      },
      10
    );
    const n = readSentNudges(db).get(MR)!;
    expect(n.resolution).not.toHaveProperty('reason');
    expect(n.resolution).toMatchObject({
      result: 'failed',
      sealed: 'YWdl',
      sealedAs: reviewStateBinding('ada', {
        mrUrl: MR,
        status: 'error',
        updatedAt: 5,
      }),
    });
    expect(
      sentNudgeView(n, 11, openReader({ reason: 'could not check out' }))
    ).toMatchObject({ reason: 'could not check out' });
  });

  test('the stored row keeps the sealed text', () => {
    const real = boardMaterializeDeps(() => {});
    materializeEnvelope(
      envelope({
        type: 'review-state',
        payload: {
          mrUrl: MR,
          iid: 7,
          status: 'error',
          updatedAt: 5,
          sealed: 'YWdl',
        },
      }),
      {
        ...real,
        writePeerReview: s => writePeerReview(s, db),
        resolveSentNudge() {},
        finishSentNudge() {},
      },
      10
    );
    expect(readPeerReviews(db).get(MR)![0]!.sealed).toBe('YWdl');
  });
});

describe('WIRE_REASONS', () => {
  test('holds every reason a decision can give', () => {
    const source = readFileSync(
      join(import.meta.dir, '..', 'triage', 'nudge.ts'),
      'utf8'
    );
    const decided = [
      ...source.matchAll(/action: '(?:reject|expire)', reason: '([a-z-]+)'/g),
    ].map(m => m[1]!);
    expect(decided.length).toBeGreaterThan(5);
    expect(decided.filter(r => !WIRE_REASONS.has(r))).toEqual([]);
  });

  test('holds what the code itself writes, and no free text', () => {
    for (const r of [
      'cooldown',
      'asks-off',
      'launch-failed',
      'stale',
      'busy right now',
      'not my area',
      'ask me later',
      'pane closed',
      'review held',
      'abandoned',
      'pruned',
      'closed',
    ]) {
      expect(WIRE_REASONS.has(r)).toBe(true);
    }
    expect(WIRE_REASONS.has('the database was down')).toBe(false);
    expect(WIRE_REASONS.has('')).toBe(false);
  });
});

describe('announcements', () => {
  const NOW = 1_800_000_000_000;
  const kept = (over: object = {}) => ({
    id: 'a1',
    from: 'admin1',
    receivedAt: NOW,
    sealed: 'YWdl',
    ...over,
  });
  function io(reply: () => Reply) {
    const d = daemon(reply);
    const shown: {
      id: string;
      title: string;
      message: string;
      from: string;
    }[] = [];
    return {
      d,
      shown,
      run: (now = NOW) =>
        openKeptAnnouncements(
          {
            open: d.open,
            notify: async (id, p, from) =>
              void shown.push({ id, title: p.title, message: p.message, from }),
            log() {},
          },
          now,
          db
        ),
    };
  }
  const keptRows = () => listKvValues(SEALED_ANNOUNCEMENT_NS, db).size;

  test('a sealed one is kept, and the plain words on it are not shown', () => {
    const shown: unknown[] = [];
    const keeps: unknown[] = [];
    materializeEnvelope(
      envelope({
        id: 'a1',
        from: 'admin1',
        type: 'announcement',
        receivedAt: NOW,
        payload: { ...ANNOUNCEMENT_PLACEHOLDER, sealed: 'YWdl' },
      }),
      {
        ...boardMaterializeDeps(() => {}),
        isOrgAdmin: () => true,
        notifyAnnouncement: async (...a) => void shown.push(a),
        keepAnnouncement: a => void keeps.push(a),
      },
      NOW
    );
    expect(shown).toEqual([]);
    expect(keeps).toEqual([kept()]);
  });

  test('a relay clock ahead of this Mac does not keep one forever', () => {
    const keeps: { receivedAt: number }[] = [];
    materializeEnvelope(
      envelope({
        id: 'a1',
        from: 'admin1',
        type: 'announcement',
        receivedAt: NOW + 10 * ANNOUNCEMENT_MAX_AGE_MS,
        payload: { ...ANNOUNCEMENT_PLACEHOLDER, sealed: 'YWdl' },
      }),
      {
        ...boardMaterializeDeps(() => {}),
        isOrgAdmin: () => true,
        keepAnnouncement: a => void keeps.push(a),
      },
      NOW
    );
    expect(keeps[0]!.receivedAt).toBe(NOW);
  });

  test('one that opens shows its text once', async () => {
    keepAnnouncement(kept(), db);
    const t = io(() => opened({ title: 'Update rt', message: 'Today please' }));
    await t.run();
    await t.run();
    expect(t.shown).toEqual([
      { id: 'a1', title: 'Update rt', message: 'Today please', from: 'admin1' },
    ]);
    expect(t.d.calls).toEqual([
      { sealed: 'YWdl', binding: announcementBinding('a1', 'admin1') },
    ]);
    expect(keptRows()).toBe(0);
  });

  test('one that cannot open yet is kept and tried by the next tick', async () => {
    keepAnnouncement(kept(), db);
    let reply: Reply = refused('unavailable');
    const t = io(() => reply);
    await t.run();
    expect(t.shown).toEqual([]);
    expect(keptRows()).toBe(1);
    reply = opened({ title: 'Update rt', message: 'Today please' });
    await t.run(NOW + 60_000);
    expect(t.shown).toHaveLength(1);
  });

  test('a tick asks once while nothing can open', async () => {
    for (const id of ['a1', 'a2', 'a3']) keepAnnouncement(kept({ id }), db);
    const t = io(() => refused('unavailable'));
    await t.run();
    expect(t.d.calls).toHaveLength(1);
    expect(keptRows()).toBe(3);
  });

  test('a day later it shows the placeholder, once', async () => {
    keepAnnouncement(kept(), db);
    const t = io(() => refused('unavailable'));
    await t.run(NOW + ANNOUNCEMENT_MAX_AGE_MS);
    expect(t.shown).toEqual([]);
    for (let i = 0; i < 2; i++) await t.run(NOW + ANNOUNCEMENT_MAX_AGE_MS + 1);
    expect(t.shown).toEqual([
      { id: 'a1', ...ANNOUNCEMENT_PLACEHOLDER, from: 'admin1' },
    ]);
  });

  test('one that can never open, or opens to nothing usable, shows the placeholder at once', async () => {
    for (const reply of [
      refused('not-for-this-key'),
      refused('mismatch'),
      refused('damaged'),
      opened({}),
      opened({ title: 't'.repeat(81), message: 'm' }),
    ]) {
      keepAnnouncement(kept(), db);
      const t = io(() => reply);
      await t.run();
      expect(t.shown).toEqual([
        { id: 'a1', ...ANNOUNCEMENT_PLACEHOLDER, from: 'admin1' },
      ]);
      expect(keptRows()).toBe(0);
    }
  });

  test('two processes opening at once show it once', async () => {
    keepAnnouncement(kept(), db);
    const t = io(() => opened({ title: 'Update rt', message: 'Today please' }));
    await Promise.all([t.run(), t.run()]);
    expect(t.shown).toHaveLength(1);
  });

  test('a notification that fails is logged and does not stop the others', async () => {
    keepAnnouncement(kept(), db);
    keepAnnouncement(kept({ id: 'a2' }), db);
    const logs: string[] = [];
    const shown: string[] = [];
    await openKeptAnnouncements(
      {
        open: daemon(() => opened({ title: 'T', message: 'M' })).open,
        notify: async id => {
          if (id === 'a1') throw new Error('tray is down');
          shown.push(id);
        },
        log: line => void logs.push(line),
      },
      NOW,
      db
    );
    expect(shown).toEqual(['a2']);
    expect(logs).toHaveLength(1);
  });

  test('every tick tries the kept ones, whether or not the relay answered', async () => {
    for (const inbox of [
      async () => [],
      async () => null,
      async () => 'unauthorized' as const,
    ]) {
      let tried = 0;
      const client = {
        publish: async () => 201,
        inbox,
        ack: async () => true,
        peers: async () => null,
        enrolled: async () => null,
        setAsksEnabled: async () => 'ok' as const,
      };
      await runPeerTick(
        client,
        {
          ...boardMaterializeDeps(() => {}),
          openAnnouncements: async () => void tried++,
        },
        db
      );
      expect(tried).toBe(1);
    }
  });
});
