/** The switchboard: a dumb store-and-forward relay for peer mr-boards and
    support requests. It understands envelopes, never payloads: no GitLab or
    Slack credentials, and text people write arrives sealed to its recipients'
    keys, which are never here. Deployed standalone (Railway); boards and
    daemons only call outbound. */
import { timingSafeEqual } from 'node:crypto';
import { join } from 'path';
import { Database } from 'bun:sqlite';

import { parseDraftEnvelope } from '../src/peer/envelope.ts';
import { readCappedText } from './capped-body.ts';
import { ORG_TOKEN_PREFIX } from './orgs.ts';
import {
  ENVELOPE_TTL_MS,
  SwitchboardStore,
  UsernameTakenError,
} from './store.ts';
import { makeSupportHandler } from './support.ts';
import {
  makeTeamInviteHandler,
  RateLimiter,
  sourceIp,
  TeamInviteStore,
} from './team-invites.ts';
import { renderTelemetryPage, TELEMETRY_CSP } from './telemetry-page.ts';
import { parsePing, TelemetryStore } from './telemetry.ts';
import { InboxWaiters, MAX_WAIT_SECONDS } from './waiters.ts';

const MAX_PING_BYTES = 64 * 1024;
export const TELEMETRY_PINGS_PER_HOUR = 120;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function sameSecret(got: string, want: string): boolean {
  const digest = (v: string) =>
    new Bun.CryptoHasher('sha256').update(v).digest();
  return timingSafeEqual(digest(got), digest(want));
}

const unauthorized = () => new Response('unauthorized', { status: 401 });

export type AdminScope = { kind: 'operator' } | { kind: 'org'; org: string };

/** The master may not look like an org token, so rt can tell the two apart
    offline. A short one only warns: refusing it would crash-loop the live
    relay on deploy and cut off every board. */
export function masterTokenProblem(
  token: string
): { refuse: boolean; message: string } | null {
  if (token.startsWith(ORG_TOKEN_PREFIX))
    return {
      refuse: true,
      message: `SWITCHBOARD_ADMIN_TOKEN starts with ${ORG_TOKEN_PREFIX}, which marks an org's switchboard token. Set it to the relay operator's token instead.`,
    };
  if (token.length < 32)
    return {
      refuse: false,
      message:
        'SWITCHBOARD_ADMIN_TOKEN is shorter than 32 characters: rotate it to at least 32 random characters, e.g. openssl rand -hex 32',
    };
  return null;
}

/** The `{ username[, org] }` body of POST /boards and POST /invites. */
async function readAdminBody(
  req: Request
): Promise<{ username: string; org: string | undefined } | Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  const { username, org } = (body ?? {}) as {
    username?: unknown;
    org?: unknown;
  };
  if (typeof username !== 'string' || !username.trim())
    return new Response('expected { username }', { status: 400 });
  if (org !== undefined && org !== null && typeof org !== 'string')
    return new Response('expected org to be an org id', { status: 400 });
  return { username, org: typeof org === 'string' ? org : undefined };
}

function adminWrite<T>(write: () => T): T | Response {
  try {
    return write();
  } catch (err) {
    if (err instanceof UsernameTakenError)
      return json(409, { error: 'username-taken' });
    if (err instanceof Error && err.message === 'name-an-org')
      return json(400, { error: 'name-an-org' });
    throw err;
  }
}

