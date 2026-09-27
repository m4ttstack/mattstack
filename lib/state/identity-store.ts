/**
 * lib/state/identity-store.ts: chat identities (spec
 * 2026-09-27-chat-identity-design.md). The only module that writes
 * `chat_identities`. An id is `<base>.<suffix>`; a handle with no row here
 * is a legacy id whose display name is itself.
 */

import { Database } from "bun:sqlite";
import { baseOfHandle } from "../chat-names.ts";
import { getStateDb } from "./db.ts";

export interface IdentityRow {
  id: string;
  name: string;
  baseName: string;
  mintedAt: number;
  sessionId: string | null;
}

interface IdentityRawRow {
  id: string;
  name: string;
  base_name: string;
  minted_at: number;
  session_id: string | null;
}

function rowToIdentity(row: IdentityRawRow): IdentityRow {
  return { id: row.id, name: row.name, baseName: row.base_name, mintedAt: row.minted_at, sessionId: row.session_id };
}

const IDENTITY_COLUMNS = "id, name, base_name, minted_at, session_id";
const SELECT_IDENTITY_SQL = `SELECT ${IDENTITY_COLUMNS} FROM chat_identities WHERE id = ?;`;
const SELECT_IDENTITY_BY_SESSION_SQL = `SELECT ${IDENTITY_COLUMNS} FROM chat_identities WHERE session_id = ? ORDER BY minted_at DESC, rowid DESC LIMIT 1;`;
const SELECT_NAME_SQL = `SELECT name FROM chat_identities WHERE id = ?;`;
const INSERT_IDENTITY_SQL = `INSERT INTO chat_identities (id, name, base_name, minted_at, session_id) VALUES (?, ?, ?, ?, ?);`;
const ADOPT_LEGACY_SQL = `INSERT INTO chat_identities (id, name, base_name, minted_at, minted, session_id) VALUES (?, ?, ?, ?, 0, NULL) ON CONFLICT(id) DO NOTHING;`;
const SELECT_MINTED_SQL = `SELECT 1 FROM chat_identities WHERE id = ? AND minted = 1;`;
const UNBIND_SESSION_SQL = `UPDATE chat_identities SET session_id = NULL WHERE session_id = ? AND id <> ?;`;
const BIND_SESSION_SQL = `UPDATE chat_identities SET session_id = ? WHERE id = ?;`;
const RENAME_IDENTITY_SQL = `UPDATE chat_identities SET name = ?, base_name = ? WHERE id = ?;`;

// Reads other modules' tables on purpose: an id minted onto a handle any of
// them already holds would inherit that handle's footprint.
const KNOWN_ID_SQL = `
SELECT 1 AS known FROM chat_identities WHERE id = $id
UNION ALL SELECT 1 FROM chat_members WHERE handle = $id
LIMIT 1;`;

// Well under SQLite's bound-parameter limit on every build bun ships.
const NAME_LOOKUP_CHUNK = 500;

/** True when `x` is a known id: a chat_identities row, or a handle in chat_presence, chat_members, chat_messages or chat_dms. */
export function isKnownId(x: string, db: Database = getStateDb()): boolean {
  return db.query(KNOWN_ID_SQL).get({ $id: x }) !== null;
}

function base36Suffix(seed: string, length: number): string {
  const hex = new Bun.CryptoHasher("sha256").update(seed).digest("hex");
  return BigInt(`0x${hex}`).toString(36).slice(-length);
}

function freshId(base: string, sessionId: string | null, mintedAt: number, db: Database): string {
  const seed = `${sessionId ?? ""}:${mintedAt}`;
  const short = `${base}.${base36Suffix(seed, 4)}`;
  if (!isKnownId(short, db)) return short;
  for (let salt = 0; ; salt++) {
    const id = `${base}.${base36Suffix(salt === 0 ? seed : `${seed}:${salt}`, 6)}`;
    if (!isKnownId(id, db)) return id;
  }
}

/** Mints and inserts a fresh identity. `name` is the display name (suffix included); `base` is the pool or chosen base. */
export function mintIdentity(
  args: { base: string; name: string; sessionId: string | null; now?: number },
  db: Database = getStateDb(),
): IdentityRow {
  const mintedAt = args.now ?? Date.now();
  const run = db.transaction((): IdentityRow => {
    const id = freshId(args.base, args.sessionId, mintedAt, db);
    if (args.sessionId !== null) db.query(UNBIND_SESSION_SQL).run(args.sessionId, id);
    db.query(INSERT_IDENTITY_SQL).run(id, args.name, args.base, mintedAt, args.sessionId);
    return { id, name: args.name, baseName: args.base, mintedAt, sessionId: args.sessionId };
  });
  // BEGIN IMMEDIATE when standalone: the known-id probe and the insert must
  // hold the write lock together or a racing mint lands the same id.
  return db.inTransaction ? run() : run.immediate();
}

export function getIdentity(id: string, db: Database = getStateDb()): IdentityRow | undefined {
  const row = db.query(SELECT_IDENTITY_SQL).get(id) as IdentityRawRow | null;
  return row ? rowToIdentity(row) : undefined;
}

/** The identity a session already holds, if any (survives presence prune). */
export function identityForSession(sessionId: string, db: Database = getStateDb()): IdentityRow | undefined {
  const row = db.query(SELECT_IDENTITY_BY_SESSION_SQL).get(sessionId) as IdentityRawRow | null;
  return row ? rowToIdentity(row) : undefined;
}

/** Binds an existing identity (a reservation or a continuation) to a session, releasing any other identity that session held. A legacy id with no row is adopted under its own name. */
export function bindIdentitySession(id: string, sessionId: string, db: Database = getStateDb()): void {
  const run = db.transaction(() => {
    db.query(ADOPT_LEGACY_SQL).run(id, id, baseOfHandle(id), Date.now());
    db.query(UNBIND_SESSION_SQL).run(sessionId, id);
    db.query(BIND_SESSION_SQL).run(sessionId, id);
  });
  if (db.inTransaction) run();
  else run.immediate();
}

export function renameIdentity(id: string, name: string, baseName: string, db: Database = getStateDb()): void {
  db.query(RENAME_IDENTITY_SQL).run(name, baseName, id);
}

/** Display name for one id; falls back to the id itself. */
export function identityName(id: string, db: Database = getStateDb()): string {
  const row = db.query(SELECT_NAME_SQL).get(id) as { name: string } | null;
  return row?.name ?? id;
}

/** Display names for many ids in one query; every input id is a key, missing rows map to themselves. */
export function identityNames(ids: Iterable<string>, db: Database = getStateDb()): Map<string, string> {
  const names = new Map<string, string>();
  for (const id of ids) names.set(id, id);
  const all = [...names.keys()];
  for (let i = 0; i < all.length; i += NAME_LOOKUP_CHUNK) {
    const chunk = all.slice(i, i + NAME_LOOKUP_CHUNK);
    const sql = `SELECT id, name FROM chat_identities WHERE id IN (${chunk.map(() => "?").join(", ")});`;
    for (const row of db.query(sql).all(...chunk) as { id: string; name: string }[]) names.set(row.id, row.name);
  }
  return names;
}
