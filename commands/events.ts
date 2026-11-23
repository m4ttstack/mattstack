/**
 * rt events — optional event bus for panes and skills (RT-44).
 *
 *   rt events emit <topic> [--json '{...}']            publish
 *   rt events wait <pattern> [--after N] [--timeout D] blocking subscribe (long-poll)
 *   rt events tail <pattern> [--after N]               follow-mode NDJSON stream
 *   rt events list <pattern> [--after N] [--limit N]   read the journal
 *
 * All output is JSON (skills consume it). Cursors are caller-held: every
 * response carries `cursor`; pass it back via --after. Timeout exits 124.
 * Spec: docs/superpowers/specs/2026-08-18-rt-events-bus-design.md
 */

import { daemonQuery } from "../lib/daemon-client.ts";
import { parseDuration } from "../lib/duration.ts";
import * as out from "../lib/ui/out.ts";
export { parseDuration };

const DAEMON_WAIT_MS = 240_000;          // daemon clamps to this too
const IPC_TIMEOUT_MS = DAEMON_WAIT_MS + 10_000; // client abort must outlive the daemon cap

export function nextWaitMs(deadline: number | null, now: number): number {
  if (deadline == null) return DAEMON_WAIT_MS;
  return Math.max(0, Math.min(DAEMON_WAIT_MS, deadline - now));
}

function fail(msg: string): never {
  out.diagnostic(`rt events: ${msg}\n`);
  process.exit(1);
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// Index-based scan (not value comparison — a positional that EQUALS a flag's
// value, e.g. `rt events wait 42 --after 42`, must still parse).
// --json is value-taking only for emit's payload, which reads it via flagValue;
// out of this set a bare --json on list/tail/wait won't swallow the pattern.
const FLAGS_WITH_VALUES = new Set(["--after", "--timeout", "--limit"]);
function positional(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUES.has(a)) i++; // skip the flag's value slot
      continue;
    }
    return a;
  }
  return undefined;
}

export async function eventsEmit(args: string[]): Promise<void> {
  const topic = positional(args);
  if (!topic) fail("usage: rt events emit <topic> [--json '<json>']");
  let payload: unknown;
  const raw = flagValue(args, "--json");
  if (raw !== undefined) {
    try { payload = JSON.parse(raw); } catch { fail(`--json is not valid JSON: ${raw}`); }
  }
  const res = await daemonQuery("events:emit", { topic, payload }, 10_000);
  if (!res) fail("daemon unavailable — the event bus needs the rt daemon (rt daemon start)");
  if (!res.ok) fail(res.error ?? "emit failed");
  out.json({ ok: true, id: res.data.id });
}

const RETRY_BACKOFF_START_MS = 1_000;
const RETRY_BACKOFF_CAP_MS = 5_000;

/**
 * One long-poll round for wait and tail. A daemon that is not there (a
 * restart, an update) is retried with backoff until `deadline`, or forever
 * when it is null, the way `rt gate wait` reconnects. An error the daemon
 * itself returns throws.
 */
export async function pollWithReconnect(
  pattern: string,
  after: number | undefined,
  waitMs: number,
  deadline: number | null,
  deps: { query: typeof daemonQuery; sleep(ms: number): Promise<void>; now(): number } = {
    query: daemonQuery,
    sleep: (ms) => Bun.sleep(ms),
    now: () => Date.now(),
  },
): Promise<{ events: any[]; cursor: number } | { budget: true }> {
  let backoffMs = RETRY_BACKOFF_START_MS;
  let warned = false;
  while (true) {
    const remaining = deadline == null ? Infinity : deadline - deps.now();
    if (remaining <= 0) return { budget: true };
    const res = await deps.query("events:wait", { pattern, after, waitMs: Math.min(waitMs, remaining) }, IPC_TIMEOUT_MS);
    if (res) {
      if (!res.ok) throw new Error(res.error ?? "wait failed");
      return res.data as { events: any[]; cursor: number };
    }
    if (!warned) {
      out.diagnostic("rt events: daemon unavailable; retrying until it is back...\n");
      warned = true;
    }
    const left = deadline == null ? Infinity : deadline - deps.now();
    if (left <= 0) return { budget: true };
    await deps.sleep(Math.min(backoffMs, left));
    backoffMs = Math.min(backoffMs * 2, RETRY_BACKOFF_CAP_MS);
  }
}

