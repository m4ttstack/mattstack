import type { Database } from "bun:sqlite";
import { existsSync } from "fs";
import type {
  UsageKind,
  UsageModelRow,
  UsageMrData,
  UsageMrEntry,
  UsageMrRow,
  UsageMrsData,
  UsagePipelineRow,
  UsageSplits,
  UsageStageRow,
  UsageStatusData,
  UsageTotals,
  UsageTrendsData,
  UsageWeekRow,
} from "../../packages/rt-client/src/commands.ts";
import { kindOf } from "./mr-key.ts";
import { costOf } from "./pricing.ts";
import { openUsageDbReadonly } from "./store.ts";

const DAY_MS = 86_400_000;
const KINDS: readonly UsageKind[] = ["work", "review", "respond", "doctor", "other"];

interface MessageRow {
  machine_id: string;
  run_id: string | null;
  mr_key: string | null;
  work_type: string | null;
  agent_kind: UsageKind;
  pipeline: string | null;
  status: string | null;
  started_at: number | null;
  ended_at: number | null;
  mr_url: string | null;
  ticket: string | null;
  branch: string | null;
  model: string | null;
  speed: string | null;
  input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  messages: number;
  first_ts: number;
  last_ts: number;
}

interface MrDetailRow extends MessageRow {
  agent_session: string | null;
  stage: string | null;
  attempt: number | null;
  is_subagent: number;
}

interface Scope {
  where: string;
  params: Record<string, string | number>;
}

// usage_sessions holds several rows per session, so it joins only through this one-row-per-session
// reduction. The Haiku 5.5 CASE keeps its messages apart: its price tier depends on one request's
// prompt length, which a sum would hide. Bare r.* columns are safe because the group fixes the run.
function selectMessages(db: Database, scope: Scope, dims: string[]): unknown[] {
  const groupBy = [
    "m.machine_id",
    "m.run_id",
    "a.agent_kind",
    "m.model",
    "m.speed",
    "CASE WHEN m.model GLOB 'claude-haiku-5-5*' THEN m.rowid END",
    ...dims.map((d) => d.split(" AS ")[0]),
  ];
  return db
    .query(
      `WITH agent_kinds AS (
         SELECT machine_id, session_id,
           CASE WHEN MAX(agent_kind = 'doctor') = 1 THEN 'doctor' ELSE 'other' END AS agent_kind
         FROM usage_sessions WHERE source = 'agent' GROUP BY machine_id, session_id
       )
       SELECT m.machine_id, m.run_id, COALESCE(a.agent_kind, 'other') AS agent_kind,
         r.work_type, r.pipeline, r.status, r.started_at, r.ended_at, r.mr_url, r.ticket, r.branch,
         m.model, m.speed,
         SUM(m.input) AS input, SUM(m.output) AS output, SUM(m.cache_read) AS cache_read,
         SUM(m.cache_write_5m) AS cache_write_5m, SUM(m.cache_write_1h) AS cache_write_1h,
         COUNT(*) AS messages,
         MIN(m.ts) AS first_ts, MAX(m.ts) AS last_ts
         ${dims.map((d) => `, ${d}`).join("")}
       FROM usage_messages m
       LEFT JOIN usage_runs r ON r.machine_id = m.machine_id AND r.run_id = m.run_id
       LEFT JOIN agent_kinds a ON a.machine_id = m.machine_id AND a.session_id = m.session_id
       WHERE ${scope.where}
       GROUP BY ${groupBy.join(", ")}`,
    )
    .all(scope.params);
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0, cost: 0, unpricedTokens: 0 };
}

function byKindOf<T>(make: () => T): Record<UsageKind, T> {
  return Object.fromEntries(KINDS.map((k) => [k, make()])) as Record<UsageKind, T>;
}

