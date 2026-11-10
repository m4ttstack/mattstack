/** POST /peer-review/remind: the parked band's Slack reminder. The handler
    runs against a real state db with a fake DM sender; the booted server
    proves the route reads the same store. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import {
  markPeerReviewReminded,
  peerReviewKey,
  readPeerReviews,
  writePeerReview,
  type PeerReviewState,
} from '../peer/peer-reviews.ts';
import {
  createReminder,
  isDaemonTimeout,
  REMIND_EVERY_MS,
  remindText,
  type DmResult,
} from '../peer/remind.ts';
import { foldSlackMatch, NO_SLACK_MATCH } from '../peer/slack-match.ts';
import { openStateDb } from '../state/db.ts';
import { getKvValue } from '../state/kv-blob.ts';
import { bootBoardServer } from './board-server.ts';

const MR = 'https://gitlab.example.com/g/p/-/merge_requests/41';
const MIN = 60_000;

function harness(
  opts: {
    slack?: Record<string, string>;
    dm?: DmResult;
    /** Holds `mr()` open until `release` is called. */
    slowMr?: boolean;
  } = {}
) {
  const db = openStateDb(
    join(mkdtempSync(join(tmpdir(), 'board-remind-')), 'state.db')
  );
  let clock = Date.now();
  const sent: Array<{ userId: string; text: string }> = [];
  const slackIds = foldSlackMatch(
    NO_SLACK_MATCH,
    opts.slack ?? { 'mira-fixture': 'U0MIRA' },
    []
  ).ids;
  const waiting: Array<() => void> = [];
  const remind = createReminder({
    peerReview: (mrUrl, reviewer) =>
      getKvValue<PeerReviewState | undefined>(
        'peer-review',
        peerReviewKey(mrUrl, reviewer),
        undefined,
        db
      ),
    mr: async url => {
      if (opts.slowMr) await new Promise<void>(r => waiting.push(r));
      return url === MR
        ? {
            author: 'Rowan',
            iid: 41,
            title: 'Tidy the widget cache',
            webUrl: MR,
          }
        : undefined;
    },
    slackIdFor: reviewer => slackIds.get(reviewer),
    sendDm: async (userId, text) => {
      sent.push({ userId, text });
      return opts.dm ?? { ok: true };
    },
    markReminded: (mrUrl, reviewer, at) =>
      markPeerReviewReminded(mrUrl, reviewer, at, db),
    now: () => clock,
  });
  const park = (
    reviewer = 'mira-fixture',
    status = 'parked',
    over: Partial<PeerReviewState> = {}
  ) =>
    writePeerReview(
      {
        mrUrl: MR,
        iid: 41,
        reviewer,
        status,
        parkedAt: clock - 30 * MIN,
        updatedAt: clock - 30 * MIN,
        receivedAt: clock - 30 * MIN,
        ...over,
      },
      db
    );
  return {
    db,
    sent,
    remind,
    park,
    release: () => waiting.splice(0).forEach(r => r()),
    advance: (ms: number) => {
      clock += ms;
    },
    stored: () => readPeerReviews(db).get(MR)?.[0],
  };
}

test('sends one DM with the author, MR number, title and web URL, then records the time', async () => {
  const h = harness();
  h.park();
  const res = await h.remind(MR, 'mira-fixture');
  expect(res.status).toBe(200);
  expect(h.sent).toEqual([
    {
      userId: 'U0MIRA',
      text: `Rowan is waiting on your review of !41 (Tidy the widget cache). It's parked at your approval gate: ${MR}`,
    },
  ]);
  const remindedAt = (res as { body: { remindedAt: number } }).body.remindedAt;
  expect(h.stored()?.remindedAt).toBe(remindedAt);
});

test('a second remind 5 minutes later is refused with the retry time and sends nothing', async () => {
  const h = harness();
  h.park();
  const first = await h.remind(MR, 'mira-fixture');
  const remindedAt = (first as { body: { remindedAt: number } }).body
    .remindedAt;
  h.advance(5 * MIN);
  const again = await h.remind(MR, 'mira-fixture');
  expect(again).toEqual({
    status: 409,
    body: { retryAt: remindedAt + REMIND_EVERY_MS },
  });
  expect(h.sent).toHaveLength(1);
});

