/**
 * rt daemon transport: HTTP over a unix socket (`~/.mattstack/rt/rt.sock`).
 *
 * POST http://localhost/<cmd> with a JSON payload, response envelope
 * `{ ok, data?, error? }`. Every call degrades to `{ ok: false, error }`
 * instead of throwing, so callers surface daemon-down verbatim.
 *
 * Ported verbatim from mr-board's src/rt-client.ts.
 */
import { request } from "node:http";
import { homedir } from "os";
import { join } from "path";
import { assertNotRealDaemonInTest, parseForbidSocks } from "./test-isolation.ts";

export interface RtResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  /** Structured form of `error` on a handler throw (R035): `code` defaults
   *  to "handler-threw" when the thrown error carries none. Additive; older
   *  daemons and the reject path never set this. */
  failure?: { code: string; message: string };
  /** Set by a daemon that is booting or shutting down; it did not act on the request. */
  unavailable?: "starting" | "stopping";
}

export interface RtClientOptions {
  sockPath?: string;
  wsUrl?: string;
  /** Per-call override of rtCommand's own default (15s); chat's pulse wrapper needs an 800ms hook budget. */
  timeoutMs?: number;
  /** How long to keep retrying a daemon that is restarting; 0 for a probe that reports the daemon's state. Honored by the calls that pass it on. */
  retryBudgetMs?: number;
  /**
   * Test seam for createRelay (relay.ts): swaps the daemon subscription for
   * a fake without a live WebSocket server. Typed structurally against
   * relay.ts's `subscribe` rather than importing its RelayEventType, which
   * would make this module depend on the one that already depends on it.
   */
  subscribeImpl?: (onEvent: (type: string, data: unknown) => void, opts?: RtClientOptions) => () => void;
}

// Duplicates the ~/.mattstack/rt layout: rt-client has no dependency on rt's
// lib/, so this literal cannot import rtDir(). repo-tools/lib/rt-paths.ts is
// the authority — change there first, mirror here (same convention as
// settings/paths.ts's call-time `home()`).
//
// RT_DAEMON_SOCK wins over the HOME-derived default (same pattern as
// lib/daemon-client.ts's RT_APP_SOCKET for tray.sock): an isolated daemon
// (per-agent launch, an e2e run) points every rt-client caller, including
// the `rt` CLI's own subcommands, at its own socket without repointing HOME.
function defaultSock(): string {
  return process.env.RT_DAEMON_SOCK || join(process.env.HOME ?? homedir(), ".mattstack", "rt", "rt.sock");
}

/**
 * Display-only: a module-load snapshot for callers that just want to show
 * the default path (no consumer imports it today — checked). `rtCommand`
 * itself never reads this constant; it calls `defaultSock()` fresh on every
 * invocation so a test can repoint `process.env.HOME` at any time before
 * calling, not only before this module first loads.
 */
export const DEFAULT_SOCK = defaultSock();

/**
 * The one exception to the never-throws contract below: when a test preload
 * has armed RT_TEST_FORBID_SOCKS (see test-isolation.ts), dispatching at a
 * listed socket throws instead of degrading. A degrade envelope could be
 * tolerated by the calling test; escaping isolation must fail the run loudly.
 * A malformed list throws too rather than silently disarming the guard.
 * The account's own rt.sock throws in any test run, armed or not.
 */
function assertSockNotForbidden(cmd: string, sockPath: string): void {
  assertNotRealDaemonInTest(cmd, sockPath);
  const raw = process.env.RT_TEST_FORBID_SOCKS;
  if (!raw) return;
  const forbidden = parseForbidSocks(raw);
  if (forbidden.includes(sockPath)) {
    throw new Error(
      `rt-client: refusing "${cmd}" at forbidden socket ${sockPath}: RT_TEST_FORBID_SOCKS marks it as a live daemon socket, so this dispatch would have escaped test isolation`,
    );
  }
}

/** Starts every error rtCommand returns when the daemon gave no answer (unreachable, or timed out). */
export const DAEMON_UNREACHABLE_PREFIX = "rt daemon unreachable at ";
const DAEMON_TIMEOUT_TAIL = "; the daemon may be busy rather than down";

/** True for an rtCommand error from a daemon that took the request and did not answer in time. */
export function isDaemonTimeout(error: string | undefined): boolean {
  return !!error && error.startsWith(DAEMON_UNREACHABLE_PREFIX) && error.endsWith(DAEMON_TIMEOUT_TAIL);
}