export function makeFetchHandler(
  store: SwitchboardStore,
  adminToken: string,
  now: () => number,
  teamInvites: TeamInviteStore,
  telemetry: TelemetryStore,
  viewToken: string | null,
  waiters: InboxWaiters = new InboxWaiters(),
  supportWaiters: InboxWaiters = new InboxWaiters()
) {
  const legacyRetired = store.orgs
    .retireLegacyToken(adminToken, now())
    .then(revoked => {
      if (revoked)
        console.warn(
          `switchboard: the master changed since the legacy org was stamped, so the legacy org's token was revoked; mint a new one with operator.ts token ${store.orgs.legacyId()}`
        );
    })
    .catch((err: unknown) => {
      console.error(
        "switchboard: could not revoke the legacy org's token",
        err
      );
    });
  const adminScope = async (req: Request): Promise<AdminScope | null> => {
    const token = bearer(req);
    if (token === null) return null;
    if (sameSecret(token, adminToken)) return { kind: 'operator' };
    await legacyRetired;
    const org = store.orgs.authOrg(token);
    return org === null ? null : { kind: 'org', org };
  };
  /** The org an admin write lands in: undefined is the legacy org. An org
      token gets the same 403 for every id that is not its own, so it learns
      nothing about other orgs. */
  const targetOrg = (
    scope: AdminScope,
    named: string | undefined
  ): { org: string | undefined } | Response => {
    if (scope.kind === 'org')
      return named === undefined || named === scope.org
        ? { org: scope.org }
        : json(403, { error: 'org-mismatch' });
    if (named !== undefined && !store.orgs.exists(named))
      return new Response('no such org', { status: 404 });
    return { org: named };
  };
  // The awaited stamp before POST /orgs is the one the gate relies on.
  const stampMaster = () =>
    store.orgs.stampLegacyMaster(adminToken).catch((err: unknown) => {
      console.error('switchboard: could not stamp the legacy master', err);
    });
  void stampMaster();

  const teamInviteRoutes = makeTeamInviteHandler(teamInvites, now);
  const supportRoutes = makeSupportHandler(store.support, supportWaiters, now);
  const pingLimiter = new RateLimiter(TELEMETRY_PINGS_PER_HOUR, 60 * 60_000);
  // Strictly increasing so a waker's cursor (`received_at > since`) can never
  // skip a second envelope stamped in the same millisecond.
  let lastStamp = 0;
  const stamp = () => (lastStamp = Math.max(now(), lastStamp + 1));
  return async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname === '/healthz') return new Response('ok');

    const relayed = await teamInviteRoutes(req, pathname);
    if (relayed) return relayed;

    if (pathname === '/boards') {
      const scope = await adminScope(req);
      if (!scope) return unauthorized();
      if (req.method === 'GET')
        return json(200, {
          boards:
            scope.kind === 'operator'
              ? store.listBoards()
              : store
                  .listBoards(scope.org)
                  .map(({ username, createdAt }) => ({ username, createdAt })),
        });
      if (req.method !== 'POST')
        return new Response('method not allowed', { status: 405 });
      const body = await readAdminBody(req);
      if (body instanceof Response) return body;
      const target = targetOrg(scope, body.org);
      if (target instanceof Response) return target;
      const board = adminWrite(() =>
        store.registerBoard(body.username, target.org)
      );
      if (board instanceof Response) return board;
      if (scope.kind === 'operator' && body.org === undefined)
        await stampMaster();
      return json(201, board);
    }

    if (pathname.startsWith('/boards/') && req.method === 'DELETE') {
      const scope = await adminScope(req);
      if (!scope) return unauthorized();
      let username: string;
      try {
        username = decodeURIComponent(pathname.slice('/boards/'.length));
      } catch {
        return new Response('expected /boards/<username>', { status: 400 });
      }
      if (!username.trim())
        return new Response('expected /boards/<username>', { status: 400 });
      if (
        !store.deleteBoard(
          username,
          scope.kind === 'org' ? scope.org : undefined
        )
      )
        return new Response('no such board', { status: 404 });
      return json(200, { ok: true });
    }

    if (pathname === '/invites') {
      if (req.method !== 'POST')
        return new Response('method not allowed', { status: 405 });
      const scope = await adminScope(req);
      if (!scope) return unauthorized();
      const body = await readAdminBody(req);
      if (body instanceof Response) return body;
      const target = targetOrg(scope, body.org);
      if (target instanceof Response) return target;
      const invite = adminWrite(() =>
        store.createInvite(body.username, now(), target.org)
      );
      if (invite instanceof Response) return invite;
      if (scope.kind === 'operator' && body.org === undefined)
        await stampMaster();
      return json(201, invite);
    }

    if (pathname === '/orgs' || pathname.startsWith('/orgs/')) {
      if ((await adminScope(req))?.kind !== 'operator') return unauthorized();
      // A token minted while the revoke is still running would be revoked too.
      await legacyRetired;
      if (pathname === '/orgs') {
        if (req.method === 'GET') return json(200, { orgs: store.orgs.list() });
        if (req.method !== 'POST')
          return new Response('method not allowed', { status: 405 });
        await store.orgs.stampLegacyMaster(adminToken);
        if (await store.orgs.masterGateClosed(adminToken))
          return json(409, { error: 'rotate-master-first' });
        const { id } = store.orgs.create(now());
        return json(201, { id, token: store.orgs.mintToken(id, now()) });
      }
      const minting = /^\/orgs\/([^/]+)\/token$/.exec(pathname);
      if (!minting) return new Response('not found', { status: 404 });
      if (req.method !== 'POST')
        return new Response('method not allowed', { status: 405 });
      const id = minting[1]!;
      const token = store.orgs.mintToken(id, now());
      if (token === null) return new Response('no such org', { status: 404 });
      return json(200, { id, token });
    }

    if (pathname === '/invites/redeem') {
      if (req.method !== 'POST')
        return new Response('method not allowed', { status: 405 });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response('invalid json', { status: 400 });
      }
      const { code, username } = (body ?? {}) as {
        code?: unknown;
        username?: unknown;
      };
      if (
        typeof code !== 'string' ||
        typeof username !== 'string' ||
        !code.trim() ||
        !username.trim()
      ) {
        return new Response('expected { code, username }', { status: 400 });
      }
      const r = store.redeemInvite(code.trim(), username, now());
      if (r.ok) return json(200, { username: r.username, token: r.token });
      if (r.error === 'unknown')
        return new Response(
          'invite not recognized. it may have been replaced; ask for a fresh one',
          { status: 404 }
        );
      if (r.error === 'mismatch')
        return new Response('this invite is for a different board handle', {
          status: 409,
        });
      if (r.error === 'taken')
        return new Response(
          'that username already has a board in another org',
          { status: 409 }
        );
      return new Response(
        'invite expired or already used; ask for a fresh one',
        { status: 410 }
      );
    }

    // Static, oracle-free landing page for someone who clicks the invite link in a
    // browser (spec M9): no store access, no reflection of the path, no-store +
    // no-referrer because the URL itself is the credential.
    if (pathname.startsWith('/invite/') && req.method === 'GET') {
      return new Response(
        `<!doctype html><meta charset="utf-8"><style>body{font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem}</style>` +
          `<h1>board invite</h1><p>this link is a board invite. paste the whole link into <code>bun run setup</code> in your board's folder.</p>` +
          `<p>on a Mac in an rt team, ask your org admin for an invite instead and run <code>rt team join</code>.</p>`,
        {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
          },
        }
      );
    }

    if (pathname === '/telemetry/ping') {
      if (req.method !== 'POST')
        return new Response('method not allowed', { status: 405 });
      if (pingLimiter.exceeded(sourceIp(req), now()))
        return new Response('too many requests', { status: 429 });
      const text = await readCappedText(req, MAX_PING_BYTES);
      let ping = null;
      if (text !== null) {
        try {
          ping = parsePing(JSON.parse(text));
        } catch {
          ping = null;
        }
      }
      if (!ping)
        return new Response('expected a telemetry ping', { status: 400 });
      if (!telemetry.canRecord(ping.installId))
        return new Response('telemetry is full', { status: 503 });
      const pingToken = bearer(req);
      telemetry.record(
        ping,
        pingToken ? store.authBoard(pingToken) : null,
        now()
      );
      return new Response(null, { status: 204 });
    }

    if (pathname === '/telemetry/clones.json' && req.method === 'GET') {
      if (!viewToken) return new Response('not found', { status: 404 });
      const params = new URL(req.url).searchParams;
      const key = params.get('key') ?? bearer(req) ?? '';
      if (!sameSecret(key, viewToken))
        return new Response('unauthorized', { status: 401 });
      const user = params.get('user') ?? undefined;
      return new Response(JSON.stringify(telemetry.cloneReport(now(), user)), {
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
        },
      });
    }

    if (pathname === '/telemetry' && req.method === 'GET') {
      if (!viewToken) return new Response('not found', { status: 404 });
      const key = new URL(req.url).searchParams.get('key') ?? bearer(req) ?? '';
      if (!sameSecret(key, viewToken))
        return new Response('unauthorized', { status: 401 });
      return new Response(renderTelemetryPage(telemetry.snapshot(now())), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'content-security-policy': TELEMETRY_CSP,
          'x-content-type-options': 'nosniff',
        },
      });
    }

    const token = bearer(req);
    const username = token ? store.authBoard(token) : null;
    if (!username) return unauthorized();

    const support = await supportRoutes(req, pathname, username);
    if (support) return support;

    if (pathname === '/peers') {
      // Who is enrolled, for any peered board's ask pickers. Usernames only:
      // the tokens stay between the relay and each board.
      if (req.method !== 'GET')
        return new Response('method not allowed', { status: 405 });
      const org = store.boardOrg(username);
      if (org === null) return unauthorized();
      return json(200, {
        peers: store.listBoards(org).map(b => b.username),
        askable: store.listAskableUsernames(org),
      });
    }

    if (pathname === '/boards/self/asks') {
      if (req.method !== 'PUT')
        return new Response('method not allowed', { status: 405 });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response('invalid json', { status: 400 });
      }
      const enabled = (body as { enabled?: unknown })?.enabled;
      if (typeof enabled !== 'boolean')
        return new Response('expected { enabled: boolean }', { status: 400 });
      store.setAsksEnabled(username, enabled);
      return json(200, { ok: true });
    }

    if (pathname === '/envelopes') {
      if (req.method !== 'POST')
        return new Response('method not allowed', { status: 405 });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response('invalid json', { status: 400 });
      }
      const draft = parseDraftEnvelope(body);
      if (!draft)
        return new Response(
          'expected a DraftEnvelope { id, to, type, sentAt, payload }',
          { status: 400 }
        );
      const at = stamp();
      const result = store.publish(username, draft, at);
      if (!result.ok) return json(422, { error: result.error });
      waiters.wake(store.recipients(username, draft.to), at);
      return json(201, { ok: true, delivered: result.delivered });
    }

    if (pathname === '/inbox') {
      if (req.method === 'GET')
        return json(200, { envelopes: store.inbox(username) });
      return new Response('method not allowed', { status: 405 });
    }

    if (pathname === '/inbox/wait') {
      if (req.method !== 'GET')
        return new Response('method not allowed', { status: 405 });
      const params = new URL(req.url).searchParams;
      const since = Number(params.get('since') ?? '0');
      const timeout = Number(params.get('timeout') ?? String(MAX_WAIT_SECONDS));
      if (!Number.isFinite(since) || !Number.isFinite(timeout) || timeout < 0)
        return new Response('expected numeric since and timeout', {
          status: 400,
        });
      const pending = store.newestAfter(username, since);
      if (pending !== null) return json(200, { woke: true, cursor: pending });
      const woke = await waiters.wait(
        username,
        Math.min(timeout, MAX_WAIT_SECONDS) * 1000,
        req.signal
      );
      return json(
        200,
        woke === null
          ? { woke: false, cursor: since }
          : { woke: true, cursor: woke }
      );
    }

    if (pathname === '/inbox/ack') {
      if (req.method !== 'POST')
        return new Response('method not allowed', { status: 405 });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response('invalid json', { status: 400 });
      }
      const ids = (body as { ids?: unknown })?.ids;
      if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string'))
        return new Response('expected { ids: string[] }', { status: 400 });
      return json(200, {
        ok: true,
        acked: store.ack(username, ids as string[]),
      });
    }

    return new Response('not found', { status: 404 });
  };
}