test('reminds again once 15 minutes have passed', async () => {
  const h = harness();
  h.park();
  await h.remind(MR, 'mira-fixture');
  h.advance(REMIND_EVERY_MS);
  expect((await h.remind(MR, 'mira-fixture')).status).toBe(200);
  expect(h.sent).toHaveLength(2);
});

test('a click while the first is still looking up the MR is refused, with no retry time', async () => {
  const h = harness({ slowMr: true });
  h.park();
  const first = h.remind(MR, 'mira-fixture');
  const second = await h.remind(MR, 'mira-fixture');
  expect(second).toEqual({ status: 409 });
  h.release();
  expect((await first).status).toBe(200);
  expect(h.sent).toHaveLength(1);
});

test('matches a roster username with capitals to the canonical reviewer', async () => {
  const h = harness({ slack: { 'Mira-Fixture': 'U0MIRA' } });
  h.park();
  expect((await h.remind(MR, 'mira-fixture')).status).toBe(200);
  expect(h.sent[0]?.userId).toBe('U0MIRA');
});

test('a dismissed parked review is refused', async () => {
  const h = harness();
  h.park('mira-fixture', 'parked', { dismissedAt: Date.now() });
  expect((await h.remind(MR, 'mira-fixture')).status).toBe(422);
  expect(h.sent).toHaveLength(0);
});

test('a park older than 48 hours is refused', async () => {
  const h = harness();
  const old = Date.now() - 49 * 60 * MIN;
  h.park('mira-fixture', 'parked', {
    parkedAt: old,
    updatedAt: old,
    receivedAt: old,
  });
  expect((await h.remind(MR, 'mira-fixture')).status).toBe(422);
  expect(h.sent).toHaveLength(0);
});

test('an MR that is not on the board is refused with a 404', async () => {
  const h = harness();
  const other = 'https://gitlab.example.com/g/p/-/merge_requests/99';
  writePeerReview(
    {
      mrUrl: other,
      iid: 99,
      reviewer: 'mira-fixture',
      status: 'parked',
      updatedAt: Date.now(),
      receivedAt: Date.now(),
    },
    h.db
  );
  expect((await h.remind(other, 'mira-fixture')).status).toBe(404);
  expect(h.sent).toHaveLength(0);
});

test('a daemon timeout records the reminder, since Slack may have it, and still reports a 502', async () => {
  const h = harness({
    dm: { ok: false, message: 'timed out', maybeSent: true },
  });
  h.park();
  const res = await h.remind(MR, 'mira-fixture');
  const remindedAt = h.stored()?.remindedAt;
  expect(remindedAt).toBeNumber();
  expect(res).toEqual({
    status: 502,
    body: { maybeSent: true, remindedAt: remindedAt! },
  });
  h.advance(MIN);
  expect((await h.remind(MR, 'mira-fixture')).status).toBe(409);
  expect(h.sent).toHaveLength(1);
});

test("only rt-client's abort reads as a timeout", () => {
  expect(
    isDaemonTimeout(
      'rt daemon unreachable at /tmp/rt.sock: The operation timed out.'
    )
  ).toBe(true);
  expect(
    isDaemonTimeout(
      'rt daemon unreachable at /tmp/rt.sock: Was there a typo in the url or port?'
    )
  ).toBe(false);
  expect(isDaemonTimeout('chat:slack-dm failed: HTTP 500')).toBe(false);
  expect(isDaemonTimeout(undefined)).toBe(false);
});

test('a reviewer with no Slack match is refused and nothing is sent', async () => {
  const h = harness({ slack: {} });
  h.park();
  const res = await h.remind(MR, 'mira-fixture');
  expect(res.status).toBe(422);
  expect(h.sent).toHaveLength(0);
  expect(h.stored()?.remindedAt).toBeUndefined();
});

test('a review that is not parked is refused', async () => {
  const h = harness();
  h.park('mira-fixture', 'reviewing');
  expect((await h.remind(MR, 'mira-fixture')).status).toBe(422);
  expect((await h.remind(MR, 'nobody')).status).toBe(422);
  expect(h.sent).toHaveLength(0);
});

test("a failed send returns the daemon's message and records nothing", async () => {
  const h = harness({ dm: { ok: false, message: 'slack: not_authed' } });
  h.park();
  expect(await h.remind(MR, 'mira-fixture')).toEqual({
    status: 502,
    message: 'slack: not_authed',
  });
  expect(h.stored()?.remindedAt).toBeUndefined();
});