/** How long a call keeps trying a daemon that is restarting. */
export const DAEMON_RETRY_BUDGET_MS = 20_000;
/** Once a socket has gone unanswered for a whole retry budget, calls to it make one attempt each for this long. */
export const DAEMON_DOWN_COOLOFF_MS = 30_000;

/** 100, 200, 400, 800, then 1000 for every later attempt. */
export function nextRetryDelay(attempt: number): number {
  return Math.min(1000, 100 * 2 ** Math.min(attempt, 4));
}

/** True for a 503 body a starting or stopping daemon sent. */
export function isUnavailable(r: unknown): r is { ok: false; error: string; unavailable: "starting" | "stopping" } {
  if (!r || typeof r !== "object") return false;
  const body = r as { ok?: unknown; unavailable?: unknown };
  return body.ok === false && (body.unavailable === "starting" || body.unavailable === "stopping");
}

// The only errors that prove no connection was made, so the daemon cannot
// have acted on the request. A reset or a broken pipe comes after the daemon
// accepted the connection and is never retried.
const CONNECT_FAILED_CODES = new Set(["ENOENT", "ECONNREFUSED"]);

function connectFailed(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && CONNECT_FAILED_CODES.has(code);
}

// Per socket path. `firstMissAt` is when the socket first went unanswered;
// `downUntil` is set only once that has lasted DAEMON_RETRY_BUDGET_MS, so one
// caller's short budget never takes the retry away from the next caller.
// Without the cool-off, every call a long-lived client makes to a daemon that
// is down for good would stall for the whole budget.
// `kind` says what the misses were: a daemon that comes back after an
// unanswered stretch gets a fresh clock, while one that keeps answering
// starting or stopping cools off like a missing one.
const unanswered = new Map<string, { kind: "unreached" | "unavailable"; firstMissAt: number; downUntil: number }>();
let coolOffAfterMs = DAEMON_RETRY_BUDGET_MS;

export const __test__ = {
  resetCoolOff(): void {
    unanswered.clear();
    coolOffAfterMs = DAEMON_RETRY_BUDGET_MS;
  },
  setCoolOffAfterMs(ms: number): void { coolOffAfterMs = ms; },
};

