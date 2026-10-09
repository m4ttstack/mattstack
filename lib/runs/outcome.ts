/**
 * What a run came to: its own status plus the MR it opened or reviewed. The
 * MR's forge state and CI live in a kv cache a background refresher fills,
 * so building an outcome never waits on the forge.
 */
import type { RunDecisionRow, RunOutcome } from "../../packages/rt-client/src/commands.ts";
import { getKvValue, listKvValues, setKvValue } from "../state/kv-blob.ts";

export const OUTCOME_KV_NS = "runs.outcome";

export interface CachedOutcome {
  iid: number;
  state: "opened" | "merged" | "closed";
  mergedAt?: number;
  ci: string | null;
  posted: string | null;
  checkedAt: number;
}

const RUN_STATUSES = new Set<RunOutcome["status"]>(["running", "done", "abandoned", "failed"]);
const MR_URL = /\/merge_requests\/(\d+)(?:[/?#]|$)/;

export function parseMrRef(value: string | null | undefined): { iid: number; url: string | null } | null {
  const raw = value?.trim();
  if (!raw) return null;
  const fromUrl = /^https?:\/\//i.test(raw) ? MR_URL.exec(raw)?.[1] : undefined;
  const bare = /^!?(\d+)$/.exec(raw)?.[1];
  const iid = Number(fromUrl ?? bare);
  if (!Number.isInteger(iid) || iid <= 0) return null;
  return { iid, url: fromUrl ? raw : null };
}

export function mrRole(producedBy: string | null, workType: string): "own" | "reviewed" | null {
  if (producedBy === "review" || producedBy === "receive-review") return "reviewed";
  if ((producedBy === "ship" || producedBy === "watch-ci") && workType !== "review") return "own";
  return null;
}

export function postedFromDecisions(decisions: RunDecisionRow[]): string | null {
  const posts = decisions.filter((d) => d.scope === "post").sort((a, b) => b.decided_at - a.decided_at);
  for (const d of posts) {
    try {
      const disposition = (JSON.parse(d.selection) as { disposition?: unknown } | null)?.disposition;
      if (typeof disposition === "string") return disposition;
    } catch {
      continue;
    }
  }
  return null;
}

export function buildOutcome(
  summary: { status: string; work_type: string },
  mrField: { value: string; produced_by: string } | null,
  decisions: RunDecisionRow[],
  cached: CachedOutcome | null,
): RunOutcome {
  const status = RUN_STATUSES.has(summary.status as RunOutcome["status"]) ? (summary.status as RunOutcome["status"]) : "done";
  const outcome: RunOutcome = { status };
  const ref = mrField ? parseMrRef(mrField.value) : null;
  const role = mrField ? mrRole(mrField.produced_by, summary.work_type) : null;
  if (!ref || !role) return outcome;
  const hit = cached && cached.iid === ref.iid ? cached : null;
  if (role === "reviewed") {
    outcome.reviewed = { iid: ref.iid, url: ref.url, posted: postedFromDecisions(decisions) ?? hit?.posted ?? null };
    return outcome;
  }
  outcome.mr = { iid: ref.iid, state: hit?.state ?? "unknown", url: ref.url };
  if (hit?.mergedAt !== undefined) outcome.mr.mergedAt = hit.mergedAt;
  if (hit) outcome.ci = hit.ci;
  return outcome;
}

export function readCachedOutcome(runId: string): CachedOutcome | null {
  return getKvValue<CachedOutcome | null>(OUTCOME_KV_NS, runId, null);
}

export function writeCachedOutcome(runId: string, v: CachedOutcome): void {
  setKvValue(OUTCOME_KV_NS, runId, v);
}

/** Every cached outcome in one read, for a list that would otherwise query once per run. */
export function readAllCachedOutcomes(): Record<string, CachedOutcome> {
  return listKvValues<CachedOutcome>(OUTCOME_KV_NS);
}
