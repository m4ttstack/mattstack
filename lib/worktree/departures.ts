import { realpathSync } from "fs";
import { getKvValue, setKvValue } from "../state/index.ts";

const DEPARTURES_NS = "worktree-departures";
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

type Departures = Record<string, string>;

// A disposed tree's directory can vanish, so the raw path stands in for a realpath that no longer resolves.
function keyFor(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Sessions that were inside a tree when it was asked to leave. Keeps the earliest time per session and drops entries older than 14 days before `at`. */
export function recordDepartures(path: string, sessionIds: string[], at: string): void {
  const key = keyFor(path);
  const existing = getKvValue<Departures>(DEPARTURES_NS, key, {});
  const cutoff = Date.parse(at) - RETENTION_MS;
  const next: Departures = {};
  for (const [id, when] of Object.entries(existing)) {
    if (Date.parse(when) >= cutoff) next[id] = when;
  }
  for (const id of sessionIds) next[id] ??= at;
  setKvValue(DEPARTURES_NS, key, next);
}

export function departedAt(path: string, sessionId: string): string | null {
  return getKvValue<Departures>(DEPARTURES_NS, keyFor(path), {})[sessionId] ?? null;
}
