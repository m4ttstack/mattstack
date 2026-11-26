/** Orgs on the relay: an opaque random id, the sha256 of its token, and
    nothing that names whose org it is. `ORG_TOKEN_PREFIX` is declared again
    in `packages/rt-client/src/switchboard.ts`, because the relay image copies
    only `apps/board/switchboard/*.ts`. */
import { randomBytes } from 'node:crypto';
import type { Database } from 'bun:sqlite';

export const ORG_TOKEN_PREFIX = 'sbo_';
export const ORG_TOKEN_RE = /^sbo_[0-9a-f]{64}$/;

const LEGACY_MASTER_HASH = 'legacy_master_hash';
const LEGACY_TOKEN_RETIRED = 'legacy_token_retired';

function sha256(v: string): string {
  return new Bun.CryptoHasher('sha256').update(v).digest('hex');
}

export interface OrgRow {
  id: string;
  legacy: boolean;
  hasToken: boolean;
  boards: number;
  createdAt: number;
  tokenAt: number | null;
}

export class OrgStore {
  constructor(private db: Database) {
    db.run(`CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE,
      legacy INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      token_at INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS relay_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
  }

  create(now: number): { id: string } {
    const id = randomBytes(16).toString('hex');
    this.db.run(`INSERT INTO orgs (id, legacy, created_at) VALUES (?, 0, ?)`, [
      id,
      now,
    ]);
    return { id };
  }

  mintToken(id: string, now: number): string | null {
    const token = ORG_TOKEN_PREFIX + randomBytes(32).toString('hex');
    const changed = this.db.run(
      `UPDATE orgs SET token_hash = ?, token_at = ? WHERE id = ?`,
      [sha256(token), now, id]
    ).changes;
    return changed === 0 ? null : token;
  }

  authOrg(token: string): string | null {
    if (!ORG_TOKEN_RE.test(token)) return null;
    const row = this.db
      .query<{ id: string }, [string]>(
        `SELECT id FROM orgs WHERE token_hash = ?`
      )
      .get(sha256(token));
    return row?.id ?? null;
  }

  list(): OrgRow[] {
    return this.db
      .query<
        {
          id: string;
          legacy: number;
          token_hash: string | null;
          boards: number;
          created_at: number;
          token_at: number | null;
        },
        []
      >(
        `SELECT o.id, o.legacy, o.token_hash, o.created_at, o.token_at,
           (SELECT COUNT(*) FROM boards b WHERE b.org_id = o.id) AS boards
         FROM orgs o ORDER BY o.created_at, o.id`
      )
      .all()
      .map(r => ({
        id: r.id,
        legacy: r.legacy === 1,
        hasToken: r.token_hash !== null,
        boards: r.boards,
        createdAt: r.created_at,
        tokenAt: r.token_at,
      }));
  }

  exists(id: string): boolean {
    return (
      this.db
        .query<unknown, [string]>(`SELECT 1 FROM orgs WHERE id = ?`)
        .get(id) !== null
    );
  }

  legacyId(): string | null {
    return (
      this.db
        .query<{ id: string }, []>(
          `SELECT id FROM orgs WHERE legacy = 1 LIMIT 1`
        )
        .get()?.id ?? null
    );
  }

  hasNonLegacy(): boolean {
    return (
      this.db
        .query<unknown, []>(`SELECT 1 FROM orgs WHERE legacy = 0 LIMIT 1`)
        .get() !== null
    );
  }

  /** Once a non-legacy org exists, a legacy org is never made: a new one
      would stamp the master then in use and close the second-org gate
      again. */
  ensureLegacy(now: number): string | null {
    return this.db.transaction((): string | null => {
      const existing = this.legacyId();
      if (existing) return existing;
      if (this.hasNonLegacy()) return null;
      const id = randomBytes(16).toString('hex');
      this.db.run(
        `INSERT INTO orgs (id, legacy, created_at) VALUES (?, 1, ?)`,
        [id, now]
      );
      return id;
    })();
  }

  async stampLegacyMaster(master: string): Promise<void> {
    if (!this.legacyId() || this.stamp() !== null) return;
    const hash = await Bun.password.hash(master, { algorithm: 'argon2id' });
    this.db.run(`INSERT OR IGNORE INTO relay_meta (key, value) VALUES (?, ?)`, [
      LEGACY_MASTER_HASH,
      hash,
    ]);
  }

  /** Every legacy member held the stamped master, so a legacy org token or
      open legacy invite minted under it dies on the first start with another
      master. Once per database: a later rotation never revokes the token
      minted after it. Returns the id of the legacy org it cleared, or null. */
  async retireLegacyToken(master: string, now: number): Promise<string | null> {
    const stamp = this.stamp();
    if (stamp === null || this.meta(LEGACY_TOKEN_RETIRED) !== null) return null;
    if (await Bun.password.verify(master, stamp)) return null;
    return this.db.transaction((): string | null => {
      if (this.meta(LEGACY_TOKEN_RETIRED) !== null) return null;
      const cleared = this.db
        .query<{ id: string }, []>(
          `UPDATE orgs SET token_hash = NULL, token_at = NULL WHERE legacy = 1 RETURNING id`
        )
        .get();
      if (cleared)
        this.db.run(
          `DELETE FROM invites WHERE org_id = ? AND redeemed_at IS NULL`,
          [cleared.id]
        );
      this.db.run(`INSERT INTO relay_meta (key, value) VALUES (?, ?)`, [
        LEGACY_TOKEN_RETIRED,
        String(now),
      ]);
      return cleared?.id ?? null;
    })();
  }

  legacyTokenRetired(): boolean {
    return this.meta(LEGACY_TOKEN_RETIRED) !== null;
  }

  async masterGateClosed(master: string): Promise<boolean> {
    const stamp = this.stamp();
    return stamp !== null && (await Bun.password.verify(master, stamp));
  }

  private stamp(): string | null {
    return this.meta(LEGACY_MASTER_HASH);
  }

  private meta(key: string): string | null {
    return (
      this.db
        .query<{ value: string }, [string]>(
          `SELECT value FROM relay_meta WHERE key = ?`
        )
        .get(key)?.value ?? null
    );
  }
}