function totalsOf(row: MessageRow): UsageTotals {
  const cost = costOf(
    row.model ?? "",
    {
      input: row.input,
      output: row.output,
      cacheRead: row.cache_read,
      cacheWrite5m: row.cache_write_5m,
      cacheWrite1h: row.cache_write_1h,
    },
    row.speed,
  );
  const cacheWrite = row.cache_write_5m + row.cache_write_1h;
  return {
    input: row.input,
    output: row.output,
    cacheRead: row.cache_read,
    cacheWrite,
    messages: row.messages,
    cost: cost ?? 0,
    unpricedTokens: cost === null ? row.input + row.output + row.cache_read + cacheWrite : 0,
  };
}

function add(into: UsageTotals, from: UsageTotals): void {
  into.input += from.input;
  into.output += from.output;
  into.cacheRead += from.cacheRead;
  into.cacheWrite += from.cacheWrite;
  into.messages += from.messages;
  into.cost += from.cost;
  into.unpricedTokens += from.unpricedTokens;
}

function addTo<K>(rows: Map<K, UsageTotals>, key: K, from: UsageTotals): void {
  let totals = rows.get(key);
  if (!totals) {
    totals = emptyTotals();
    rows.set(key, totals);
  }
  add(totals, from);
}

function kindFor(row: MessageRow): UsageKind {
  return row.run_id === null ? row.agent_kind : kindOf(row.work_type ?? "");
}

function runIdentity(row: MessageRow): string {
  return `${row.machine_id}\0${row.run_id}`;
}

function modelRows(rows: Map<string | null, UsageTotals>): UsageModelRow[] {
  return [...rows].map(([model, totals]) => ({ model, totals }));
}

function hasSchema(db: Database): boolean {
  return (
    db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_messages'").get() !== null
  );
}

function reading<T>(dbPath: string, empty: T, read: (db: Database) => T): T {
  const db = openUsageDbReadonly(dbPath);
  if (!db) return empty;
  try {
    return hasSchema(db) ? read(db) : empty;
  } finally {
    db.close();
  }
}

