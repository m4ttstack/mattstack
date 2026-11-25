/** The switchboard carries envelopes: who, when, which MR, what state. Text a
    person or an agent wrote leaves sealed. A new payload field fails here
    until it is either sealed or a routing fact added to the list below and to
    the privacy section of docs/peer-boards.md. */
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import type { SealResult } from '@mattstack/rt-client';
import { SwitchboardStore } from '../../switchboard/store.ts';
import { closedPaneReports } from '../peer/closed-pane.ts';
import {
  wireReviewStatus,
  type AskKind,
  type DraftEnvelope,
} from '../peer/envelope.ts';
import { parkedPayload, stoppedPayload } from '../peer/park-report.ts';
import { presenceEnvelopes, respondStateEnvelope } from '../peer/presence.ts';
import {
  outcomePublisher,
  sealedAsk,
  sealedReviewSyncEnvelopes,
  type SealDeps,
} from '../peer/sealed-send.ts';
import { WIRE_REASONS } from '../peer/sealed.ts';

const SECRET = 'SECRET-TEXT';
const MR = 'https://git.example.com/acme/app/-/merge_requests/7';

const ASK = ['mrUrl', 'iid', 'sealed'];
const STATE = [
  'mrUrl',
  'iid',
  'status',
  'outcome',
  'updatedAt',
  'nudgeId',
  'parkedAt',
  'reason',
  'sealed',
];
const READABLE: Record<string, string[]> = {
  'review-request': ASK,
  're-review-request': ASK,
  'respond-request': ASK,
  'nudge-outcome': [
    'mrUrl',
    'iid',
    'nudgeId',
    'result',
    'declined',
    'reason',
    'sealed',
  ],
  'review-state': STATE,
  'respond-state': [
    'mrUrl',
    'iid',
    'status',
    'outcome',
    'updatedAt',
    'nudgeId',
  ],
};

/** One of every envelope this board sends, through the builder that makes it,
    with the marker in every text input. */
async function everyEnvelope(deps: SealDeps): Promise<DraftEnvelope[]> {
  const out: DraftEnvelope[] = [];
  for (const kind of ['review', 're-review', 'respond'] as AskKind[])
    out.push(
      (
        await sealedAsk(
          deps,
          'bob',
          kind,
          { mrUrl: MR, iid: 7 },
          { title: SECRET, sourceBranch: SECRET, note: SECRET }
        )
      ).draft
    );
  const publish = outcomePublisher(deps, d => void out.push(d));
  for (const extra of [
    { reason: SECRET },
    { declined: true as const, declineNote: SECRET },
    { declined: true as const, reason: 'busy right now', declineNote: SECRET },
    { reason: 'cooldown' },
  ])
    await publish('bob', {
      mrUrl: MR,
      iid: 7,
      nudgeId: 'n1',
      result: 'rejected',
      ...extra,
    });
  const lane = { iid: 7, runStartedAt: 0 };
  for (const payload of [
    {
      mrUrl: MR,
      iid: 7,
      ...wireReviewStatus('held', SECRET),
      updatedAt: 5,
    },
    {
      mrUrl: MR,
      iid: 7,
      status: 'done',
      outcome: 'comment',
      updatedAt: 5,
    },
    parkedPayload(lane, MR, 5),
    stoppedPayload(
      { status: 'parked', kind: 'review-post', openedAt: 5 },
      MR,
      lane,
      SECRET,
      5
    )!,
  ])
    out.push(
      ...(await sealedReviewSyncEnvelopes(deps, {
        author: 'bob',
        self: 'ada',
        recipients: author => [author, 'cy'],
        askId: 'n1',
        payload,
      }))
    );
  for (const report of closedPaneReports({
    reviews: new Map([
      [MR, { iid: 7, status: 'reviewing', agentId: 'a1', sessionId: 's1' }],
    ]),
    executors: [{ agentId: 'a1', sessionId: 's1', state: 'gone', since: 1 }],
    authorOf: () => 'bob',
    self: 'ada',
    reported: new Map(),
    nudges: [],
    isParked: () => false,
    now: 5,
  }))
    out.push(...presenceEnvelopes(['bob'], report.to, report.payload));
  out.push(
    respondStateEnvelope('bob', {
      mrUrl: MR,
      iid: 7,
      status: 'done',
      outcome: undefined,
      updatedAt: 5,
      nudgeId: 'n1',
      ...({ reason: SECRET, message: SECRET } as object),
    })
  );
  return out;
}

