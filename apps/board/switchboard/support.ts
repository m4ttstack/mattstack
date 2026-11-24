/** Support requests and their statuses: a queue of its own, beside the board
    inbox. Two board builds can both read and ack the inbox, and an old one
    drops a type it does not know, so a request there could vanish unseen.
    The wire is declared in `packages/rt-client/src/support.ts` and redeclared
    here because the relay image copies only `apps/board/switchboard/*.ts`. */
import type { Database } from 'bun:sqlite';

import { canonicalUsername } from '../src/peer/envelope.ts';
import { readCappedText } from './capped-body.ts';
import { InboxWaiters, MAX_WAIT_SECONDS } from './waiters.ts';

export type SupportKind = 'request' | 'status';

export interface SupportDraft {
  id: string;
  to: string;
  kind: SupportKind;
  sentAt: number;
  body: string;
  mac: string;
}

export interface SupportMessage extends SupportDraft {
  from: string;
  receivedAt: number;
}

export interface SupportHostState {
  accepting: boolean;
  lastSeenAt: number | null;
}

export const SUPPORT_BODY_MAX_BYTES = 64 * 1024;
/** The body is JSON inside the request's JSON, so every quote in it can double. */
export const SUPPORT_REQUEST_MAX_BYTES = 2 * SUPPORT_BODY_MAX_BYTES + 4 * 1024;
export const SUPPORT_TTL_MS = 7 * 24 * 60 * 60_000;
export const SUPPORT_MACHINE_HOLD_MS = 10 * 60_000;
export const MAX_PENDING_PER_SENDER = 20;

/** SQLite turns a lone surrogate into other characters, so an id holding one
    could be stored and never acked. */
const ID = /^[A-Za-z0-9._:-]{1,200}$/;
/** A status is `<request id>:<state>`, so a request id leaves room for it. */
const REQUEST_ID_MAX = 128;
const MAC = /^[A-Za-z0-9._:-]{1,256}$/;
const MACHINE_MAX = 200;

function parseKind(v: unknown): SupportKind | null {
  return v === 'request' || v === 'status' ? v : null;
}

function parseMachine(v: unknown): string | null {
  return typeof v === 'string' && v.trim() && v.length <= MACHINE_MAX
    ? v
    : null;
}

function bodyTooLarge(body: unknown): boolean {
  return (
    typeof body === 'string' &&
    new TextEncoder().encode(body).length > SUPPORT_BODY_MAX_BYTES
  );
}

export function parseSupportDraft(v: unknown): SupportDraft | null {
  if (!v || typeof v !== 'object') return null;
  const {
    id,
    to,
    kind: rawKind,
    sentAt,
    body,
    mac,
  } = v as Record<string, unknown>;
  const kind = parseKind(rawKind);
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof to !== 'string' || !to.trim() || to.trim() === '*') return null;
  if (!kind) return null;
  if (kind === 'request' && id.length > REQUEST_ID_MAX) return null;
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return null;
  if (typeof body !== 'string' || bodyTooLarge(body)) return null;
  if (typeof mac !== 'string' || !MAC.test(mac)) return null;
  return { id, to: canonicalUsername(to), kind, sentAt, body, mac };
}

export type SupportPublish =
  { ok: true } | { ok: false; error: 'unknown-recipient' | 'full' | 'changed' };

const PUBLISH_STATUS = {
  'unknown-recipient': 422,
  full: 429,
  changed: 409,
} as const;