test("the reviewer's next state replaces the reminder", () => {
  const h = harness();
  h.park();
  const at = Date.now();
  markPeerReviewReminded(MR, 'mira-fixture', at, h.db);
  expect(h.stored()?.remindedAt).toBe(at);
  writePeerReview(
    {
      mrUrl: MR,
      iid: 41,
      reviewer: 'mira-fixture',
      status: 'reviewing',
      updatedAt: at + 1,
    },
    h.db
  );
  expect(h.stored()?.remindedAt).toBeUndefined();
});

const fakeHome = mkdtempSync(join(tmpdir(), 'board-remind-server-'));
const teamDir = join(
  fakeHome,
  '.mattstack',
  'orgs',
  'testteam',
  'mattstack',
  'org'
);
mkdirSync(teamDir, { recursive: true });
writeFileSync(
  join(teamDir, 'settings.org.jsonc'),
  JSON.stringify({
    'board.gitlabHost': 'https://gitlab.example.com',
    'board.projects': ['g/p'],
    'mattstack.roster': [{ username: 'alice' }],
  })
);
const dbPath = join(fakeHome, 'state.db');
const serverDb = openStateDb(dbPath);
writePeerReview(
  {
    mrUrl: MR,
    iid: 41,
    reviewer: 'grace',
    status: 'reviewing',
    updatedAt: Date.now(),
  },
  serverDb
);
const board = bootBoardServer({
  env: {
    HOME: fakeHome,
    BOARD_APP_ROOT: fakeHome,
    BOARD_STATE_DB: dbPath,
    GITLAB_TOKEN: '',
    SLACK_TOKEN: '',
    SWITCHBOARD_TOKEN: '',
    SWITCHBOARD_ADMIN_TOKEN: '',
  },
});

function post(body: unknown): Promise<Response> {
  return fetch(`${board.origin}/peer-review/remind`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('the route refuses a review that is not parked', async () => {
  const res = await post({ mrUrl: MR, reviewer: 'grace' });
  expect(res.status).toBe(422);
});

test('the route refuses a body without a reviewer', async () => {
  expect((await post({ mrUrl: MR })).status).toBe(400);
});

test('the route refuses a non-POST', async () => {
  const res = await fetch(`${board.origin}/peer-review/remind`);
  expect(res.status).toBe(405);
});

const MIRA = { id: 'U0MIRA', displayName: 'Mira P', realName: 'Mira Park' };

test("the Slack match keys ids canonically and names the matched person's Slack name", () => {
  const match = foldSlackMatch(NO_SLACK_MATCH, { 'Mira-Fixture': 'U0MIRA' }, [
    MIRA,
  ]);
  expect(match.ids.get('mira-fixture')).toBe('U0MIRA');
  expect(match.names.get('Mira-Fixture')).toBe('Mira P');
  const noDisplay = foldSlackMatch(NO_SLACK_MATCH, { mira: 'U0MIRA' }, [
    { ...MIRA, displayName: ' ' },
  ]);
  expect(noDisplay.names.get('mira')).toBe('Mira Park');
});

test('a Slack refresh builds the next match whole, so the last one answers until it lands', () => {
  const last = foldSlackMatch(NO_SLACK_MATCH, { mira: 'U0MIRA' }, [MIRA]);
  const next = foldSlackMatch(NO_SLACK_MATCH, {}, [MIRA]);
  expect(last.ids.get('mira')).toBe('U0MIRA');
  expect(next.ids.size).toBe(0);
  const kept = foldSlackMatch(last, {}, [MIRA]);
  expect(kept.ids.get('mira')).toBe('U0MIRA');
  expect(kept).not.toBe(last);
});

test('the DM names the MR the way its forge does', () => {
  const mr = { author: 'Rowan', iid: 123, title: 'Fix the cache' };
  expect(
    remindText({
      ...mr,
      webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/123',
    })
  ).toContain('your review of !123 (Fix the cache)');
  expect(
    remindText({ ...mr, webUrl: 'https://github.com/o/r/pull/123' })
  ).toContain('your review of #123 (Fix the cache)');
  expect(
    remindText({
      ...mr,
      webUrl: 'https://git.example.com/o/r/pull/123',
      provider: 'github',
    })
  ).toContain('your review of #123 (Fix the cache)');
});
