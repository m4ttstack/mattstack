/**
 * Moves support messages between the relay and this Mac's state db: requests
 * in on the host's Mac, statuses in on the sender's, statuses out from the
 * host's. Nothing is acked before it is stored.
 */
import type { Database } from "bun:sqlite";
import type { Logger } from "pino";
import {
  SUPPORT_PARTS_MAX,
  SUPPORT_PART_MAX,
  SUPPORT_TEXT_MAX,
  SUPPORT_TTL_MS,
  type SupportDraft,
  type SupportKind,
  type SupportMessage,
} from "../../packages/rt-client/src/support.ts";
import {
  dropStatus,
  getRequest,
  insertRequest,
  listRequests,
  moveRequest,
  pendingStatuses,
  queueStatus,
  type SupportPart,
  type SupportRequest,
  type SupportState,
} from "../state/support-store.ts";
import { canonicalHandle } from "../team/board-peers.ts";
import { createChain } from "./chain.ts";
import { onRoster, type SupportConfig } from "./config.ts";
import { usableKeys, type SupportKeys } from "./org-key.ts";
import { supportMac, verifySupportMac } from "./proof.ts";
import type { SupportRelay } from "./relay.ts";

export interface StatusBody {
  requestId: string;
  state: SupportState;
  /** When the host moved the request, always later than the status before it. */
  at: number;
  reason?: string;
  dmLink?: string;
}

export interface RequestBody {
  text: string;
  parts: SupportPart[];
  slackUserId: string;
}

export interface SyncDeps {
  db: Database;
  relay(): Promise<SupportRelay | null>;
  config(): SupportConfig | null;
  keys(): Promise<SupportKeys | null>;
  onRequest(r: SupportRequest): void;
  onStatus(r: SupportRequest): void;
  now(): number;
  log: Pick<Logger, "info" | "warn" | "debug">;
}

export interface SupportSync {
  /** `drain` reads the queue of a Mac that has just stopped accepting, so what is in it can be answered. True when the queue was read and left empty. */
  pull(kind: SupportKind, opts?: { drain?: boolean }): Promise<boolean>;
  flush(): Promise<void>;
}

/** How long, from first seeing it, a message this Mac cannot prove is left on the relay: its copy of the org may not have pulled a new key or a new member yet. */
export const PROOF_SETTLE_MS = 60 * 60_000;
const PAGE = 100;
const MAX_PAGES = 20;
const REASON_MAX = 500;
const UNREADABLE = "the host's mattstack could not read your request";
const FIRST_SEEN_MAX = 1000;

const PART_KEYS: readonly string[] = ["versions", "setup", "mr"] satisfies SupportPart["key"][];
/** The states a host may report; `sent` and `opening` never leave the Mac they are kept on. */
const HOST_STATES: readonly string[] = [
  "received",
  "opened",
  "waiting",
  "already-waiting",
  "already-open",
  "declined",
  "not-accepting",
  "failed",
  "expired",
] satisfies SupportState[];
const SENDER_OPEN: readonly SupportState[] = ["sent", "received", "waiting"];