const stub = (reply: SealResult): SealDeps => ({
  self: () => 'ada',
  seal: async () => ({ ok: true, data: reply }),
});

describe('no plain text on the wire', () => {
  test('every envelope carries routing facts and sealed text only', async () => {
    for (const reply of [
      { ok: true, sealed: 'YWdl', unreachable: [] },
      { ok: false, reason: 'no-recipients' },
      { ok: false, reason: 'unavailable' },
    ] as SealResult[]) {
      const envelopes = await everyEnvelope(stub(reply));
      expect(new Set(envelopes.map(e => e.type))).toEqual(
        new Set(Object.keys(READABLE))
      );
      for (const e of envelopes) {
        expect(JSON.stringify(e)).not.toContain(SECRET);
        const payload = e.payload as Record<string, unknown>;
        for (const key of Object.keys(payload))
          expect({
            type: e.type,
            key,
            ok: READABLE[e.type]!.includes(key),
          }).toEqual({
            type: e.type,
            key,
            ok: true,
          });
        if (payload.reason !== undefined)
          expect(WIRE_REASONS.has(payload.reason as string)).toBe(true);
      }
    }
  });

  test('envelopes are built only where their text is sealed', () => {
    const root = join(import.meta.dir, '..', '..');
    const builders =
      /\b(makeEnvelope|buildAskDraft|presenceEnvelopes|reviewSyncEnvelopes)\(/;
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(d => {
        const path = join(dir, d.name);
        if (d.isDirectory())
          return d.name === '__tests__' || d.name === 'client'
            ? []
            : files(path);
        return d.name.endsWith('.ts') ? [path] : [];
      });
    const callers = [...files(join(root, 'src')), ...files(join(root, 'bin'))]
      .filter(f => builders.test(readFileSync(f, 'utf8')))
      .map(f => f.slice(root.length + 1));
    expect(callers.sort()).toEqual([
      'src/peer/closed-pane.ts',
      'src/peer/envelope.ts',
      'src/peer/presence.ts',
      'src/peer/sealed-send.ts',
    ]);
  });

  const AGE = Bun.which('age');
  const KEYGEN = Bun.which('age-keygen');

  test.skipIf(!AGE || !KEYGEN)(
    'a relay holding one of every envelope, sealed with age, holds none of the text',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'wire-age-'));
      try {
        const keyFile = join(dir, 'key');
        writeFileSync(keyFile, Bun.spawnSync([KEYGEN!]).stdout);
        chmodSync(keyFile, 0o600);
        const pub = Bun.spawnSync([KEYGEN!, '-y', keyFile])
          .stdout.toString()
          .trim();
        const deps: SealDeps = {
          self: () => 'ada',
          seal: async a => ({
            ok: true,
            data: {
              ok: true,
              unreachable: [],
              sealed: Bun.spawnSync([AGE!, '-r', pub], {
                stdin: new Blob([JSON.stringify(a)]),
              }).stdout.toString('base64'),
            },
          }),
        };
        const relayDb = new Database(':memory:');
        const relay = new SwitchboardStore(relayDb);
        for (const name of ['ada', 'bob', 'cy']) relay.registerBoard(name);
        const envelopes = await everyEnvelope(deps);
        for (const e of envelopes)
          expect(relay.publish('ada', e, 1).ok).toBe(true);
        const rows = relayDb.query('SELECT * FROM envelopes').all();
        expect(rows).toHaveLength(envelopes.length);
        expect(JSON.stringify(rows)).not.toContain(SECRET);
        for (const row of rows as { payload: string }[]) {
          const { sealed } = JSON.parse(row.payload) as { sealed?: string };
          if (sealed)
            expect(
              Buffer.from(sealed, 'base64').toString('latin1')
            ).not.toContain(SECRET);
        }
        const ask = JSON.parse((rows[0] as { payload: string }).payload);
        const file = join(dir, 'ask');
        writeFileSync(file, Buffer.from(ask.sealed, 'base64'));
        expect(
          Bun.spawnSync([AGE!, '-d', '-i', keyFile, file]).stdout.toString()
        ).toContain(SECRET);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