async function pollOrFail(pattern: string, after: number | undefined, waitMs: number, deadline: number | null) {
  try {
    return await pollWithReconnect(pattern, after, waitMs, deadline);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

export async function eventsWait(args: string[]): Promise<void> {
  const pattern = positional(args);
  if (!pattern) fail("usage: rt events wait <pattern> [--after <cursor>] [--timeout <dur>]");
  let after = flagValue(args, "--after") !== undefined ? Number(flagValue(args, "--after")) : undefined;
  if (after !== undefined && !Number.isFinite(after)) fail("--after must be a number");
  let deadline: number | null = null;
  const t = flagValue(args, "--timeout");
  if (t !== undefined) {
    const ms = parseDuration(t);
    if (ms == null) fail(`--timeout: bad duration "${t}" (use 30s, 5m, 500ms, or bare seconds)`);
    deadline = Date.now() + ms;
  }

  while (true) {
    const waitMs = nextWaitMs(deadline, Date.now());
    const data = waitMs === 0 ? { budget: true as const } : await pollOrFail(pattern, after, waitMs, deadline);
    if ("budget" in data) {
      out.json({ ok: true, timedOut: true, cursor: after ?? null });
      process.exit(124);
    }
    after = data.cursor; // ALWAYS thread the cursor — empty responses included
    if (data.events.length) {
      out.json({ ok: true, events: data.events, cursor: data.cursor });
      return;
    }
  }
}

export async function eventsList(args: string[]): Promise<void> {
  // An omitted pattern matches everything: a bare `rt events list` is a useful
  // read of the whole journal, not an error (safe for non-TTY/agent callers).
  const pattern = positional(args) ?? "**";
  const payload: Record<string, unknown> = { pattern };
  const after = flagValue(args, "--after") !== undefined ? Number(flagValue(args, "--after")) : undefined;
  if (after !== undefined && !Number.isFinite(after)) fail("--after must be a number");
  if (after !== undefined) payload.after = after;
  const limit = flagValue(args, "--limit") !== undefined ? Number(flagValue(args, "--limit")) : undefined;
  if (limit !== undefined && !Number.isFinite(limit)) fail("--limit must be a number");
  if (limit !== undefined) payload.limit = limit;
  const res = await daemonQuery("events:list", payload, 10_000);
  if (!res) fail("daemon unavailable — the event bus needs the rt daemon (rt daemon start)");
  if (!res.ok) fail(res.error ?? "list failed");
  out.json({ ok: true, events: res.data.events, cursor: res.data.cursor });
}

export async function eventsTail(args: string[]): Promise<void> {
  const pattern = positional(args) ?? "**";
  let after = flagValue(args, "--after") !== undefined ? Number(flagValue(args, "--after")) : undefined;
  if (after !== undefined && !Number.isFinite(after)) fail("--after must be a number");

  // Catch-up via list, then the same poll loop as wait, forever.
  // No --after means START FROM NOW (same default as wait) — never dump the
  // whole journal on a follow-mode consumer. MAX_SAFE_INTEGER returns zero
  // events plus cursor = journal head (list computes cursor = maxId() for
  // untruncated results).
  const listAfter = after ?? Number.MAX_SAFE_INTEGER;
  const res = await daemonQuery("events:list", { pattern, after: listAfter }, 10_000);
  if (!res) fail("daemon unavailable — the event bus needs the rt daemon (rt daemon start)");
  if (!res.ok) fail(res.error ?? "tail failed");
  for (const ev of res.data.events) out.json(ev);
  after = res.data.cursor;

  while (true) {
    const data = await pollOrFail(pattern, after, DAEMON_WAIT_MS, null);
    // Unreachable with no deadline; the check is what narrows the type.
    if ("budget" in data) return;
    after = data.cursor;
    for (const ev of data.events) out.json(ev);
  }
}
