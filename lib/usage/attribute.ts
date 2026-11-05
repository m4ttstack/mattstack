import type { Database } from "bun:sqlite";

interface Run {
  run_id: string;
  status: string | null;
  started_at: number;
  ended_at: number | null;
  mr_key: string | null;
}

interface Stage {
  run_id: string;
  name: string;
  attempt: number;
  started_at: number | null;
  ended_at: number | null;
}

interface Attribution {
  run_id: string | null;
  stage: string | null;
  attempt: number | null;
  mr_key: string | null;
  attribution: string;
}

interface Message extends Attribution {
  message_id: string;
  ts: number;
}

export function isFinalRun(
  status: string,
  endedAt: number | null,
  lastSweepAt: number | null,
): boolean {
  return status !== "running" && endedAt !== null && lastSweepAt !== null && lastSweepAt > endedAt;
}

function readLastSweepAt(db: Database): number | null {
  const row = db.query("SELECT value FROM usage_meta WHERE key = 'last_sweep_at'").get() as
    | { value: string }
    | null;
  if (!row) return null;
  const at = Number(row.value);
  return Number.isFinite(at) ? at : null;
}

function holds(window: { started_at: number | null; ended_at: number | null }, ts: number): boolean {
  if (window.started_at === null || ts < window.started_at) return false;
  return window.ended_at === null || ts <= window.ended_at;
}

// `runs` and `stages` arrive latest-started first, so `find` takes the latest
// and `findLast` the earliest.
function attribute(
  ts: number,
  runs: Run[],
  runsByEnd: Run[],
  stages: Stage[],
  agentMr: string | null,
): Attribution {
  const held = runs.find((r) => holds(r, ts));
  if (held) {
    const stage = stages.find((s) => s.run_id === held.run_id && holds(s, ts));
    return {
      run_id: held.run_id,
      stage: stage?.name ?? null,
      attempt: stage?.attempt ?? null,
      mr_key: held.mr_key ?? agentMr,
      attribution: stage ? "stage" : "run",
    };
  }
  const nearest =
    runsByEnd.find((r) => r.ended_at !== null && r.ended_at < ts) ??
    runs.findLast((r) => r.started_at > ts);
  if (nearest) {
    return {
      run_id: nearest.run_id,
      stage: null,
      attempt: null,
      mr_key: nearest.mr_key ?? agentMr,
      attribution: "session",
    };
  }
  return {
    run_id: null,
    stage: null,
    attempt: null,
    mr_key: agentMr,
    attribution: agentMr === null ? "none" : "session",
  };
}

function isSame(a: Attribution, b: Attribution): boolean {
  return (
    a.run_id === b.run_id &&
    a.stage === b.stage &&
    a.attempt === b.attempt &&
    a.mr_key === b.mr_key &&
    a.attribution === b.attribution
  );
}

export function attributeMessages(db: Database, machineId: string): { changed: number } {
  const lastSweepAt = readLastSweepAt(db);
  const sessions = db.query("SELECT DISTINCT session_id FROM usage_sessions WHERE machine_id = ?");
  const linkedRuns = db.query(`
    SELECT r.run_id, r.status, r.started_at, r.ended_at, r.mr_key
    FROM usage_sessions s
    JOIN usage_runs r ON r.machine_id = s.machine_id AND r.run_id = s.ref
    WHERE s.machine_id = ? AND s.session_id = ? AND s.source = 'run' AND r.started_at IS NOT NULL
    ORDER BY r.started_at DESC, r.run_id DESC`);
  const pendingMessages = db.query(`
    SELECT message_id, ts, run_id, stage, attempt, mr_key, attribution
    FROM usage_messages
    WHERE machine_id = ? AND session_id = ?
      AND (run_id IS NULL OR run_id NOT IN (SELECT value FROM json_each(?)))`);
  const runStages = db.query(`
    SELECT run_id, name, attempt, started_at, ended_at
    FROM usage_stages
    WHERE machine_id = ? AND run_id IN (SELECT value FROM json_each(?))
    ORDER BY started_at DESC, attempt DESC, name`);
  const agentMrKey = db.query(`
    SELECT agent_mr_key FROM usage_sessions
    WHERE machine_id = ? AND session_id = ? AND source = 'agent' AND agent_mr_key IS NOT NULL
    ORDER BY ref LIMIT 1`);
  const update = db.query(`
    UPDATE usage_messages SET run_id = ?, stage = ?, attempt = ?, mr_key = ?, attribution = ?
    WHERE machine_id = ? AND message_id = ?`);

  let changed = 0;
  db.transaction(() => {
    for (const { session_id } of sessions.all(machineId) as { session_id: string }[]) {
      const runs = linkedRuns.all(machineId, session_id) as Run[];
      const finalRuns = runs
        .filter((r) => isFinalRun(r.status ?? "running", r.ended_at, lastSweepAt))
        .map((r) => r.run_id);
      const pending = pendingMessages.all(
        machineId,
        session_id,
        JSON.stringify(finalRuns),
      ) as Message[];
      if (pending.length === 0) continue;

      const runIds = JSON.stringify(runs.map((r) => r.run_id));
      const stages = runStages.all(machineId, runIds) as Stage[];
      const agent = agentMrKey.get(machineId, session_id) as { agent_mr_key: string } | null;
      const agentMr = agent?.agent_mr_key ?? null;
      const runsByEnd = runs.toSorted((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0));

      for (const message of pending) {
        const next = attribute(message.ts, runs, runsByEnd, stages, agentMr);
        if (isSame(message, next)) continue;
        update.run(
          next.run_id,
          next.stage,
          next.attempt,
          next.mr_key,
          next.attribution,
          machineId,
          message.message_id,
        );
        changed++;
      }
    }
  })();
  return { changed };
}