function repoOfKey(repo: string): string {
  return `substr(m.mr_key, 1, length(${repo}) + 1) = ${repo} || '!'`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function runOrder(a: { started_at: number | null }, b: { started_at: number | null }): number {
  return (a.started_at ?? 0) - (b.started_at ?? 0);
}

interface RunPick {
  latest: MessageRow | null;
  latestWithUrl: MessageRow | null;
}

function pickRun(pick: RunPick, row: MessageRow): void {
  if (row.run_id === null) return;
  if (!pick.latest || runOrder(pick.latest, row) < 0) pick.latest = row;
  if (row.mr_url === null) return;
  if (!pick.latestWithUrl || runOrder(pick.latestWithUrl, row) < 0) pick.latestWithUrl = row;
}

function runFields(pick: RunPick): { url: string | null; ticket: string | null; branch: string | null } {
  return {
    url: pick.latestWithUrl?.mr_url ?? null,
    ticket: pick.latest?.ticket ?? null,
    branch: pick.latest?.branch ?? null,
  };
}

interface MrFold {
  row: UsageMrRow;
  pick: RunPick;
  runs: Set<string>;
  respondRuns: Set<string>;
}

function foldMr(fold: MrFold, row: MessageRow): void {
  const delta = totalsOf(row);
  add(fold.row.totals, delta);
  fold.row.costByKind[kindFor(row)] += delta.cost;
  fold.row.firstActivity = Math.min(fold.row.firstActivity, row.first_ts);
  fold.row.lastActivity = Math.max(fold.row.lastActivity, row.last_ts);
  pickRun(fold.pick, row);
  if (row.run_id === null) return;
  fold.runs.add(runIdentity(row));
  if (kindFor(row) === "respond") fold.respondRuns.add(runIdentity(row));
}

export function usageMrs(
  dbPath: string,
  q: { days?: number; repo?: string; now: number },
): UsageMrsData {
  const empty: UsageMrsData = {
    mrs: [],
    summary: { mrCount: 0, totals: emptyTotals(), medianCost: 0 },
  };
  return reading(dbPath, empty, (db) => {
    const params: Scope["params"] = {};
    let where = "m.mr_key IS NOT NULL";
    if (q.repo !== undefined) {
      where += ` AND ${repoOfKey("$repo")}`;
      params.$repo = q.repo;
    }
    const rows = selectMessages(db, { where, params }, ["m.mr_key"]) as MessageRow[];

    const folds = new Map<string, MrFold>();
    for (const row of rows) {
      const mrKey = row.mr_key!;
      let fold = folds.get(mrKey);
      if (!fold) {
        fold = {
          row: {
            mrKey,
            url: null,
            ticket: null,
            branch: null,
            firstActivity: row.first_ts,
            lastActivity: row.last_ts,
            totals: emptyTotals(),
            costByKind: byKindOf(() => 0),
            runCount: 0,
            roundCount: 0,
          },
          pick: { latest: null, latestWithUrl: null },
          runs: new Set(),
          respondRuns: new Set(),
        };
        folds.set(mrKey, fold);
      }
      foldMr(fold, row);
    }

    const since = q.days === undefined ? null : q.now - q.days * DAY_MS;
    const mrs: UsageMrRow[] = [];
    for (const fold of folds.values()) {
      if (since !== null && fold.row.lastActivity < since) continue;
      mrs.push({
        ...fold.row,
        ...runFields(fold.pick),
        runCount: fold.runs.size,
        roundCount: fold.respondRuns.size,
      });
    }
    mrs.sort((a, b) => b.lastActivity - a.lastActivity);

    const totals = emptyTotals();
    for (const mr of mrs) add(totals, mr.totals);
    return {
      mrs,
      summary: { mrCount: mrs.length, totals, medianCost: median(mrs.map((m) => m.totals.cost)) },
    };
  });
}

interface SplitFold {
  totals: UsageTotals;
  models: Map<string | null, UsageTotals>;
  main: UsageTotals;
  subagent: UsageTotals;
}

function emptySplits(): SplitFold {
  return { totals: emptyTotals(), models: new Map(), main: emptyTotals(), subagent: emptyTotals() };
}

function foldSplits(fold: SplitFold, row: MrDetailRow, delta: UsageTotals): void {
  add(fold.totals, delta);
  addTo(fold.models, row.model, delta);
  add(row.is_subagent ? fold.subagent : fold.main, delta);
}

function splitsOf(fold: SplitFold): UsageSplits & { totals: UsageTotals } {
  return {
    totals: fold.totals,
    byModel: modelRows(fold.models),
    main: fold.main,
    subagent: fold.subagent,
  };
}

interface EntryFold {
  first: MrDetailRow;
  splits: SplitFold;
  stages: Map<string, { name: string | null; attempt: number | null; totals: UsageTotals }>;
  firstActivity: number;
  lastActivity: number;
}

interface StageRecord {
  name: string;
  attempt: number;
  status: string | null;
  started_at: number | null;
  ended_at: number | null;
}

function stageKey(name: string | null, attempt: number | null): string {
  return `${name}\0${attempt}`;
}

function stageRows(db: Database, entry: EntryFold): UsageStageRow[] {
  const { machine_id, run_id } = entry.first;
  const records = (
    run_id === null
      ? []
      : db
          .query(
            `SELECT name, attempt, status, started_at, ended_at FROM usage_stages
             WHERE machine_id = ? AND run_id = ?`,
          )
          .all(machine_id, run_id)
  ) as StageRecord[];

  const rows: UsageStageRow[] = records.map((s) => ({
    name: s.name,
    attempt: s.attempt,
    status: s.status,
    startedAt: s.started_at,
    endedAt: s.ended_at,
    totals: entry.stages.get(stageKey(s.name, s.attempt))?.totals ?? emptyTotals(),
  }));
  rows.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

  const recorded = new Set(records.map((s) => stageKey(s.name, s.attempt)));
  const unrecorded = [...entry.stages]
    .filter(([key]) => !recorded.has(key))
    .map(([, s]) => ({ ...s, status: null, startedAt: null, endedAt: null }));
  return [...rows, ...unrecorded];
}

function entryRow(db: Database, entry: EntryFold, round: number | null): UsageMrEntry {
  const { first } = entry;
  return {
    ...splitsOf(entry.splits),
    runId: first.run_id,
    sessionId: first.agent_session,
    kind: kindFor(first),
    round,
    pipeline: first.pipeline,
    status: first.status,
    startedAt: first.started_at,
    endedAt: first.ended_at,
    firstActivity: entry.firstActivity,
    lastActivity: entry.lastActivity,
    stages: stageRows(db, entry),
  };
}

function numberRounds(entries: EntryFold[]): Map<EntryFold, number> {
  const respond = entries
    .filter((e) => kindFor(e.first) === "respond")
    .sort((a, b) => runOrder(a.first, b.first));
  return new Map(respond.map((e, i) => [e, i + 1]));
}

export function usageMr(dbPath: string, mrKey: string): UsageMrData | null {
  return reading<UsageMrData | null>(dbPath, null, (db) => {
    const rows = selectMessages(
      db,
      { where: "m.mr_key = $mrKey", params: { $mrKey: mrKey } },
      [
        "CASE WHEN m.run_id IS NULL THEN m.session_id END AS agent_session",
        "m.stage",
        "m.attempt",
        "m.subagent_id IS NOT NULL AS is_subagent",
      ],
    ) as MrDetailRow[];
    if (rows.length === 0) return null;

    const splits = emptySplits();
    const costByKind = byKindOf(() => 0);
    const entries = new Map<string, EntryFold>();
    const pick: RunPick = { latest: null, latestWithUrl: null };
    for (const row of rows) {
      const delta = totalsOf(row);
      foldSplits(splits, row, delta);
      costByKind[kindFor(row)] += delta.cost;
      pickRun(pick, row);

      const key = `${runIdentity(row)}\0${row.agent_session}`;
      let entry = entries.get(key);
      if (!entry) {
        entry = {
          first: row,
          splits: emptySplits(),
          stages: new Map(),
          firstActivity: row.first_ts,
          lastActivity: row.last_ts,
        };
        entries.set(key, entry);
      }
      foldSplits(entry.splits, row, delta);
      entry.firstActivity = Math.min(entry.firstActivity, row.first_ts);
      entry.lastActivity = Math.max(entry.lastActivity, row.last_ts);

      const stageId = stageKey(row.stage, row.attempt);
      let stage = entry.stages.get(stageId);
      if (!stage) {
        stage = { name: row.stage, attempt: row.attempt, totals: emptyTotals() };
        entry.stages.set(stageId, stage);
      }
      add(stage.totals, delta);
    }

    const startOf = (e: EntryFold) => e.first.started_at ?? e.firstActivity;
    const ordered = [...entries.values()].sort((a, b) => startOf(a) - startOf(b));
    const rounds = numberRounds(ordered);
    const first = Math.min(...ordered.map((e) => e.firstActivity));
    const last = Math.max(...ordered.map((e) => e.lastActivity));
    return {
      ...splitsOf(splits),
      mrKey,
      ...runFields(pick),
      firstActivity: first,
      lastActivity: last,
      costByKind,
      runs: ordered.map((e) => entryRow(db, e, rounds.get(e) ?? null)),
    };
  });
}

function mondayOf(ms: number): Date {
  const date = new Date(ms);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  date.setHours(0, 0, 0, 0);
  return date;
}

function nextWeek(week: Date): Date {
  return new Date(week.getFullYear(), week.getMonth(), week.getDate() + 7);
}

export function usageTrends(
  dbPath: string,
  q: { days: number; repo?: string; now: number },
): UsageTrendsData {
  const empty: UsageTrendsData = { weeks: [], totals: emptyTotals(), byPipeline: [], byModel: [] };
  return reading(dbPath, empty, (db) => {
    const since = q.now - q.days * DAY_MS;
    const params: Scope["params"] = {};
    let filter = "m.attribution != 'none' AND m.ts >= $since AND m.ts < $until";
    if (q.repo !== undefined) {
      filter += ` AND (CASE WHEN m.mr_key IS NULL THEN r.repo = $repo ELSE ${repoOfKey("$repo")} END)`;
      params.$repo = q.repo;
    }

    const weeks: UsageWeekRow[] = [];
    const totals = emptyTotals();
    const pipelines = new Map<string | null, UsageTotals>();
    const models = new Map<string | null, UsageTotals>();
    for (let week = mondayOf(since); week.getTime() <= q.now; week = nextWeek(week)) {
      const rows = selectMessages(
        db,
        {
          where: filter,
          params: {
            ...params,
            $since: Math.max(since, week.getTime()),
            $until: nextWeek(week).getTime(),
          },
        },
        [],
      ) as MessageRow[];
      if (rows.length === 0) continue;

      const row: UsageWeekRow = {
        weekStart: week.getTime(),
        totals: emptyTotals(),
        byKind: byKindOf(emptyTotals),
      };
      for (const message of rows) {
        const delta = totalsOf(message);
        add(row.totals, delta);
        add(row.byKind[kindFor(message)], delta);
        add(totals, delta);
        addTo(pipelines, message.pipeline, delta);
        addTo(models, message.model, delta);
      }
      weeks.push(row);
    }

    const byPipeline: UsagePipelineRow[] = [...pipelines].map(([pipeline, t]) => ({
      pipeline,
      totals: t,
    }));
    return { weeks, totals, byPipeline, byModel: modelRows(models) };
  });
}

function metaNumber(db: Database, key: string): number | null {
  const row = db.query("SELECT value FROM usage_meta WHERE key = ?").get(key) as
    | { value: string }
    | null;
  return row ? Number(row.value) : null;
}

function countOf(db: Database, sql: string): number {
  return (db.query(sql).get() as { n: number }).n;
}

// usage_files rows outlive their transcripts, so a row alone does not prove the file is still there.
function sessionsMissingTranscript(db: Database): number {
  const files = db
    .query("SELECT path, session_id FROM usage_files WHERE session_id IS NOT NULL")
    .all() as { path: string; session_id: string }[];
  const present = new Set(files.filter((f) => existsSync(f.path)).map((f) => f.session_id));
  const linked = db.query("SELECT DISTINCT session_id FROM usage_sessions").all() as {
    session_id: string;
  }[];
  return linked.filter((s) => !present.has(s.session_id)).length;
}

export function usageStatus(dbPath: string): UsageStatusData {
  const empty: UsageStatusData = {
    lastSweepAt: null,
    lastSweepMs: null,
    messages: 0,
    runs: 0,
    skippedLines: 0,
    conflicts: 0,
    skippedRate: 0,
    unpricedModels: [],
    sessionsMissingTranscript: 0,
  };
  return reading(dbPath, empty, (db) => {
    const messages = countOf(db, "SELECT COUNT(*) AS n FROM usage_messages");
    const skippedLines = metaNumber(db, "skipped_lines") ?? 0;
    const seen = messages + skippedLines;
    const models = db
      .query("SELECT DISTINCT model FROM usage_messages WHERE model IS NOT NULL ORDER BY model")
      .all() as { model: string }[];
    const noTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
    return {
      lastSweepAt: metaNumber(db, "last_sweep_at"),
      lastSweepMs: metaNumber(db, "last_sweep_ms"),
      messages,
      runs: countOf(db, "SELECT COUNT(*) AS n FROM usage_runs"),
      skippedLines,
      conflicts: metaNumber(db, "conflicts") ?? 0,
      skippedRate: seen === 0 ? 0 : skippedLines / seen,
      unpricedModels: models.map((m) => m.model).filter((m) => costOf(m, noTokens, null) === null),
      sessionsMissingTranscript: sessionsMissingTranscript(db),
    };
  });
}