if (import.meta.main) {
  const adminToken = process.env.SWITCHBOARD_ADMIN_TOKEN;
  if (!adminToken) {
    console.error('SWITCHBOARD_ADMIN_TOKEN is required');
    process.exit(1);
  }
  const problem = masterTokenProblem(adminToken);
  if (problem?.refuse) {
    console.error(problem.message);
    process.exit(1);
  }
  if (problem) console.warn(problem.message);
  const dbPath =
    process.env.SWITCHBOARD_DB || join(import.meta.dir, 'switchboard.sqlite');
  const db = new Database(dbPath);
  const store = new SwitchboardStore(db);
  const teamInvites = new TeamInviteStore(db);
  const telemetry = new TelemetryStore(db);
  const viewToken = process.env.SWITCHBOARD_TELEMETRY_TOKEN || null;
  const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 7940;
  setInterval(() => {
    store.prune(Date.now(), ENVELOPE_TTL_MS);
    store.support.prune(Date.now());
    teamInvites.prune(Date.now());
    telemetry.prune(Date.now());
  }, 60 * 60_000);
  // Bun closes a request idle for idleTimeout seconds (default 10), which
  // would cut every /inbox/wait held up to MAX_WAIT_SECONDS.
  const server = Bun.serve({
    port,
    idleTimeout: MAX_WAIT_SECONDS + 15,
    fetch: makeFetchHandler(
      store,
      adminToken,
      Date.now,
      teamInvites,
      telemetry,
      viewToken
    ),
  });
  console.log(`switchboard listening on :${server.port} (db: ${dbPath})`);
}
