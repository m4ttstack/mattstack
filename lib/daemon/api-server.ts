/**
 * REST API + WebSocket server on 127.0.0.1:9401 — the daemon's HTTP surface
 * for external clients (tray, editor extensions, scripts).
 *
 * Also owns the broadcast channel: `broadcast()` fans an event out to every
 * connected /ws client. It is safe to call before the server starts (the
 * client set is simply empty).
 */

import type { Server, ServerWebSocket } from "bun";
import type { Logger } from "pino";
import { API_PORT, resolveApiPort } from "../daemon-config.ts";
import { getApiToken, resolveOriginTrust } from "./api-auth.ts";
import { createApiApp } from "./api-app.ts";
import { getAggregatedConnection } from "./freshness.ts";
import { GATE_REQUEST_LIMIT_BYTES } from "./request-limits.ts";
import { runCapture } from "../subprocess.ts";

export { buildCorsHeaders, pathParam, repoPathParam, splitRepoAndRest, coerceQueryParams } from "./api-app.ts";

/** Per-connection data on the :9401 WebSocket broadcast channel. */
interface ApiWSData {
  kind: "broadcast";
}

const wsClients = new Set<ServerWebSocket<ApiWSData>>();

/** Count of currently connected WS broadcast clients, for health reporting. */
export function apiWsClientCount(): number {
  return wsClients.size;
}


let apiServerLog: { warn: (o: unknown, m: string) => void } = { warn: () => {} };

/** Consecutive Bun `ws.send()` backpressure (-1) returns tolerated before a
    client is dropped as chronically stalled. */
const BACKPRESSURE_CLOSE_THRESHOLD = 3;
const backpressureCounts = new WeakMap<object, number>();

export interface BroadcastTarget {
  send(data: string): number;
  close(): void;
}

/**
 * Sends one frame to every client, dropping any that Bun's own send() return
 * value marks as gone. `ws.send()` never throws on a dead socket --
 * it returns 0 (this send silently failed) or -1 (backpressure) -- so a
 * disconnected or stalled console/chat-viewer tab used to keep receiving a
 * SUBSET of frames forever with nothing logged. 0 means Bun already dropped
 * this exact frame for this client: closing immediately (rather than
 * counting) is correct because the client's own reconnect logic is the only
 * way it recovers a consistent stream. -1 means backpressure, which can be
 * transient, so a few in a row are tolerated before giving up on the client.
 */
export function broadcastToClients(
  clients: Iterable<BroadcastTarget>,
  type: string,
  data: any,
  log: { warn: (o: unknown, m: string) => void },
): void {
  const msg = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const client of clients) {
    let result: number;
    try {
      result = client.send(msg);
    } catch (err) {
      log.warn({ err }, "ws client send threw; dropping");
      try { client.close(); } catch { /* already gone */ }
      continue;
    }
    if (result === 0) {
      log.warn({ type }, "ws client dropped a frame (send()=0); closing so its reconnect resyncs");
      backpressureCounts.delete(client);
      try { client.close(); } catch { /* already gone */ }
    } else if (result === -1) {
      const count = (backpressureCounts.get(client) ?? 0) + 1;
      if (count >= BACKPRESSURE_CLOSE_THRESHOLD) {
        log.warn({ type, count }, "ws client chronically backpressured; closing");
        backpressureCounts.delete(client);
        try { client.close(); } catch { /* already gone */ }
      } else {
        backpressureCounts.set(client, count);
      }
    } else {
      backpressureCounts.delete(client);
    }
  }
}

/** Broadcast an event to all connected WebSocket clients. */
export function broadcast(type: string, data: any): void {
  if (wsClients.size === 0) return;
  broadcastToClients(wsClients, type, data, apiServerLog);
}

/** Drop all broadcast clients (shutdown). */
export function clearWsClients(): void {
  wsClients.clear();
}

export interface ApiServerDeps {
  handleCommand: (cmd: string, payload: any, signal?: AbortSignal) => Promise<any>;
  log: Logger;
}

/**
 * Thrown when every bind retry is exhausted with EADDRINUSE still held. A
 * named error type rather than the raw EADDRINUSE Error, so lib/daemon.ts's
 * caller can distinguish "the port is genuinely squatted" from any other
 * startup failure and park-and-retry with backoff instead of crash-looping
 * (that caller-side change belongs to a sibling job; this class is the
 * contract it wires into).
 */
export class ApiPortInUseError extends Error {
  readonly code = "EADDRINUSE" as const;
  readonly port: number;
  constructor(port: number) {
    super(`EADDRINUSE: api server port ${port} is still in use after ${BIND_RETRY_ATTEMPTS} bind attempts`);
    this.name = "ApiPortInUseError";
    this.port = port;
  }
}

export interface BindRetryDeps {
  sleep: (ms: number) => Promise<void>;
  log: { warn: (o: unknown, m: string) => void };
  /** Defaults to a real `lsof -i :<port>` via runCapture; overridable so tests never shell out. */
  probePortHolder?: (port: number) => Promise<string>;
}

async function defaultProbePortHolder(port: number): Promise<string> {
  const result = await runCapture(["lsof", "-i", `:${port}`], { timeoutMs: 5_000, stderr: "pipe" });
  return result.stdout.trim();
}

// evictStaleDaemon (lib/daemon/boot-reconcile.ts) already assumes a prior
// holder is gone after a 300ms Bun.sleepSync — 6 attempts at 500ms (~3s
// worst case, exported so tests assert against these, not hardcoded copies)
// gives that same assumption room to be wrong once before this gives up too.
export const BIND_RETRY_ATTEMPTS = 6;
export const BIND_RETRY_DELAY_MS = 500;

