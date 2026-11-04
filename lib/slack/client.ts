import { escapeSlackText } from "./format.ts";

export interface SlackMessage {
  ts: string;
  user?: string;
  text: string;
  subtype?: string;
  replyCount?: number;
  latestReply?: string;
  files?: { name: string }[];
}

export interface SlackUser {
  id: string;
  name: string;
  displayName: string;
  realName: string;
  deleted: boolean;
  isBot: boolean;
}

export interface SlackClient {
  authTest(): Promise<{ userId: string; scopes: string[] }>;
  listUsers(): Promise<SlackUser[]>;
  openDm(userId: string): Promise<string>;
  /** Oldest first. */
  history(channel: string, oldest: string): Promise<SlackMessage[]>;
  replies(channel: string, parentTs: string, oldest: string): Promise<SlackMessage[]>;
  /** The DM's newest message ts, undefined for an empty DM. */
  newestTs(channel: string): Promise<string | undefined>;
  post(channel: string, text: string): Promise<{ ts: string }>;
}

export class SlackError extends Error {
  readonly code: string;
  readonly retryAfterMs?: number;
  constructor(code: string, retryAfterMs?: number) {
    super(`Slack: ${code}`);
    this.name = "SlackError";
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

type Json = Record<string, any>;

const DEFAULT_RETRY_MS = 1000;

function toMessage(m: Json): SlackMessage {
  return {
    ts: String(m.ts),
    user: m.user,
    text: typeof m.text === "string" ? m.text : "",
    subtype: m.subtype,
    replyCount: m.reply_count,
    latestReply: m.latest_reply,
    files: Array.isArray(m.files) ? m.files.map((f: Json) => ({ name: String(f.name ?? "") })) : undefined,
  };
}

const byTs = (a: SlackMessage, b: SlackMessage) => Number(a.ts) - Number(b.ts);

const REQUEST_TIMEOUT_MS = 15_000;

export function createSlackClient(token: string, fetchImpl: typeof fetch = fetch, timeoutMs = REQUEST_TIMEOUT_MS): SlackClient {
  async function call(method: string, params: Record<string, string> = {}): Promise<{ body: Json; headers: Headers }> {
    let res: Response;
    try {
      res = await fetchImpl(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new SlackError(err instanceof Error && err.name === "TimeoutError" ? "timeout" : "network_error");
    }
    if (res.status === 429) {
      const seconds = Number(res.headers.get("retry-after"));
      throw new SlackError("ratelimited", Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_MS);
    }
    let body: Json;
    try {
      body = (await res.json()) as Json;
    } catch {
      throw new SlackError(`http_${res.status}`);
    }
    if (!body.ok) throw new SlackError(String(body.error ?? `http_${res.status}`));
    return { body, headers: res.headers };
  }

  async function pages(method: string, params: Record<string, string>, key: string): Promise<Json[]> {
    const items: Json[] = [];
    let cursor = "";
    do {
      const { body } = await call(method, cursor ? { ...params, cursor } : params);
      items.push(...((body[key] as Json[] | undefined) ?? []));
      cursor = body.response_metadata?.next_cursor ?? "";
    } while (cursor);
    return items;
  }

  return {
    async authTest() {
      const { body, headers } = await call("auth.test");
      const scopes = (headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return { userId: String(body.user_id), scopes };
    },
    async listUsers() {
      const members = await pages("users.list", { limit: "200" }, "members");
      return members.map((u) => ({
        id: String(u.id),
        name: String(u.name ?? ""),
        displayName: String(u.profile?.display_name ?? ""),
        realName: String(u.real_name ?? u.profile?.real_name ?? ""),
        deleted: u.deleted === true,
        isBot: u.is_bot === true,
      }));
    },
    async openDm(userId) {
      const { body } = await call("conversations.open", { users: userId });
      return String(body.channel.id);
    },
    async history(channel, oldest) {
      const raw = await pages("conversations.history", { channel, oldest, limit: "200" }, "messages");
      return raw.map(toMessage).sort(byTs);
    },
    async replies(channel, parentTs, oldest) {
      const raw = await pages("conversations.replies", { channel, ts: parentTs, oldest, limit: "200" }, "messages");
      return raw.map(toMessage).sort(byTs);
    },
    async newestTs(channel) {
      const { body } = await call("conversations.history", { channel, limit: "1" });
      const newest = (body.messages as Json[] | undefined)?.[0];
      return newest ? String(newest.ts) : undefined;
    },
    async post(channel, text) {
      const { body } = await call("chat.postMessage", { channel, text: escapeSlackText(text) });
      return { ts: String(body.ts) };
    },
  };
}