export function signDraft(
  cfg: Pick<SupportConfig, "orgRemote" | "me">,
  keys: SupportKeys,
  m: { id: string; to: string; kind: SupportKind; body: string },
  now: number,
): SupportDraft {
  if (cfg.me === null) throw new Error("support: this Mac does not know its own username");
  const to = canonicalHandle(m.to);
  const mac = supportMac(keys.current, { ...m, to, org: cfg.orgRemote, from: cfg.me, sentAt: now });
  return { id: m.id, to, kind: m.kind, sentAt: now, body: m.body, mac };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseRequestBody(text: string): RequestBody | null {
  const v = parseJson(text);
  if (!v || typeof v.text !== "string" || !v.text.trim() || v.text.length > SUPPORT_TEXT_MAX) return null;
  if (typeof v.slackUserId !== "string") return null;
  if (!Array.isArray(v.parts) || v.parts.length > SUPPORT_PARTS_MAX) return null;
  const parts: SupportPart[] = [];
  for (const p of v.parts as unknown[]) {
    const { key, label, value } = (p ?? {}) as Record<string, unknown>;
    if (typeof key !== "string" || typeof label !== "string" || typeof value !== "string") return null;
    if (label.length > SUPPORT_PART_MAX || value.length > SUPPORT_PART_MAX) return null;
    if (PART_KEYS.includes(key)) parts.push({ key: key as SupportPart["key"], label, value });
  }
  return { text: v.text, parts, slackUserId: v.slackUserId };
}

function parseStatusBody(text: string): StatusBody | null {
  const v = parseJson(text);
  if (!v || typeof v.requestId !== "string" || typeof v.state !== "string" || !HOST_STATES.includes(v.state)) return null;
  if (typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
  return {
    requestId: v.requestId,
    state: v.state as SupportState,
    at: v.at,
    ...(typeof v.reason === "string" ? { reason: v.reason.slice(0, REASON_MAX) } : {}),
    ...(typeof v.dmLink === "string" && v.dmLink.startsWith("slack://") ? { dmLink: v.dmLink } : {}),
  };
}

export function createSupportSync(deps: SyncDeps): SupportSync {
  const { db, log } = deps;
  const firstSeen = new Map<string, number>();
  const flushing = createChain();

  /** Whether the message may be believed: `wait` leaves it on the relay for now. */
  function judge(m: SupportMessage, cfg: SupportConfig, keys: string[]): "proved" | "wait" | "drop" {
    const named = onRoster(cfg, m.from);
    const signed = verifySupportMac(keys, { ...m, to: cfg.me ?? "", org: cfg.orgRemote }, m.mac);
    const key = `${m.from} ${m.id}`;
    if (named && signed) {
      firstSeen.delete(key);
      return "proved";
    }
    const seen = firstSeen.get(key);
    const about = { from: m.from, id: m.id, kind: m.kind, named, signed };
    if ((named || signed) && (seen === undefined || deps.now() - seen < PROOF_SETTLE_MS)) {
      if (seen === undefined) {
        if (firstSeen.size >= FIRST_SEEN_MAX) firstSeen.clear();
        firstSeen.set(key, deps.now());
        log.warn(about, "support: a message is not proved to come from the org yet");
      }
      return "wait";
    }
    firstSeen.delete(key);
    log.warn(about, "support: a message that is not proved to come from the org was dropped");
    return "drop";
  }

  /** True when the message may be acked. */
  function takeRequest(m: SupportMessage, cfg: SupportConfig): boolean {
    const body = parseRequestBody(m.body);
    if (!body) {
      log.warn({ from: m.from, id: m.id }, "support: a request could not be read");
      const status: StatusBody = { requestId: m.id, state: "failed", at: deps.now(), reason: UNREADABLE };
      queueStatus({ id: `${m.id}:failed`, to: m.from, body: JSON.stringify(status) }, deps.now(), db);
      return true;
    }
    const request = {
      id: m.id,
      direction: "in" as const,
      peer: m.from,
      org: cfg.org,
      ...body,
      state: "received" as const,
      reason: null,
      dmLink: null,
      conversationId: null,
      gateId: null,
      statusAt: 0,
      sentAt: m.sentAt,
      receivedAt: m.receivedAt,
    };
    if (insertRequest(request, db)) deps.onRequest({ ...request, updatedAt: m.receivedAt });
    return true;
  }

  function takeStatus(m: SupportMessage): boolean {
    const body = parseStatusBody(m.body);
    if (!body) {
      log.warn({ from: m.from, id: m.id }, "support: a status could not be read");
      return true;
    }
    const row = getRequest("out", m.from, body.requestId, db);
    // The person's other Mac may be the one that asked.
    if (!row) return listRequests("out", undefined, db).some((r) => r.id === body.requestId);
    if (body.at <= row.statusAt) return true;
    const patch = { state: body.state, reason: body.reason ?? null, dmLink: body.dmLink ?? null, statusAt: body.at };
    if (moveRequest(row, SENDER_OPEN, patch, deps.now(), db)) {
      deps.onStatus(getRequest("out", m.from, body.requestId, db)!);
    }
    return true;
  }

  async function pullPage(kind: SupportKind, relay: SupportRelay, cfg: SupportConfig, keys: string[]): Promise<"empty" | "more" | "left"> {
    const messages = await relay.list(kind);
    if (!messages) return "left";
    const acks: { from: string; id: string }[] = [];
    for (const m of messages) {
      try {
        const verdict = judge(m, cfg, keys);
        if (verdict === "wait") continue;
        if (verdict === "drop" || (kind === "request" ? takeRequest(m, cfg) : takeStatus(m))) acks.push({ from: m.from, id: m.id });
      } catch (err) {
        log.warn({ err, from: m.from, id: m.id }, "support: a message could not be taken");
        if (kind === "request" && stored(m)) acks.push({ from: m.from, id: m.id });
      }
    }
    if (messages.length === 0) return "empty";
    const acked = acks.length > 0 && (await relay.ack(acks));
    if (acked && messages.length >= PAGE) return "more";
    return acked && acks.length === messages.length ? "empty" : "left";
  }

  function stored(m: SupportMessage): boolean {
    try {
      return getRequest("in", m.from, m.id, db) !== null;
    } catch {
      return false;
    }
  }

  return {
    async pull(kind, opts = {}) {
      const cfg = deps.config();
      // A store that cannot be read gives an empty roster, which would make a stranger of everyone.
      if (!cfg || cfg.me === null || cfg.roster.length === 0) return false;
      if (kind === "request" && !cfg.accepts && !opts.drain) return false;
      const keys = await deps.keys();
      if (!keys) return false;
      const relay = await deps.relay();
      if (!relay) return false;
      const usable = usableKeys(keys, deps.now());
      for (let page = 0; page < MAX_PAGES; page++) {
        const left = await pullPage(kind, relay, cfg, usable);
        if (left !== "more") return left === "empty";
      }
      return false;
    },

    flush: () => flushing.run(async () => {
      if (pendingStatuses(db).length === 0) return;
      const cfg = deps.config();
      if (!cfg || cfg.me === null) return;
      const keys = await deps.keys();
      if (!keys) return;
      const relay = await deps.relay();
      if (!relay) return;
      const full = new Set<string>();
      for (const s of pendingStatuses(db)) {
        if (full.has(s.to)) continue;
        if (deps.now() - s.createdAt >= SUPPORT_TTL_MS) {
          dropStatus(s.id, s.to, db);
          continue;
        }
        const result = await relay.send(signDraft(cfg, keys, { id: s.id, to: s.to, kind: "status", body: s.body }, deps.now()));
        if (result === "unreachable" || result === "unauthorized") return;
        if (result === "full") {
          full.add(s.to);
          continue;
        }
        if (result !== "ok") log.warn({ to: s.to, id: s.id, result }, "support: a status was not taken");
        dropStatus(s.id, s.to, db);
      }
    }),
  };
}