/** RT_DAEMON_RETRY_BUDGET_MS when it is set to a number, read at call time. */
export function retryBudgetOverride(): number | undefined {
  const raw = process.env.RT_DAEMON_RETRY_BUDGET_MS;
  if (!raw) return undefined;
  const ms = Number(raw);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

// A per-attempt timeout this short marks a caller on a time limit of its own
// (a hook; the fork check spends 5s of a 10s hook limit), which must not wait
// out a restart. The wrappers' own 10s-and-up defaults say nothing of the kind.
const SHORT_TIMEOUT_MS = 5_000;

export function defaultRetryBudget(timeoutMs: number | undefined): number {
  return timeoutMs !== undefined && timeoutMs <= SHORT_TIMEOUT_MS ? timeoutMs : DAEMON_RETRY_BUDGET_MS;
}

/**
 * `retryBudgetMs` bounds the retrying, `timeoutMs` each attempt. A request is
 * sent again only when the daemon cannot have acted on it: the connection
 * was never made, or the daemon answered that it is starting or stopping.
 */
export async function rtCommand<T = unknown>(
  cmd: string,
  payload: Record<string, unknown>,
  opts: { sockPath?: string; timeoutMs?: number; retryBudgetMs?: number } = {},
): Promise<RtResponse<T>> {
  const sockPath = opts.sockPath ?? defaultSock();
  assertSockNotForbidden(cmd, sockPath);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const coolingOff = (unanswered.get(sockPath)?.downUntil ?? 0) > Date.now();
  const budget = coolingOff ? 0 : opts.retryBudgetMs ?? retryBudgetOverride() ?? defaultRetryBudget(opts.timeoutMs);
  const startedAt = Date.now();
  const deadline = startedAt + budget;
  for (let attempt = 0; ; attempt++) {
    const { response, outcome } = await sendCommand<T>(cmd, payload, sockPath, timeoutMs);
    if (outcome === "dropped") return response;
    if (outcome === "answered" && !isUnavailable(response)) {
      unanswered.delete(sockPath);
      return response;
    }
    const kind = outcome === "answered" ? "unavailable" : "unreached";
    if (unanswered.get(sockPath)?.kind !== kind) {
      // The call's start, not now: a budget as long as the threshold must
      // always reach it, whatever the first attempt took.
      unanswered.set(sockPath, { kind, firstMissAt: startedAt, downUntil: 0 });
    }
    const delay = Math.min(nextRetryDelay(attempt), deadline - Date.now());
    if (delay <= 0) {
      const miss = unanswered.get(sockPath)!;
      if (Date.now() - miss.firstMissAt >= coolOffAfterMs) miss.downUntil = Date.now() + DAEMON_DOWN_COOLOFF_MS;
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * One attempt. `answered`: the daemon replied. `unreached`: no connection was
 * made, so the daemon cannot have seen the request. `dropped`: a connection
 * was made and no reply came, so it may have.
 */
async function sendCommand<T>(
  cmd: string, payload: Record<string, unknown>, sockPath: string, timeoutMs: number,
): Promise<{ response: RtResponse<T>; outcome: "answered" | "unreached" | "dropped" }> {
  try {
    return { response: await postCommand<T>(cmd, payload, sockPath, timeoutMs), outcome: "answered" };
  } catch (err) {
    // A timeout means the daemon took the request and was slow, which reads
    // differently from a socket nobody is listening on.
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    const msg = timedOut
      ? `${cmd} timed out after ${timeoutMs / 1000}s${DAEMON_TIMEOUT_TAIL}`
      : err instanceof Error ? err.message : String(err);
    return {
      response: { ok: false, error: `${DAEMON_UNREACHABLE_PREFIX}${sockPath}: ${msg}` },
      outcome: !timedOut && connectFailed(err) ? "unreached" : "dropped",
    };
  }
}

/** Throws only when no reply arrived. */
async function postCommand<T>(
  cmd: string, payload: Record<string, unknown>, sockPath: string, timeoutMs: number,
): Promise<RtResponse<T>> {
  const body = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json", "X-RT-Client": `rt-client/${process.pid}` };
  const res = typeof (globalThis as { Bun?: unknown }).Bun === "undefined"
    ? await postOverSocket(sockPath, cmd, body, headers, timeoutMs)
    : await postWithBunFetch(sockPath, cmd, body, headers, timeoutMs);
  const text = res.text;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  if (res.status >= 200 && res.status < 300 && parsed !== undefined) return parsed as RtResponse<T>;
  const envelope = parsed as RtResponse<T> | null | undefined;
  if (envelope && typeof envelope === "object" && typeof envelope.ok === "boolean") return envelope;
  if (res.status === 413) {
    const mb = (Buffer.byteLength(body) / (1024 * 1024)).toFixed(1);
    // Literal: rt-client cannot import lib/daemon's GATE_REQUEST_LIMIT_BYTES.
    const hint = cmd === "gate:open" || cmd === "gate:ask" ? "; gate requests are limited to 16 MiB" : "";
    return { ok: false, error: `${cmd} refused: request too large (${mb} MB sent; the daemon rejected it with HTTP 413${hint})` };
  }
  return { ok: false, error: `${cmd} failed: HTTP ${res.status}${text ? ` ${text.slice(0, 200)}` : ""}` };
}

async function postWithBunFetch(
  sockPath: string, cmd: string, body: string, headers: Record<string, string>, timeoutMs: number,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://localhost/${cmd}`, {
    unix: sockPath,
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
    // Bun's `unix` fetch option isn't in the standard RequestInit type.
  } as RequestInit);
  return { status: res.status, text: await res.text() };
}

/** Node's fetch ignores Bun's `unix` option, so a Node host (the VS Code extension) posts through node:http. */
export function postOverSocket(
  sockPath: string, cmd: string, body: string, headers: Record<string, string>, timeoutMs: number,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { socketPath: sockPath, path: `/${cmd}`, method: "POST", headers: { ...headers, "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => { clearTimeout(timer); resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }); });
        res.on("error", (e) => { clearTimeout(timer); reject(e); });
      },
    );
    const timer = setTimeout(() => {
      const err = new Error(`${cmd} timed out after ${timeoutMs}ms`);
      err.name = "TimeoutError";
      req.destroy(err);
    }, timeoutMs);
    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.end(body);
  });
}