export class SupportStore {
  constructor(private db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS support_messages (
      recipient TEXT NOT NULL,
      from_user TEXT NOT NULL,
      id TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL,
      body TEXT NOT NULL,
      mac TEXT NOT NULL,
      PRIMARY KEY (recipient, from_user, id)
    )`);
    db.run(
      `CREATE INDEX IF NOT EXISTS support_messages_received ON support_messages(received_at)`
    );
    db.run(`CREATE TABLE IF NOT EXISTS support_hosts (
      username TEXT PRIMARY KEY,
      machine TEXT NOT NULL,
      accepting INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`);
  }

  publish(from: string, draft: SupportDraft, now: number): SupportPublish {
    return this.db.transaction((): SupportPublish => {
      this.prune(now);
      const known = this.db
        .query<unknown, [string]>(`SELECT 1 FROM boards WHERE username = ?`)
        .get(draft.to);
      if (!known) return { ok: false, error: 'unknown-recipient' };
      const held = this.db
        .query<{ kind: string; body: string }, [string, string, string]>(
          `SELECT kind, body FROM support_messages WHERE recipient = ? AND from_user = ? AND id = ?`
        )
        .get(draft.to, from, draft.id);
      // A retry may be signed again, so only what it says has to match.
      if (held)
        return held.kind === draft.kind && held.body === draft.body
          ? { ok: true }
          : { ok: false, error: 'changed' };
      const pending = this.db
        .query<{ n: number }, [string, string]>(
          `SELECT COUNT(*) AS n FROM support_messages WHERE recipient = ? AND from_user = ?`
        )
        .get(draft.to, from)!.n;
      if (pending >= MAX_PENDING_PER_SENDER)
        return { ok: false, error: 'full' };
      this.db.run(
        `INSERT INTO support_messages (recipient, from_user, id, kind, sent_at, received_at, body, mac)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          draft.to,
          from,
          draft.id,
          draft.kind,
          draft.sentAt,
          now,
          draft.body,
          draft.mac,
        ]
      );
      return { ok: true };
    })();
  }

  list(
    username: string,
    kind: SupportKind,
    now: number,
    limit: number = 100
  ): SupportMessage[] {
    this.prune(now);
    return this.db
      .query<
        {
          id: string;
          recipient: string;
          from_user: string;
          sent_at: number;
          received_at: number;
          body: string;
          mac: string;
        },
        [string, string, number]
      >(
        `SELECT id, recipient, from_user, sent_at, received_at, body, mac FROM support_messages
         WHERE recipient = ? AND kind = ? ORDER BY received_at ASC, id ASC LIMIT ?`
      )
      .all(username, kind, limit)
      .map(r => ({
        id: r.id,
        to: r.recipient,
        kind,
        sentAt: r.sent_at,
        body: r.body,
        mac: r.mac,
        from: r.from_user,
        receivedAt: r.received_at,
      }));
  }

  newestAfter(
    username: string,
    kind: SupportKind,
    since: number,
    now: number
  ): number | null {
    this.prune(now);
    const row = this.db
      .query<{ newest: number | null }, [string, string, number]>(
        `SELECT MAX(received_at) AS newest FROM support_messages WHERE recipient = ? AND kind = ? AND received_at > ?`
      )
      .get(username, kind, since);
    return row?.newest ?? null;
  }

  ack(username: string, keys: { from: string; id: string }[]): number {
    const del = this.db.prepare(
      `DELETE FROM support_messages WHERE recipient = ? AND from_user = ? AND id = ?`
    );
    let n = 0;
    for (const k of keys)
      n += del.run(username, canonicalUsername(k.from), k.id).changes;
    return n;
  }

  setHost(
    username: string,
    machine: string,
    accepting: boolean,
    now: number
  ): 'ok' | 'other-machine' {
    return this.db.transaction((): 'ok' | 'other-machine' => {
      const row = this.hostRow(username);
      if (row?.accepting && row.machine !== machine) {
        const held = now - row.last_seen_at < SUPPORT_MACHINE_HOLD_MS;
        if (!accepting || held) return 'other-machine';
      }
      this.db.run(
        `INSERT INTO support_hosts (username, machine, accepting, last_seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET machine = excluded.machine,
           accepting = excluded.accepting, last_seen_at = excluded.last_seen_at`,
        [username, machine, accepting ? 1 : 0, now]
      );
      return 'ok';
    })();
  }

  host(username: string): SupportHostState {
    const row = this.hostRow(canonicalUsername(username));
    return row
      ? { accepting: row.accepting === 1, lastSeenAt: row.last_seen_at }
      : { accepting: false, lastSeenAt: null };
  }

  /** Records that the accepting machine polled. False when a different machine
      is the accepting one, and this one must not read its requests. */
  seen(username: string, machine: string, now: number): boolean {
    const row = this.hostRow(username);
    if (!row?.accepting) return true;
    if (row.machine !== machine) return false;
    this.db.run(
      `UPDATE support_hosts SET last_seen_at = ? WHERE username = ?`,
      [now, username]
    );
    return true;
  }

  clear(username: string): void {
    this.db.run(
      `DELETE FROM support_messages WHERE recipient = ? OR from_user = ?`,
      [username, username]
    );
    this.db.run(`DELETE FROM support_hosts WHERE username = ?`, [username]);
  }

  prune(now: number): number {
    return this.db.run(`DELETE FROM support_messages WHERE received_at < ?`, [
      now - SUPPORT_TTL_MS,
    ]).changes;
  }

  private hostRow(username: string) {
    return this.db
      .query<
        { machine: string; accepting: number; last_seen_at: number },
        [string]
      >(
        `SELECT machine, accepting, last_seen_at FROM support_hosts WHERE username = ?`
      )
      .get(username);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const notAllowed = () => new Response('method not allowed', { status: 405 });

async function readBody(req: Request): Promise<unknown | Response> {
  const text = await readCappedText(req, SUPPORT_REQUEST_MAX_BYTES);
  if (text === null) return new Response('too large', { status: 413 });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return new Response('invalid json', { status: 400 });
  }
}

