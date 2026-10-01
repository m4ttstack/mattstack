import { existsSync } from 'fs';

import { boardRootFromStatePath } from '../src/agent-status/emit.ts';
import {
  ledgerView,
  qualifySkippedId,
  readRounds,
  recordRound,
  type SkippedFinding,
  type SkippedSeverity,
} from '../src/review-rounds.ts';
import type { ReviewOutcome } from '../src/review-state.ts';
import { dbPathForRoot, openStateDb } from '../src/state/index.ts';

const VALID_OUTCOME: ReviewOutcome[] = ['comment', 'approve'];
const SEVERITIES: SkippedSeverity[] = ['critical', 'important', 'minor'];
const FLAGS = ['round', 'sha', 'outcome', 'skipped', 'restored', 'confirmed'];
const RESTORED_ID = /^r\d+-/;
const USAGE =
  'usage: review-ledger read <statePath> | review-ledger record <statePath> --round <n> --sha <sha> --outcome comment|approve [--skipped <json>] [--restored <json>] [--confirmed <json>]';

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function flags(argv: string[]): {
  rest: string[];
  flag: Record<string, string>;
} {
  const rest: string[] = [];
  const flag: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq !== -1 ? a.slice(2, eq) : a.slice(2);
    if (!FLAGS.includes(name)) die(`unknown flag --${name}`);
    flag[name] = eq !== -1 ? a.slice(eq + 1) : (argv[++i] ?? '');
  }
  return { rest, flag };
}

function jsonArray(name: string, raw: string | undefined): unknown[] {
  if (raw === undefined) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    v = undefined;
  }
  return Array.isArray(v) ? v : die(`--${name} must be a JSON array`);
}

function strings(name: string, raw: string | undefined): string[] {
  const v = jsonArray(name, raw);
  if (!v.every(x => typeof x === 'string' && x.length > 0))
    die(`--${name} must be a JSON array of strings`);
  return v as string[];
}

function restoredIds(raw: string | undefined): string[] {
  const ids = strings('restored', raw);
  const bad = ids.find(id => !RESTORED_ID.test(id));
  if (bad !== undefined)
    die(`--restored: ${bad} is not a round-qualified id (r<round>-<id>)`);
  return ids;
}

function skippedList(round: number, raw: string | undefined): SkippedFinding[] {
  return jsonArray('skipped', raw).map((x, i) => {
    const s = (x ?? {}) as Record<string, unknown>;
    const text = (k: string) =>
      typeof s[k] === 'string' && (s[k] as string).length > 0;
    if (!text('id') || !text('title') || !text('excerpt'))
      die(`--skipped[${i}]: id, title, severity and excerpt are required`);
    if (!SEVERITIES.includes(s.severity as SkippedSeverity))
      die(`--skipped[${i}].severity must be one of ${SEVERITIES.join('|')}`);
    if (s.file !== undefined && !text('file'))
      die(`--skipped[${i}].file must be a non-empty string when present`);
    if (
      s.line !== undefined &&
      !(typeof s.line === 'number' && Number.isInteger(s.line) && s.line > 0)
    )
      die(`--skipped[${i}].line must be a positive integer when present`);
    if (s.snippet !== undefined && typeof s.snippet !== 'string')
      die(`--skipped[${i}].snippet must be a string when present`);
    return {
      id: qualifySkippedId(round, s.id as string),
      title: s.title as string,
      severity: s.severity as SkippedSeverity,
      ...(s.file !== undefined ? { file: s.file as string } : {}),
      ...(s.line !== undefined ? { line: s.line as number } : {}),
      excerpt: s.excerpt as string,
      snippet: typeof s.snippet === 'string' ? s.snippet : '',
    };
  });
}

const { rest, flag } = flags(process.argv.slice(2));
const [verb, statePath, ...extra] = rest;
if ((verb !== 'read' && verb !== 'record') || !statePath) die(USAGE);
if (extra.length > 0) die(`unexpected argument ${extra[0]}; ${USAGE}`);
if (verb === 'read' && Object.keys(flag).length > 0)
  die(`read takes no flags; ${USAGE}`);

const dbPath = dbPathForRoot(boardRootFromStatePath(statePath));
if (!existsSync(dbPath))
  die(`no board db at ${dbPath}; stale pre-upgrade handle?`);
const db = openStateDb(dbPath, 'cli');
const row = db
  .query("SELECT mr_url FROM agent_states WHERE lane = 'review' AND handle = ?")
  .get(statePath) as { mr_url: string } | null;
if (!row)
  die(
    `no state row for ${statePath}; was this pane launched by a board on this machine?`
  );

if (verb === 'read') {
  console.log(JSON.stringify(ledgerView(readRounds(row.mr_url, db))));
} else {
  const round = Number(flag.round);
  if (!Number.isInteger(round) || round <= 0)
    die('--round must be a positive integer');
  if (!flag.sha) die('--sha is required');
  if (!VALID_OUTCOME.includes(flag.outcome as ReviewOutcome))
    die(`--outcome must be one of ${VALID_OUTCOME.join('|')}`);
  recordRound(
    {
      mrUrl: row.mr_url,
      round,
      reviewedSha: flag.sha,
      outcome: flag.outcome as ReviewOutcome,
      skipped: skippedList(round, flag.skipped),
      restored: restoredIds(flag.restored),
      confirmed: strings('confirmed', flag.confirmed),
      recordedAt: Date.now(),
    },
    db
  );
  console.log(JSON.stringify({ ok: true, round }));
}
