import { Database } from "bun:sqlite";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "fs";
import { join } from "path";
import { mrKeyFromField, mrKeyFromSubject } from "./mr-key.ts";
import type { TranscriptFile } from "./transcripts.ts";

export interface AgentLink {
  id: string;
  sessionId: string;
  subject: string | null;
  label: string | null;
  caller: string | null;
}

export interface SnapshotResult {
  runs: number;
  skipped: number;
  unresolvedMr: number;
}

interface RunRow {
  id: string;
  pipeline: string | null;
  work_type: string | null;
  spawned_by: string | null;
  status: string | null;
  started_at: number | null;
  ended_at: number | null;
}

interface StageRow {
  name: string;
  attempt: number | null;
  status: string | null;
  started_at: number | null;
  ended_at: number | null;
}

interface RunSnapshot {
  row: RunRow;
  fields: Map<string, string>;
  stages: StageRow[];
}

function subdirs(path: string): string[] {
  try {
    return readdirSync(path).filter((name) => {
      try {
        return statSync(join(path, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

function readRunDb(path: string): RunSnapshot[] {
  const db = new Database(path, { readonly: true });
  try {
    const rows = db
      .query("SELECT id, pipeline, work_type, spawned_by, status, started_at, ended_at FROM runs")
      .all() as RunRow[];
    return rows.map((row) => {
      const fields = new Map<string, string>();
      const fieldRows = db
        .query("SELECT key, value FROM fields WHERE run_id = ?")
        .all(row.id) as { key: string; value: string }[];
      for (const f of fieldRows) fields.set(f.key, f.value);
      const stages = db
        .query("SELECT name, attempt, status, started_at, ended_at FROM stages WHERE run_id = ?")
        .all(row.id) as StageRow[];
      return { row, fields, stages };
    });
  } finally {
    db.close();
  }
}

function sessionsOf(fields: Map<string, string>): string[] {
  const list = fields.get("claude-sessions");
  if (list !== undefined) {
    try {
      const parsed: unknown = JSON.parse(list);
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
        return parsed.filter((s) => s !== "");
      }
    } catch {
      // a malformed list falls back to claude-session
    }
  }
  const single = fields.get("claude-session");
  return single ? [single] : [];
}

const UPSERT_RUN = `
INSERT INTO usage_runs (machine_id, run_id, repo, pipeline, work_type, spawned_by, status,
  started_at, ended_at, mr_key, mr_url, ticket, branch)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (machine_id, run_id) DO UPDATE SET
  repo = excluded.repo, pipeline = excluded.pipeline, work_type = excluded.work_type,
  spawned_by = excluded.spawned_by, status = excluded.status, started_at = excluded.started_at,
  ended_at = excluded.ended_at, mr_key = excluded.mr_key, mr_url = excluded.mr_url,
  ticket = excluded.ticket, branch = excluded.branch`;

const UPSERT_STAGE = `
INSERT INTO usage_stages (machine_id, run_id, name, attempt, status, started_at, ended_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (machine_id, run_id, name, attempt) DO UPDATE SET
  status = excluded.status, started_at = excluded.started_at, ended_at = excluded.ended_at`;

const LINK_RUN_SESSION = `
INSERT INTO usage_sessions (machine_id, session_id, source, ref, agent_mr_key, agent_kind)
VALUES (?, ?, 'run', ?, NULL, NULL)
ON CONFLICT (machine_id, session_id, source, ref) DO NOTHING`;

export function snapshotRuns(db: Database, runsRoot: string, machineId: string): SnapshotResult {
  const result: SnapshotResult = { runs: 0, skipped: 0, unresolvedMr: 0 };
  const upsertRun = db.query(UPSERT_RUN);
  const upsertStage = db.query(UPSERT_STAGE);
  const linkSession = db.query(LINK_RUN_SESSION);

  for (const repo of subdirs(runsRoot)) {
    for (const id of subdirs(join(runsRoot, repo))) {
      const path = join(runsRoot, repo, id, "state.db");
      if (!existsSync(path)) continue;
      let snapshots: RunSnapshot[];
      try {
        snapshots = readRunDb(path);
      } catch {
        result.skipped++;
        continue;
      }
      for (const { row, fields, stages } of snapshots) {
        if (fields.get("test")) continue;
        const mr = (fields.get("mr") ?? "").trim();
        const mrKey = mr === "" ? null : mrKeyFromField(mr, repo);
        if (mr !== "" && mr !== "-" && mrKey === null) result.unresolvedMr++;
        const mrUrl = /^https?:\/\//.test(mr) ? mr : null;
        db.transaction(() => {
          upsertRun.run(
            machineId,
            row.id,
            repo,
            row.pipeline,
            row.work_type,
            row.spawned_by,
            row.status,
            row.started_at,
            row.ended_at,
            mrKey,
            mrUrl,
            fields.get("ticket") ?? null,
            fields.get("branch") ?? null,
          );
          for (const s of stages) {
            upsertStage.run(
              machineId,
              row.id,
              s.name,
              s.attempt ?? 1,
              s.status,
              s.started_at,
              s.ended_at,
            );
          }
          for (const sessionId of sessionsOf(fields)) linkSession.run(machineId, sessionId, row.id);
        })();
        result.runs++;
      }
    }
  }
  return result;
}

// The board's review, respond and doctor launches share one tab label shape
// and pass no `label`, so only an agent started with a label naming doctor is
// recognized.
function isDoctor(agent: AgentLink): boolean {
  return /\bdoctor\b/i.test(agent.label ?? "");
}

export function linkAgents(db: Database, agents: AgentLink[], machineId: string): void {
  const upsertAgent = db.query(`
    INSERT INTO usage_sessions (machine_id, session_id, source, ref, agent_mr_key, agent_kind)
    VALUES (?, ?, 'agent', ?, ?, ?)
    ON CONFLICT (machine_id, session_id, source, ref) DO UPDATE SET
      agent_mr_key = excluded.agent_mr_key,
      agent_kind = CASE WHEN usage_sessions.agent_kind = 'doctor' THEN 'doctor' ELSE excluded.agent_kind END`);
  const linkSession = db.query(LINK_RUN_SESSION);
  db.transaction(() => {
    for (const agent of agents) {
      if (!agent.sessionId || !agent.subject) continue;
      if (agent.subject.startsWith("mr:")) {
        upsertAgent.run(
          machineId,
          agent.sessionId,
          agent.id,
          mrKeyFromSubject(agent.subject),
          isDoctor(agent) ? "doctor" : "other",
        );
      } else if (agent.subject.startsWith("run:")) {
        const runId = agent.subject.slice(4);
        if (runId) linkSession.run(machineId, agent.sessionId, runId);
      }
    }
  })();
}

const DOCTOR_MARKER = "<command-name>/board:doctor<";
const HEAD_BYTES = 64 * 1024;

function headHasDoctorMarker(path: string): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.toString("utf8", 0, n).includes(DOCTOR_MARKER);
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

// Board launches carry no label, so the doctor's own slash command at the top
// of its main transcript is what marks it. The text is matched, never kept.
export function classifyAgentSessions(
  db: Database,
  files: TranscriptFile[],
  machineId: string,
): { doctors: number } {
  const mainBySession = new Map<string, string>();
  for (const f of files) if (f.subagentId === null) mainBySession.set(f.sessionId, f.path);
  const rows = db
    .query(
      "SELECT DISTINCT session_id FROM usage_sessions WHERE machine_id = ? AND source = 'agent' AND agent_kind = 'other'",
    )
    .all(machineId) as { session_id: string }[];
  const mark = db.query(
    "UPDATE usage_sessions SET agent_kind = 'doctor' WHERE machine_id = ? AND session_id = ? AND source = 'agent' AND agent_kind = 'other'",
  );
  let doctors = 0;
  for (const { session_id } of rows) {
    const path = mainBySession.get(session_id);
    if (path && headHasDoctorMarker(path)) {
      mark.run(machineId, session_id);
      doctors++;
    }
  }
  return { doctors };
}

export function linkedSessionIds(db: Database, machineId: string): Set<string> {
  const rows = db
    .query("SELECT DISTINCT session_id FROM usage_sessions WHERE machine_id = ?")
    .all(machineId) as { session_id: string }[];
  return new Set(rows.map((r) => r.session_id));
}