function parseKeys(v: unknown): { from: string; id: string }[] | null {
  const keys = (v as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys)) return null;
  const parsed: { from: string; id: string }[] = [];
  for (const k of keys as unknown[]) {
    const { from, id } = (k ?? {}) as Record<string, unknown>;
    if (typeof from !== 'string' || typeof id !== 'string') return null;
    parsed.push({ from, id });
  }
  return parsed;
}

/** Null for a path that is not a support route. */
export function makeSupportHandler(
  store: SupportStore,
  waiters: InboxWaiters,
  now: () => number
): (
  req: Request,
  pathname: string,
  username: string
) => Promise<Response | null> {
  // Strictly increasing, so a wait's cursor never skips a message stamped in
  // the same millisecond as the one before it.
  let lastStamp = 0;
  const stamp = () => (lastStamp = Math.max(now(), lastStamp + 1));

  /** The kind a poll asks for, or the response that refuses the poll. */
  const pollKind = (
    params: URLSearchParams,
    username: string
  ): SupportKind | Response => {
    const kind = parseKind(params.get('kind'));
    if (!kind)
      return new Response('expected kind=request or kind=status', {
        status: 400,
      });
    if (kind === 'request') {
      const machine = parseMachine(params.get('machine'));
      if (!machine) return new Response('expected a machine', { status: 400 });
      if (!store.seen(username, machine, now()))
        return json(409, { error: 'other-machine' });
    }
    return kind;
  };

  return async (req, pathname, username) => {
    if (pathname === '/support/messages') {
      if (req.method === 'GET') {
        const kind = pollKind(new URL(req.url).searchParams, username);
        if (kind instanceof Response) return kind;
        return json(200, { messages: store.list(username, kind, now()) });
      }
      if (req.method !== 'POST') return notAllowed();
      const body = await readBody(req);
      if (body instanceof Response) return body;
      if (bodyTooLarge((body as { body?: unknown } | null)?.body))
        return new Response('too large', { status: 413 });
      const draft = parseSupportDraft(body);
      if (!draft)
        return new Response(
          'expected a SupportDraft { id, to, kind, sentAt, body, mac }',
          { status: 400 }
        );
      const at = stamp();
      const result = store.publish(username, draft, at);
      if (!result.ok)
        return json(PUBLISH_STATUS[result.error], { error: result.error });
      waiters.wake([`${draft.kind}:${draft.to}`], at);
      return json(201, { ok: true });
    }

    if (pathname === '/support/wait') {
      if (req.method !== 'GET') return notAllowed();
      const params = new URL(req.url).searchParams;
      const since = Number(params.get('since') ?? '0');
      const timeout = Number(params.get('timeout') ?? String(MAX_WAIT_SECONDS));
      if (!Number.isFinite(since) || !Number.isFinite(timeout) || timeout < 0)
        return new Response('expected numeric since and timeout', {
          status: 400,
        });
      const kind = pollKind(params, username);
      if (kind instanceof Response) return kind;
      const pending = store.newestAfter(username, kind, since, now());
      if (pending !== null) return json(200, { woke: true, cursor: pending });
      const woke = await waiters.wait(
        `${kind}:${username}`,
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

    if (pathname === '/support/ack') {
      if (req.method !== 'POST') return notAllowed();
      const body = await readBody(req);
      if (body instanceof Response) return body;
      const keys = parseKeys(body);
      if (!keys)
        return new Response('expected { keys: [{ from, id }] }', {
          status: 400,
        });
      return json(200, { ok: true, acked: store.ack(username, keys) });
    }

    if (pathname === '/support/host') {
      if (req.method !== 'PUT') return notAllowed();
      const body = await readBody(req);
      if (body instanceof Response) return body;
      const raw = (body ?? {}) as { accepting?: unknown; machine?: unknown };
      const machine = parseMachine(raw.machine);
      if (typeof raw.accepting !== 'boolean' || !machine)
        return new Response('expected { accepting: boolean, machine }', {
          status: 400,
        });
      const result = store.setHost(username, machine, raw.accepting, now());
      return result === 'ok'
        ? json(200, { ok: true })
        : json(409, { error: result });
    }

    if (pathname.startsWith('/support/host/')) {
      if (req.method !== 'GET') return notAllowed();
      let host: string;
      try {
        host = decodeURIComponent(pathname.slice('/support/host/'.length));
      } catch {
        return new Response('expected /support/host/<username>', {
          status: 400,
        });
      }
      return json(200, store.host(host));
    }

    return null;
  };
}
