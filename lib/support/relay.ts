/** This Mac's calls to the switchboard's support routes. */
import { parseSupportMessage, type SupportDraft, type SupportHostState, type SupportKind, type SupportMessage } from "../../packages/rt-client/src/support.ts";

const REQUEST_TIMEOUT_MS = 10_000;
export const WAIT_SECONDS = 25;
const WAIT_SLACK_MS = 10_000;

/** `changed`: the relay still holds an earlier message under this id that says something else. `rejected`: it will never take this one. */
export type SupportSend = "ok" | "changed" | "unknown-recipient" | "full" | "unauthorized" | "rejected" | "unreachable";

export interface SupportRelay {
  send(d: SupportDraft): Promise<SupportSend>;
  list(kind: SupportKind): Promise<SupportMessage[] | null>;
  wait(kind: SupportKind, since: number, signal: AbortSignal): Promise<{ woke: boolean; cursor: number } | null>;
  ack(keys: { from: string; id: string }[]): Promise<boolean>;
  setHost(accepting: boolean): Promise<"ok" | "other-machine" | "failed">;
  host(username: string): Promise<SupportHostState | null>;
}

const SEND_RESULT: Record<number, SupportSend> = {
  201: "ok",
  400: "rejected",
  401: "unauthorized",
  409: "changed",
  413: "rejected",
  422: "unknown-recipient",
  429: "full",
};

export function createSupportRelay(o: { url: string; token: string; machine: string; fetch?: typeof fetch }): SupportRelay {
  const fetchFn = o.fetch ?? fetch;

  async function call(path: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<Response | null> {
    try {
      // The bearer token would ride a followed redirect to wherever it points.
      return await fetchFn(`${o.url}/support/${path}`, {
        ...init,
        headers: { authorization: `Bearer ${o.token}`, "content-type": "application/json" },
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return null;
    }
  }

  async function read(path: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    const res = await call(path, signal ? { signal } : {});
    if (!res?.ok) return null;
    try {
      const body: unknown = await res.json();
      return body !== null && typeof body === "object" ? (body as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  const poll = (kind: SupportKind) => `kind=${kind}${kind === "request" ? `&machine=${encodeURIComponent(o.machine)}` : ""}`;

  return {
    async send(d) {
      const res = await call("messages", { method: "POST", body: JSON.stringify(d) });
      return (res && SEND_RESULT[res.status]) ?? "unreachable";
    },
    async list(kind) {
      const body = await read(`messages?${poll(kind)}`);
      if (!body || !Array.isArray(body.messages)) return null;
      return body.messages.map(parseSupportMessage).filter((m): m is SupportMessage => m !== null);
    },
    async wait(kind, since, signal) {
      const timeout = AbortSignal.timeout(WAIT_SECONDS * 1000 + WAIT_SLACK_MS);
      const body = await read(`wait?${poll(kind)}&since=${since}&timeout=${WAIT_SECONDS}`, AbortSignal.any([signal, timeout]));
      if (!body || typeof body.woke !== "boolean" || typeof body.cursor !== "number") return null;
      return { woke: body.woke, cursor: body.cursor };
    },
    async ack(keys) {
      return (await call("ack", { method: "POST", body: JSON.stringify({ keys }) }))?.ok ?? false;
    },
    async setHost(accepting) {
      const res = await call("host", { method: "PUT", body: JSON.stringify({ accepting, machine: o.machine }) });
      if (res?.ok) return "ok";
      return res?.status === 409 ? "other-machine" : "failed";
    },
    async host(username) {
      const body = await read(`host/${encodeURIComponent(username)}`);
      if (!body || typeof body.accepting !== "boolean") return null;
      if (body.lastSeenAt !== null && typeof body.lastSeenAt !== "number") return null;
      return { accepting: body.accepting, lastSeenAt: body.lastSeenAt };
    },
  };
}
