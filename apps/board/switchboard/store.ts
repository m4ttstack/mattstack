import type { Database } from 'bun:sqlite';

import {
  canonicalUsername,
  type DraftEnvelope,
  type Envelope,
} from '../src/peer/envelope.ts';
import { OrgStore } from './orgs.ts';
import { SupportStore } from './support.ts';

export const ENVELOPE_TTL_MS = 7 * 24 * 60 * 60_000;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

export class UsernameTakenError extends Error {
  constructor() {
    super('username-taken');
    this.name = 'UsernameTakenError';
  }
}

export function hashToken(token: string): string {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex');
}

function mintToken(): string {
  return (
    crypto.randomUUID().replaceAll('-', '') +
    crypto.randomUUID().replaceAll('-', '')
  );
}

function mintCode(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function addOrgColumn(db: Database, table: 'boards' | 'invites'): void {
  const columns = db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all();
  if (!columns.some(c => c.name === 'org_id'))
    db.run(`ALTER TABLE ${table} ADD COLUMN org_id TEXT`);
}

/** Moves every board and invite with no org into the legacy org. Rows with
    no org beside a non-legacy org mean the relay was rolled back past orgs
    and forward again, so nobody can tell whose they are: they stay NULL,
    and a NULL row never authenticates or redeems. */
export function sweepNullOrgs(
  db: Database,
  now: number
): { moved: number; skipped: number } {
  const orgs = new OrgStore(db);
  return db.transaction(() => {
    const orphans = (table: 'boards' | 'invites') =>
      db
        .query<{ username: string }, []>(
          `SELECT username FROM ${table} WHERE org_id IS NULL ORDER BY username`
        )
        .all()
        .map(r => r.username);
    const boards = orphans('boards');
    const invites = orphans('invites');
    const count = boards.length + invites.length;
    if (count === 0) return { moved: 0, skipped: 0 };
    if (orgs.hasNonLegacy()) {
      console.warn(
        `switchboard: left ${count} rows with no org alone, since a non-legacy org exists; they fail closed. boards: ${boards.join(', ') || 'none'}; invites: ${invites.join(', ') || 'none'}`
      );
      return { moved: 0, skipped: count };
    }
    const legacy = orgs.ensureLegacy(now)!;
    const moved =
      db.run(`UPDATE boards SET org_id = ? WHERE org_id IS NULL`, [legacy])
        .changes +
      db.run(`UPDATE invites SET org_id = ? WHERE org_id IS NULL`, [legacy])
        .changes;
    return { moved, skipped: 0 };
  })();
}

/** The relay's entire persistence. It stores envelopes it never inspects:
    payload stays an opaque JSON string end to end. Per-recipient rows make
    broadcast, ack, and TTL prune single statements. */
export class SwitchboardStore {
  readonly support: SupportStore;
  readonly orgs: OrgStore;

  constructor(private db: Database) {
    this.support = new SupportStore(db);
    db.run(`CREATE TABLE IF NOT EXISTS boards (
      username TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS asks_off (username TEXT PRIMARY KEY)`);
    db.run(`CREATE TABLE IF NOT EXISTS envelopes (
      id TEXT NOT NULL,
      recipient TEXT NOT NULL,
      from_user TEXT NOT NULL,
      to_field TEXT NOT NULL,
      type TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      received_at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (id, recipient)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS invites (
      code_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      redeemed_at INTEGER
    )`);
    addOrgColumn(db, 'boards');
    addOrgColumn(db, 'invites');
    this.orgs = new OrgStore(db);
    sweepNullOrgs(db, Date.now());
  }

  /** With no org, the board goes into the legacy org. A register for a
      username already in the same org reissues its token. */
  registerBoard(
    username: string,
    orgId?: string
  ): { username: string; token: string } {
    const canonical = canonicalUsername(username);
    const token = mintToken();
    const now = Date.now();
    this.db.transaction(() => {
      const org = this.writeOrg(canonical, orgId, now);
      this.db.run(
        `INSERT INTO boards (username, token_hash, created_at, org_id) VALUES (?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET token_hash = excluded.token_hash`,
        [canonical, hashToken(token), now, org]
      );
    })();
    return { username: canonical, token };
  }

  /** The org a write for this username lands in. Throws when no org is
      named and there is no legacy org to fall back on, or when another org
      holds the username. Call it inside the write's transaction. */
  private writeOrg(
    canonical: string,
    orgId: string | undefined,
    now: number
  ): string {
    const org = orgId ?? this.orgs.ensureLegacy(now);
    if (!org) throw new Error('name-an-org');
    if (this.heldByAnotherOrg(canonical, org, now))
      throw new UsernameTakenError();
    return org;
  }

  /** `IS NOT` rather than `!=`, so a row with no org holds its username
      against every org. */
  private heldByAnotherOrg(canonical: string, org: string, now: number) {
    return (
      this.db
        .query<unknown, [string, string, string, string, number]>(
          `SELECT 1 FROM boards WHERE username = ? AND org_id IS NOT ?
           UNION ALL
           SELECT 1 FROM invites WHERE username = ? AND org_id IS NOT ?
             AND redeemed_at IS NULL AND expires_at > ?
           LIMIT 1`
        )
        .get(canonical, org, canonical, org, now) !== null
    );
  }

  boardOrg(username: string): string | null {
    return (
      this.db
        .query<{ org_id: string | null }, [string]>(
          `SELECT org_id FROM boards WHERE username = ?`
        )
        .get(canonicalUsername(username))?.org_id ?? null
    );
  }

  authBoard(token: string): string | null {
    const row = this.db
      .query<{ username: string }, [string]>(
        `SELECT username FROM boards WHERE token_hash = ? AND org_id IS NOT NULL`
      )
      .get(hashToken(token));
    return row?.username ?? null;
  }

  /** One outstanding invite per handle (UNIQUE(username) backstops it): creating
      again replaces the old code atomically, which is also the rotation story. */
  createInvite(
    username: string,
    now: number = Date.now(),
    orgId?: string
  ): { code: string; username: string; expiresAt: number } {
    const canonical = canonicalUsername(username);
    const code = mintCode();
    const expiresAt = now + INVITE_TTL_MS;
    this.db.transaction(() => {
      // Before the delete, which would otherwise drop another org's open invite.
      const org = this.writeOrg(canonical, orgId, now);
      this.db.run(`DELETE FROM invites WHERE username = ?`, [canonical]);
      this.db.run(
        `INSERT INTO invites (code_hash, username, created_at, expires_at, org_id) VALUES (?, ?, ?, ?, ?)`,
        [hashToken(code), canonical, now, expiresAt, org]
      );
    })();
    return { code, username: canonical, expiresAt };
  }

  /** The identity guard lives here (spec ruling 5): a mismatch consumes nothing
      and rotates nothing, so a wrong paste can never burn someone else's invite.
      Consumption is one atomic check-and-set, and it shares a transaction with
      registerBoard: a crash between the two would otherwise burn the invite
      without ever handing back a token, which no re-invite could undo. */
  redeemInvite(
    code: string,
    username: string,
    now: number = Date.now()
  ):
    | { ok: true; username: string; token: string }
    | {
        ok: false;
        error: 'unknown' | 'expired' | 'spent' | 'mismatch' | 'taken';
      } {
    const row = this.db
      .query<
        {
          username: string;
          expires_at: number;
          redeemed_at: number | null;
          org_id: string | null;
        },
        [string]
      >(
        `SELECT username, expires_at, redeemed_at, org_id FROM invites WHERE code_hash = ?`
      )
      .get(hashToken(code));
    if (!row || row.org_id === null) return { ok: false, error: 'unknown' };
    const org = row.org_id;
    if (row.redeemed_at !== null) return { ok: false, error: 'spent' };
    if (row.expires_at <= now) return { ok: false, error: 'expired' };
    if (row.username !== canonicalUsername(username))
      return { ok: false, error: 'mismatch' };
    const board = this.db.transaction(() => {
      if (this.heldByAnotherOrg(row.username, org, now)) return 'taken';
      const consumed = this.db.run(
        `UPDATE invites SET redeemed_at = ? WHERE code_hash = ? AND redeemed_at IS NULL AND expires_at > ?`,
        [now, hashToken(code), now]
      ).changes;
      if (consumed === 0) return 'spent';
      return this.registerBoard(row.username, org);
    })();
    if (typeof board === 'string') return { ok: false, error: board };
    return { ok: true, ...board };
  }

  /** Remove a board outright: its registration (killing the token), its
      pending envelopes, any outstanding invite for the handle, and its
      support messages and host flag. Returns false when no such board
      exists, or when an org is named and the board is in another one. */
  deleteBoard(username: string, orgId?: string): boolean {
    const canonical = canonicalUsername(username);
    return this.db.transaction(() => {
      const gone =
        orgId === undefined
          ? this.db.run(`DELETE FROM boards WHERE username = ?`, [canonical])
              .changes
          : this.db.run(
              `DELETE FROM boards WHERE username = ? AND org_id = ?`,
              [canonical, orgId]
            ).changes;
      if (gone === 0) return false;
      this.db.run(`DELETE FROM envelopes WHERE recipient = ?`, [canonical]);
      this.db.run(`DELETE FROM invites WHERE username = ?`, [canonical]);
      this.db.run(`DELETE FROM asks_off WHERE username = ?`, [canonical]);
      this.support.clear(canonical);
      return true;
    })();
  }

  setAsksEnabled(username: string, enabled: boolean): void {
    const u = canonicalUsername(username);
    if (enabled) this.db.run(`DELETE FROM asks_off WHERE username = ?`, [u]);
    else
      this.db.run(`INSERT OR IGNORE INTO asks_off (username) VALUES (?)`, [u]);
  }

  /** With no org, every org's boards. */
  listAskableUsernames(orgId?: string): string[] {
    const askable = `username NOT IN (SELECT username FROM asks_off)`;
    const rows =
      orgId === undefined
        ? this.db
            .query<{ username: string }, []>(
              `SELECT username FROM boards WHERE ${askable} ORDER BY username`
            )
            .all()
        : this.db
            .query<{ username: string }, [string]>(
              `SELECT username FROM boards WHERE org_id = ? AND ${askable} ORDER BY username`
            )
            .all(orgId);
    return rows.map(r => r.username);
  }

  /** With no org, every org's boards. */
  listBoards(
    orgId?: string
  ): Array<{ username: string; createdAt: number; org: string | null }> {
    type Row = { username: string; created_at: number; org_id: string | null };
    const rows =
      orgId === undefined
        ? this.db
            .query<Row, []>(
              `SELECT username, created_at, org_id FROM boards ORDER BY username`
            )
            .all()
        : this.db
            .query<Row, [string]>(
              `SELECT username, created_at, org_id FROM boards WHERE org_id = ? ORDER BY username`
            )
            .all(orgId);
    return rows.map(r => ({
      username: r.username,
      createdAt: r.created_at,
      org: r.org_id,
    }));
  }

  /** Who an envelope from `from` to `to` reaches: never a board outside the
      sender's org. */
  recipients(from: string, to: string): string[] {
    const org = this.boardOrg(from);
    if (org === null) return [];
    const rows =
      to === '*'
        ? this.db
            .query<{ username: string }, [string, string]>(
              `SELECT username FROM boards WHERE org_id = ? AND username != ? ORDER BY username`
            )
            .all(org, from)
        : this.db
            .query<{ username: string }, [string, string]>(
              `SELECT username FROM boards WHERE org_id = ? AND username = ?`
            )
            .all(org, to);
    return rows.map(r => r.username);
  }

  publish(
    from: string,
    draft: DraftEnvelope,
    now: number
  ):
    | { ok: true; delivered: number }
    | { ok: false; error: 'unknown-recipient' } {
    const recipients = this.recipients(from, draft.to);
    if (draft.to !== '*' && recipients.length === 0)
      return { ok: false, error: 'unknown-recipient' };
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO envelopes (id, recipient, from_user, to_field, type, sent_at, received_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let delivered = 0;
    for (const r of recipients) {
      insert.run(
        draft.id,
        r,
        from,
        draft.to,
        draft.type,
        draft.sentAt,
        now,
        JSON.stringify(draft.payload)
      );
      delivered++;
    }
    return { ok: true, delivered };
  }

  inbox(username: string, limit: number = 100): Envelope[] {
    return this.db
      .query<
        {
          id: string;
          from_user: string;
          to_field: string;
          type: string;
          sent_at: number;
          received_at: number;
          payload: string;
        },
        [string, number]
      >(
        `SELECT id, from_user, to_field, type, sent_at, received_at, payload
         FROM envelopes WHERE recipient = ? ORDER BY received_at ASC, id ASC LIMIT ?`
      )
      .all(username, limit)
      .map(r => ({
        id: r.id,
        from: r.from_user,
        to: r.to_field,
        type: r.type,
        sentAt: r.sent_at,
        receivedAt: r.received_at,
        payload: JSON.parse(r.payload) as unknown,
      }));
  }

  /** Newest unacked `received_at` for this board strictly after `since`, or
      null when nothing newer is waiting. */
  newestAfter(username: string, since: number): number | null {
    const row = this.db
      .query<{ newest: number | null }, [string, number]>(
        `SELECT MAX(received_at) AS newest FROM envelopes WHERE recipient = ? AND received_at > ?`
      )
      .get(username, since);
    return row?.newest ?? null;
  }

  ack(username: string, ids: string[]): number {
    const del = this.db.prepare(
      `DELETE FROM envelopes WHERE recipient = ? AND id = ?`
    );
    let n = 0;
    for (const id of ids) n += del.run(username, id).changes;
    return n;
  }

  prune(now: number, ttlMs: number = ENVELOPE_TTL_MS): number {
    this.db.run(`DELETE FROM invites WHERE expires_at < ?`, [now]);
    return this.db.run(`DELETE FROM envelopes WHERE received_at < ?`, [
      now - ttlMs,
    ]).changes;
  }
}
