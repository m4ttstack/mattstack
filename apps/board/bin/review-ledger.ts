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
    if (eq !== -1) flag[a.slice(2, eq)] = a.slice(eq + 1);
    else flag[a.slice(2)] = argv[++i] ?? '';
  }
  return { rest, flag };
}

function jsonArray(name: string, raw: string | undefined): unknown[] {
  if (raw === undefined) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v)) return v;
  } catch {
    // falls through to the one message
  }
  return die(`--${name} must be a JSON array`);
}

function strings(name: string, raw: string | undefined): string[] {
  const v = jsonArray(name, raw);
  if (!v.every(x => typeof x === 'string' && x.length > 0))
    die(`--${name} must be a JSON array of strings`);
  return v as string[];
}

function skippedList(round: number, raw: string | undefined): SkippedFinding[] {
  return jsonArray('skipped', raw).map((x, i) => {
    const s = (x ?? {}) as Record<string, unknown>;
    const text = (k: string) =>
      typeof s[k] === 'string' && (s[k] as string).length > 0;
    if (
      !text('id') ||
      !text('title') ||
      !text('excerpt') ||
      !SEVERITIES.includes(s.severity as SkippedSeverity) ||
      (s.snippet !== undefined && typeof s.snippet !== 'string')
    )
      die(`--skipped[${i}]: id, title, severity and excerpt are required`);
    return {
      id: qualifySkippedId(round, s.id as string),
      title: s.title as string,
      severity: s.severity as SkippedSeverity,
      ...(typeof s.file === 'string' && s.file ? { file: s.file } : {}),
      ...(typeof s.line === 'number' && Number.isInteger(s.line) && s.line > 0
        ? { line: s.line }
        : {}),
      excerpt: s.excerpt as string,
      snippet: typeof s.snippet === 'string' ? s.snippet : '',
    };
  });
}

const { rest, flag } = flags(process.argv.slice(2));
const [verb, statePath] = rest;
if ((verb !== 'read' && verb !== 'record') || !statePath) die(USAGE);

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
      restored: strings('restored', flag.restored),
      confirmed: strings('confirmed', flag.confirmed),
      recordedAt: Date.now(),
    },
    db
  );
  console.log(JSON.stringify({ ok: true, round }));
}
