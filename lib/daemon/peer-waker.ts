/**
 * Holds the board's relay wait for this machine and broadcasts
 * `peer-inbox` when mail lands for the board. Mechanism only: it never
 * fetches, acks or parses an envelope; the board server and the
 * `board-peer` cron trigger do that on the broadcast.
 */
import type { Logger } from "pino";

/** Matches PEER_INBOX_EVENT in apps/board/src/peer/runtime.ts and the board-peer trigger's event. */
export const PEER_INBOX_EVENT = "peer-inbox";

const WAIT_SECONDS = 25;
const ABORT_SLACK_MS = 10_000;
const UNCONFIGURED_RECHECK_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;

export interface PeerWakerDeps {
  log: Pick<Logger, "debug" | "info" | "warn">;
  emit(type: string, data: unknown): void;
  readUrl(): string | null | undefined;
  readToken(): Promise<string | null>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  waitSeconds?: number;
  requestTimeoutMs?: number;
  unconfiguredRecheckMs?: number;
}

export interface PeerWakerHandle {
  stop(): void;
  done: Promise<void>;
}

export function nextBackoffMs(failures: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** failures);
}

type WaitOutcome = { kind: "ok"; woke: boolean; cursor: number } | { kind: "fail"; reason: string };

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}

async function waitOnce(
  fetchFn: typeof fetch,
  base: string,
  token: string,
  since: number,
  waitSeconds: number,
  timeoutMs: number,
  stop: AbortSignal,
): Promise<WaitOutcome> {
  const signal = AbortSignal.any([stop, AbortSignal.timeout(timeoutMs)]);
  try {
    // The bearer token would ride a followed redirect to wherever it points.
    const res = await fetchFn(`${base}/inbox/wait?since=${since}&timeout=${waitSeconds}`, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "manual",
      signal,
    });
    if (!res.ok) return { kind: "fail", reason: `http ${res.status}` };
    const body = (await res.json()) as { woke?: unknown; cursor?: unknown };
    if (typeof body.woke !== "boolean" || typeof body.cursor !== "number") return { kind: "fail", reason: "bad body" };
    return { kind: "ok", woke: body.woke, cursor: body.cursor };
  } catch (err) {
    return { kind: "fail", reason: err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network" };
  }
}

export function startPeerWaker(deps: PeerWakerDeps): PeerWakerHandle {
  const stopController = new AbortController();
  const fetchFn = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => abortableSleep(ms, stopController.signal));
  const waitSeconds = deps.waitSeconds ?? WAIT_SECONDS;
  const timeoutMs = deps.requestTimeoutMs ?? waitSeconds * 1000 + ABORT_SLACK_MS;
  const recheckMs = deps.unconfiguredRecheckMs ?? UNCONFIGURED_RECHECK_MS;

  const done = (async () => {
    let cursor = 0;
    let failures = 0;
    let lastFailure: string | null = null;
    let token: string | null = null;
    let boundBase: string | null = null;
    while (!stopController.signal.aborted) {
      let base: string | null;
      try {
        base = deps.readUrl() ?? null;
      } catch {
        base = null;
      }
      // The token and cursor belong to one relay: a newly declared relay
      // must neither receive the old token nor inherit the old cursor.
      if (base && base !== boundBase) {
        boundBase = base;
        token = null;
        cursor = 0;
        failures = 0;
        lastFailure = null;
      }
      if (base && token === null) token = await deps.readToken().catch(() => null);
      if (stopController.signal.aborted) break;
      if (!base || !token) {
        await sleep(recheckMs);
        continue;
      }
      const outcome = await waitOnce(fetchFn, base, token, cursor, waitSeconds, timeoutMs, stopController.signal);
      if (stopController.signal.aborted) break;
      if (outcome.kind === "ok") {
        if (lastFailure !== null) deps.log.info({ relay: base }, "peer waker: relay reachable again");
        lastFailure = null;
        failures = 0;
        if (outcome.woke) {
          cursor = Math.max(cursor, outcome.cursor);
          // emit fans out synchronously to every broadcast subscriber; one
          // that throws must not end the loop.
          try {
            deps.emit(PEER_INBOX_EVENT, { cursor });
          } catch (err) {
            deps.log.warn({ err }, "peer waker: a peer-inbox subscriber threw");
          }
          deps.log.debug({ cursor }, "peer waker: inbox woke");
        }
        continue;
      }
      if (outcome.reason === "http 401") token = null;
      if (outcome.reason !== lastFailure) {
        deps.log.warn({ relay: base, reason: outcome.reason }, "peer waker: relay wait failed; boards fall back to their 60s poll");
        lastFailure = outcome.reason;
      }
      await sleep(nextBackoffMs(failures++));
    }
  })();

  return {
    stop: () => stopController.abort(),
    done,
  };
}