/**
 * evictStaleDaemon() SIGTERMs the previous holder of this port before a new
 * daemon binds, but the kill isn't synchronous with the exit — a fresh
 * daemon can reach this bind before the old one has actually released
 * 9401. Only EADDRINUSE is retried (bounded, ~3s total); anything else is a
 * real misconfiguration and fails on the first attempt, same as before.
 *
 * Once retries are exhausted, this logs who holds the port and throws
 * ApiPortInUseError instead of the bare EADDRINUSE Error, so a caller can
 * tell "give up cleanly" apart from "the bind function itself is broken".
 */
export async function bindApiServerWithRetry<T>(bind: () => T, deps: BindRetryDeps, port: number = API_PORT): Promise<T> {
  const probe = deps.probePortHolder ?? defaultProbePortHolder;
  for (let attempt = 1; ; attempt++) {
    try {
      return bind();
    } catch (err) {
      const isAddrInUse = err instanceof Error && (err as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!isAddrInUse) throw err;
      if (attempt >= BIND_RETRY_ATTEMPTS) {
        const holder = await probe(port).catch((probeErr) => `lsof failed: ${String(probeErr)}`);
        deps.log.warn({ port, holder }, "api port still in use after retries; giving up bind (the daemon should park and retry with backoff rather than crash-loop)");
        throw new ApiPortInUseError(port);
      }
      deps.log.warn({ attempt, port }, "api port in use, retrying — another daemon is likely still shutting down");
      await deps.sleep(BIND_RETRY_DELAY_MS);
    }
  }
}

/**
 * Backoff base/cap for {@link withApiPortParkRetry}'s outer loop. Distinct
 * from BIND_RETRY_* (bindApiServerWithRetry's own ~3s inner retry, already
 * exhausted before an ApiPortInUseError ever reaches here): this loop
 * assumes the holder is a whole other process that may take much longer
 * than 3s to exit, so it backs off further between each full re-attempt.
 */
const PARK_RETRY_BASE_MS = 3_000;
const PARK_RETRY_MAX_MS = 60_000;

export interface ParkRetryDeps {
  sleep: (ms: number) => Promise<void>;
  log: { warn: (o: unknown, m: string) => void };
}

/**
 * Wraps a `startApiServer`-shaped call: on `ApiPortInUseError` (bind retries
 * already exhausted), logs and waits with exponential backoff, then calls
 * `start` again — indefinitely, never giving up — instead of letting the
 * error reach the daemon's top-level crash path (S043 caller-side contract,
 * docs/daemon-api-auth.md). Any other error propagates immediately: that is
 * a genuine misconfiguration, not a transient port squat.
 */
export async function withApiPortParkRetry<T>(start: () => Promise<T>, deps: ParkRetryDeps): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await start();
    } catch (err) {
      if (!(err instanceof ApiPortInUseError)) throw err;
      const delayMs = Math.min(PARK_RETRY_BASE_MS * 2 ** (attempt - 1), PARK_RETRY_MAX_MS);
      deps.log.warn({ attempt, port: err.port, delayMs }, "api server port still in use; parked, retrying with backoff");
      await deps.sleep(delayMs);
    }
  }
}

export async function startApiServer(deps: ApiServerDeps): Promise<Server<any>> {
  const { handleCommand, log } = deps;
  apiServerLog = log;
  const apiToken = getApiToken();
  const port = resolveApiPort();
  const app = createApiApp({ handleCommand, log, apiToken, port });

  const server = await bindApiServerWithRetry(() => Bun.serve<ApiWSData, never>({
    port,
    // Bind to loopback only — never expose the control surface on the LAN.
    hostname: "127.0.0.1",
    // Raise the request idle timeout off Bun's 10s default so long-lived
    // clients aren't reaped every 10s ("[Bun.serve]: request timed out").
    // 255 is the server max; the websocket block below sets its own larger one.
    idleTimeout: 255,
    maxRequestBodySize: GATE_REQUEST_LIMIT_BYTES,
    async fetch(req, server) {
      const url = new URL(req.url);
      const origin = req.headers.get("origin");

      // WebSocket upgrade (broadcast channel). Browsers cannot set custom
      // headers on a WS handshake, so the token (when a browser page wants
      // to identify itself) travels as a ?token= query param instead of
      // X-RT-Token.
      if (url.pathname === "/ws") {
        const wsToken = url.searchParams.get("token");
        if (!resolveOriginTrust(origin, wsToken, apiToken)) {
          return new Response("origin not allowed", { status: 403 });
        }
        if (server.upgrade(req, { data: { kind: "broadcast" } })) return undefined as any;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      return app.fetch(req);
    },
    websocket: {
      // 960 is Bun's per-socket max; combined with the default pings this
      // stops idle WS connections from being closed out from under clients.
      idleTimeout: 960,
      open(ws) {
        wsClients.add(ws);
        log.debug({ total: wsClients.size }, "ws client connected");
        try {
          ws.send(JSON.stringify({
            type: "mr:status",
            data: { connection: getAggregatedConnection() },
            timestamp: Date.now(),
          }));
        } catch { /* client gone */ }
      },
      close(ws) {
        wsClients.delete(ws);
        log.debug({ total: wsClients.size }, "ws client disconnected");
      },
      message() {
        // Broadcast clients are read-only; inbound frames are ignored.
      },
    },
  }), { sleep: (ms) => Bun.sleep(ms), log }, port);

  log.info({ port }, "api server listening");
  return server;
}
